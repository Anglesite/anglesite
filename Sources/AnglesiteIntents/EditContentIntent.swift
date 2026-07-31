import AppIntents
import AnglesiteCore
import Foundation

/// Phase B.5 (#149) / B.6 (#251). Apply a natural-language instruction to an onscreen element.
///
/// **Wire-up:**
/// 1. Siri's `appEntityUIElementProvider` (B.4 / #148) resolves "this heading" / "that image"
///    into a concrete `ElementEntity` from `PreviewAnnotationProvider`.
/// 2. Siri fills `EditContentIntent`'s parameters with the entity + the user's spoken phrase
///    ("make it bigger", "change the color to teal", ...).
/// 3. `perform()` interprets the instruction on-device (B.6) to resolve a concrete op, then
///    dry-runs via the bridge to get a before/after preview, confirms with the user, and applies.
/// 4. Plugin applies the structured patch and the reply status drives the final dialog.
public struct EditContentIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "Edit Content"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Apply a natural-language edit to an onscreen element of a site."
    )

    /// The target element, resolved by Siri from "this heading" / "that image" via
    /// `appEntityUIElementProvider` (B.4 / #148). Transient — only resolvable while the
    /// WKWebView is still showing the page that produced it (see ``ElementEntity``).
    @Parameter(title: "Element") public var element: ElementEntity
    /// The user's spoken change request, kept as raw natural language; the on-device
    /// interpreter (not Siri parameter resolution) turns it into a structured op.
    @Parameter(
        title: "Change",
        description: "A natural-language description of the change to apply, e.g. make it bigger or change the color to teal."
    ) public var instruction: String
    @Dependency private var bridge: IntentEditBridge
    @Dependency private var interpreter: any EditInterpreting

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Change (element) — (instruction)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Change \(\.$element) \u{2014} \(\.$instruction)")
    }

    /// Runs the interpret → dry-run → confirm → apply pipeline described on the type. Every
    /// early exit before the confirmation (bad selector, interpretation failure, dry-run
    /// refusal, user decline) returns a dialog without writing anything — the source tree is
    /// only touched after the user has seen the before/after preview and confirmed.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let bridge = IntentEditBridgeOverride.scoped ?? self.bridge
        let interp = EditInterpreterOverride.scoped ?? self.interpreter

        guard let selector = element.selectorJSON() else {
            return .result(dialog: IntentDialog(stringLiteral: ContentDialogs.editInvalidSelector(displayName: element.displayName)))
        }

        // 1. Interpret the instruction on-device.
        // Decode tag + textContent once from the selector we already validated above.
        let selectorDict: [String: JSONValue]
        if case .object(let d) = selector { selectorDict = d } else { selectorDict = [:] }
        let tag: String
        if case .string(let t) = selectorDict["tag"] { tag = t } else { tag = "" }
        let textContent: String?
        if case .string(let t) = selectorDict["textContent"] { textContent = t } else { textContent = nil }

        let siteDirectory = await SiteStore.shared.find(id: element.siteID)?.sourceDirectory
        let interpreted: InterpretedEdit
        do {
            interpreted = try await interp.interpret(
                instruction: instruction,
                element: InterpretedElementContext(
                    tag: tag,
                    currentText: textContent,
                    pagePath: element.pagePath,
                    displayName: element.displayName,
                    siteID: element.siteID,
                    siteDirectory: siteDirectory
                )
            )
        } catch EditInterpretationError.siteUnavailable {
            return .result(dialog: IntentDialog(stringLiteral:
                "Open this site in Anglesite first, then try the edit again."))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral:
                "Editing by voice needs Apple Intelligence, which isn't available here."))
        }
        guard let resolved = interpreted.resolveOp() else {
            return .result(dialog: IntentDialog(stringLiteral:
                ContentDialogs.editAmbiguous(displayName: element.displayName, detail: nil)))
        }

        // 2. Dry-run: compute the would-be change without writing.
        let preview = await bridge.applyEdit(
            siteID: element.siteID,
            filePath: element.pagePath,
            selector: selector,
            op: resolved.op,
            value: resolved.value,
            dryRun: true
        )
        if preview.status != .preview {
            // Refusal / ambiguous / failed surfaced by the plugin -- relay it, no apply.
            return .result(dialog: IntentDialog(stringLiteral:
                ContentDialogs.editReply(preview, displayName: element.displayName)))
        }

        // 3. Confirm (decline -> exit before apply; tree untouched).
        let decision = ConfirmationOverride.scoped
        if let decision {
            if decision == .decline {
                return .result(dialog: IntentDialog(stringLiteral: "Okay, I won't change \(element.displayName)."))
            }
            // .confirm falls through to apply
        } else {
            // Production: real Siri confirmation dialog showing a before/after diff.
            try await requestConfirmation(dialog: IntentDialog(stringLiteral:
                ContentDialogs.editConfirmation(
                    edit: interpreted,
                    pagePath: element.pagePath,
                    before: preview.before,
                    after: preview.after
                )
            ))
        }

        // 4. Apply for real.
        let reply = await bridge.applyEdit(
            siteID: element.siteID,
            filePath: element.pagePath,
            selector: selector,
            op: resolved.op,
            value: resolved.value
        )
        // Cancellation is self-describing: `MCPApplyEditRouter` maps an interrupted edit to a
        // `.failed` reply whose message is exactly "canceled". Key off that, not `Task.isCancelled`
        // -- otherwise a genuine plugin failure that coincides with cancellation would be
        // mislabelled "Canceled" and the real error swallowed.
        if reply.status == .failed, reply.message == "canceled" {
            return .result(dialog: IntentDialog(stringLiteral: "Canceled the edit to \(element.displayName)."))
        }
        return .result(dialog: IntentDialog(stringLiteral:
            ContentDialogs.editReply(reply, displayName: element.displayName)))
    }
}

// `LongRunningIntent` + `CancellableIntent` gate the MCP-spawn-on-first-edit budget the way
// `AddPageIntent` / `AddPostIntent` do (see `ContentIntents.swift`).
//
// **Why the `#if compiler(>=6.4)` guard is load-bearing.** `Package.swift` only includes the
// `AnglesiteIntentsTests` test target when `compiler(>=6.4)`. The `AnglesiteIntents` library
// target itself, however, compiles on whatever toolchain `swift build` is using -- including
// the Xcode 26.3 / Swift 6.3 CI runner that GH's `macos-15` provides today (the runner that
// runs `swift test` against `AnglesiteCoreTests` and `AnglesiteBridgeTests`). `LongRunningIntent`
// and `CancellableIntent` are macOS 26+ symbols not present on that toolchain, so an
// unconditional conformance would fail to compile in CI. Same gate as the create intents.
// Tracking removal in #128 once GH's runner ships Xcode 27.
#if compiler(>=6.4)
extension EditContentIntent: LongRunningIntent, CancellableIntent {}
#endif

// MARK: - Dialog formatting (pure, unit-testable)

extension ContentDialogs {
    /// `.applied`-status dialog. Mentions the file the patch landed on when the plugin reports
    /// one (so "edit this heading" -> "Edited h1 -- Welcome in src/pages/about.astro.") and falls
    /// back to a shorter form otherwise.
    public static func editApplied(displayName: String, file: String?) -> String {
        if let file, !file.isEmpty {
            return "Edited \(displayName) in \(file)."
        }
        return "Edited \(displayName)."
    }

    /// `.failed`-status dialog. The plugin's reason (when present) is the most useful thing to
    /// say back to the user. Fall through to a generic phrasing otherwise.
    public static func editFailed(displayName: String, reason: String?) -> String {
        if let reason, !reason.isEmpty {
            return "Couldn\u{2019}t edit \(displayName): \(reason)"
        }
        return "Couldn\u{2019}t edit \(displayName)."
    }

    /// `.ambiguous`-status dialog. Distinct from `.failed` because the user can rephrase and try
    /// again -- wording acknowledges the ambiguity rather than blaming a hard error.
    public static func editAmbiguous(displayName: String, detail: String?) -> String {
        if let detail, !detail.isEmpty {
            return "Not sure how to edit \(displayName): \(detail)"
        }
        return "Not sure how to edit \(displayName) \u{2014} try rephrasing."
    }

    /// When the entity's stored selector won't decode back into the structured shape
    /// `EditMessage` requires. Shouldn't happen at runtime (the encoder/decoder round-trip is
    /// tested), but the failure mode is well-defined enough to deserve a dialog.
    public static func editInvalidSelector(displayName: String) -> String {
        "Lost track of \(displayName) \u{2014} try selecting it again."
    }

    /// Confirmation summary shown before a Siri-driven edit mutates source files (#239).
    /// Names the element, the page it lives on, and the requested change so the user can
    /// review before confirming. App-only summary -- a structured diff is a deferred follow-up
    /// gated on a plugin `apply_edit` dry-run.
    public static func editConfirmation(displayName: String, pagePath: String, instruction: String) -> String {
        let change = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        return "Update \(displayName) on \(pagePath)? Change: \(change)."
    }

    /// Before/after confirmation summary (#251). Spoken-friendly per kind; long fragments are
    /// truncated so Siri doesn't read paragraphs. Sourced from the plugin dry-run preview.
    public static func editConfirmation(edit: InterpretedEdit, pagePath: String, before: String?, after: String?) -> String {
        func clip(_ s: String, _ n: Int = 60) -> String { s.count <= n ? s : String(s.prefix(n)) + "\u{2026}" }
        switch edit.kind {
        case .text:
            if let b = before, let a = after {
                return "Change the text from \"\(clip(b))\" to \"\(clip(a))\" on \(pagePath)?"
            }
            return "Change the text to \"\(clip(edit.newText ?? ""))\" on \(pagePath)?"
        case .attribute:
            let name = edit.attributeName ?? "attribute"
            return "Change \(name) to \"\(clip(edit.attributeValue ?? ""))\" on \(pagePath)?"
        case .style:
            return "Set \(edit.styleProperty ?? "style") to \(clip(edit.styleValue ?? "")) on \(pagePath)?"
        }
    }

    /// Dispatch on the reply status. Single entry point the intent's `perform()` uses.
    public static func editReply(_ reply: EditReply, displayName: String) -> String {
        switch reply.status {
        case .applied: return editApplied(displayName: displayName, file: reply.file)
        case .failed: return editFailed(displayName: displayName, reason: reply.message)
        case .ambiguous: return editAmbiguous(displayName: displayName, detail: reply.message)
        case .preview:
            // editReply is called on the final apply -- .preview here means dry-run leaked through;
            // treat conservatively as not applied.
            return editFailed(displayName: displayName, reason: "unexpected preview reply")
        }
    }
}
