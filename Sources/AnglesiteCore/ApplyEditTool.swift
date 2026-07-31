import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5). Same pattern as
// FoundationModelAssistant.swift / GenerableTypes.swift.
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// A FoundationModels `Tool` that lets the on-device model apply a structured edit to an element
/// on a page of the current site, routing through ``IntentEditBridge`` (and on to the plugin's
/// edit pipeline). Reuses ``GeneratedEditCommand`` (#154) as its arguments so the model speaks one
/// edit vocabulary.
public struct ApplyEditTool: Tool, Sendable {
    /// The tool's stable name. Exposed statically so callers (e.g. `FoundationModelAssistant`'s
    /// `.started` event) can report the attached tools without constructing an instance.
    public static let toolName = "applyEdit"
    /// `Tool` conformance — always ``toolName``, kept as an instance property only because the
    /// protocol requires one.
    public let name = ApplyEditTool.toolName
    /// `Tool` conformance: the prompt-visible description the on-device model reads to decide
    /// when (and how) to invoke this tool — instructions to the model, not UI copy.
    public let description = "Apply a structured text, attribute, or image edit to a specific element in a page's source file. Provide the source file path, an element selector (or a simple tag like h1), the operation kind, and the replacement value."

    private let bridge: IntentEditBridge
    private let siteID: String
    /// The structured `ElementInfo` for the element the user selected in the overlay, if any —
    /// taken from `AssistantContext.selectedElementSelector`. Preferred over a model-supplied
    /// selector because it's a real, resolved selector rather than a guess.
    private let contextSelector: JSONValue?

    /// A tool instance is scoped to one site and one selection snapshot: pass the overlay's
    /// resolved `ElementInfo` as `contextSelector` (or `nil` when nothing is selected) at
    /// construction, since FoundationModels tools can't receive per-call context beyond the
    /// model-generated arguments.
    public init(bridge: IntentEditBridge, siteID: String, contextSelector: JSONValue?) {
        self.bridge = bridge
        self.siteID = siteID
        self.contextSelector = contextSelector
    }

    /// `Tool` conformance. Never throws in practice: every outcome — applied, ambiguous
    /// selector, unresolvable selector, bridge failure — is returned as a sentence for the model
    /// to relay or act on, because a thrown error would end the model's turn instead of letting
    /// it recover (e.g. by asking the user to select an element).
    public func call(arguments: GeneratedEditCommand) async throws -> String {
        guard let selector = resolveSelector(arguments.selector) else {
            return "Couldn't identify which element to edit — select one in the preview, or name a simple tag like h1."
        }
        let reply = await bridge.applyEdit(
            siteID: siteID,
            filePath: arguments.filePath,
            selector: selector,
            op: Self.opString(for: arguments.operation),
            value: .string(arguments.value)
        )
        switch reply.status {
        case .applied:
            return "Applied edit to \(arguments.filePath)." + (reply.message.map { " \($0)" } ?? "")
        case .ambiguous:
            return "Edit not applied — the selector matched more than one element. "
                + (reply.message.map { "\($0) " } ?? "")
                + "Select a specific element in the preview and try again."
        case .failed:
            return "Edit failed: \(reply.message ?? "unknown error")."
        case .preview:
            // ApplyEditTool never sets dryRun — a .preview reply is unexpected here.
            return "Edit not applied (unexpected preview response)."
        }
    }

    // MARK: Selector resolution (hybrid: context first, bare-tag fallback, else nil)

    /// Resolve the structured `ElementInfo` the plugin's `selector.mjs` requires.
    /// 1. Prefer the overlay-resolved context selector.
    /// 2. Else, if the model's selector is a bare tag (`h1`, `p`), build a minimal ElementInfo.
    /// 3. Else, give up — we don't fabricate complex selectors.
    private func resolveSelector(_ raw: String) -> JSONValue? {
        if let contextSelector { return contextSelector }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isBareTag(trimmed) else { return nil }
        // Best-effort convenience only: a bare tag always resolves to the FIRST element of that tag
        // (`nthChild: 1` is synthesized, not parsed). The model cannot target a later occurrence
        // this way — precise targeting comes from `contextSelector` (a real overlay `ElementInfo`).
        return .object([
            "tag": .string(trimmed.lowercased()),
            "classes": .array([]),
            "nthChild": .int(1),
        ])
    }

    /// A bare HTML tag: letters then alphanumerics, nothing else (no combinators, classes, pseudo).
    private static func isBareTag(_ s: String) -> Bool {
        guard let first = s.first, first.isLetter else { return false }
        return s.allSatisfy { $0.isLetter || $0.isNumber }
    }

    /// Map the #154 ``EditOperation`` onto the `EditMessage.Op` string vocabulary (the bridge
    /// deferred in `GenerableTypes.swift`'s doc-comment, "TODO(#156)").
    private static func opString(for op: EditOperation) -> String {
        switch op {
        case .replaceText: return EditMessage.Op.replaceText
        case .replaceAttr: return EditMessage.Op.replaceAttr
        case .replaceImageSrc: return EditMessage.Op.replaceImageSrc
        case .applyInstruction: return EditMessage.Op.applyInstruction
        }
    }
}
#endif
