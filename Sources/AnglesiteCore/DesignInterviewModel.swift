import Foundation
import Observation
// SwiftUI is Darwin-only; only `axisBinding` below needs it (the GUI-sliders convenience) — the
// rest of this model is toolchain-independent conversation-state logic, testable without it.
#if canImport(SwiftUI)
import SwiftUI
#endif
import AnglesiteSiteModel

/// Drives one design-interview conversation: prompts the current ``ConversationStage`` through an
/// injected ``ConversationalAssistant``, appends turns to a transcript, and — once the owner
/// confirms the resulting ``DesignAxes`` — applies the generated design via ``DesignApplyService``.
///
/// Depends on the toolchain-independent ``ConversationalAssistant`` protocol (already used by
/// `FoundationModelAssistant`'s conformance) rather than the concrete gated type directly, so the
/// model itself stays testable on any toolchain with a fake assistant — the same seam
/// `SiteGraphNodeExplaining` uses to decouple `SiteGraphExplainerFactory`'s consumers from the
/// FoundationModels-gated implementation.
@MainActor @Observable
public final class DesignInterviewModel: Identifiable {
    /// Stable identity so SwiftUI can distinguish multiple concurrent interviews (one per site
    /// window) in lists and `ForEach`.
    public let id = UUID()
    /// The conversation's working state. `internal(set)` so mutations flow through the model's
    /// own methods — ``axisBinding(_:)`` is the deliberate slider-shaped exception.
    public internal(set) var draft: DesignInterviewDraft
    /// Ordered (role, text) turns for the conversation view. Failures are appended as assistant
    /// turns rather than thrown, so the view has exactly one rendering path.
    public internal(set) var transcript: [(role: String, text: String)] = []
    /// Outcome of the most recent ``confirmAndApply()`` — `nil` until it has run; views key
    /// their success/error presentation off this.
    public internal(set) var applyResult: Result<AppliedDesign, DesignApplyError>?

    private let assistant: any ConversationalAssistant
    private let package: AnglesitePackage
    private let siteID: String

    /// Creates a model for one interview, seeding the draft from `businessType`'s default axes.
    /// `assistant` is the injected seam described in the type doc — pass a fake in tests.
    /// `siteID` only feeds `AssistantContext` attribution, hence the empty default.
    public init(businessType: String, assistant: any ConversationalAssistant, package: AnglesitePackage, siteID: String = "") {
        self.draft = DesignInterviewDraft(businessType: businessType)
        self.assistant = assistant
        self.package = package
        self.siteID = siteID
    }

    /// Sends one turn: appends the user's message, prompts the current stage, appends the
    /// assistant's reply, then advances the conversation to the next stage. Structured
    /// (`@Generable`) axis extraction from the reply is a follow-up refinement — v1 advances on
    /// any reply and lets the user correct axes via ``nudge(_:)``.
    public func send(_ userMessage: String) async {
        transcript.append((role: "user", text: userMessage))
        let prompt = DesignInterviewPrompts.prompt(for: draft.stage, draft: draft, userMessage: userMessage)
        let context = AssistantContext(siteID: siteID, siteDirectory: package.sourceURL)
        guard let stream = try? await assistant.converse(prompt: prompt, context: context) else {
            transcript.append((role: "assistant", text: "I couldn't respond just now — try again in a moment."))
            return
        }
        var reply = ""
        var failureMessage: String?
        for await event in stream {
            switch event {
            case .textDelta(let delta):
                reply += delta
            case .failed(let message):
                failureMessage = message
            case .cancelled:
                failureMessage = "The response was cancelled — try again."
            default:
                break
            }
        }
        if let failureMessage {
            transcript.append((role: "assistant", text: "I couldn't respond just now — \(failureMessage)"))
            return
        }
        guard !reply.isEmpty else {
            transcript.append((role: "assistant", text: "The assistant didn't respond — try again."))
            return
        }
        transcript.append((role: "assistant", text: reply))
        draft.advance()
    }

    /// Applies a directional adjective nudge ("warmer", "bolder", …) to the draft's axes — the
    /// owner's low-friction alternative to dragging sliders.
    public func nudge(_ hint: DesignAdjectiveHint) {
        draft.applyAdjectiveHint(hint)
    }

    #if canImport(SwiftUI)
    /// A two-way `Binding` into one axis of `draft.axes`, for GUI sliders. `draft`'s setter is
    /// `internal(set)` (state changes are meant to flow through the model's own methods), so a
    /// cross-module SwiftUI view can't write `$model.draft.axes.temperature` directly — this
    /// routes the write back through the model instead of widening `draft`'s access.
    public func axisBinding(_ keyPath: WritableKeyPath<DesignAxes, Double>) -> Binding<Double> {
        Binding(
            get: { self.draft.axes[keyPath: keyPath] },
            set: { self.draft.axes[keyPath: keyPath] = $0 }
        )
    }
    #endif

    /// "Design it for me" escape hatch: skip straight to axis confirmation using the
    /// business-type defaults already seeded in `draft.axes`.
    public func skipToAxisConfirmation() {
        draft.stage = .axisConfirmation
    }

    /// Generates the full ``DesignConfig`` from the confirmed axes and writes it through
    /// ``DesignApplyService`` (the single design writer). Only a successful write advances the
    /// stage to `.done` — a failed apply leaves the interview open so the owner can retry
    /// instead of ending on an unapplied design.
    public func confirmAndApply() async {
        let config = DesignConfigGenerator.config(axes: draft.axes, siteType: draft.businessType, brandColor: draft.brandColorHex)
        let input = DesignApplyInput(
            cssVars: DesignTokenWriter.templateCSSVars(for: config),
            rationaleMarkdown: DesignTokenWriter.rationaleMarkdown(for: config),
            brandSummary: "Generated from a design interview for a \(draft.businessType).",
            sourceLabel: "design-interview"
        )
        let result = DesignApplyService.apply(input, to: package)
        applyResult = result
        if case .success = result {
            draft.stage = .done
        }
    }
}

public extension DesignInterviewModel {
    /// Applies a turn reply's optional per-axis deltas to `draft`, clamping via
    /// `DesignAxesCatalog.adjusted`. Pure and toolchain-independent so it's testable without a
    /// live FoundationModels session — the `@Generable` reply type that produces these values is
    /// gated below.
    nonisolated static func applyTurnReplyDeltas(
        temperature: Double?, weight: Double?, register: Double?, time: Double?, voice: Double?,
        brandColorHex: String?, to draft: inout DesignInterviewDraft
    ) {
        var deltas: [WritableKeyPath<DesignAxes, Double>: Double] = [:]
        if let temperature { deltas[\.temperature] = temperature }
        if let weight { deltas[\.weight] = weight }
        if let register { deltas[\.register] = register }
        if let time { deltas[\.time] = time }
        if let voice { deltas[\.voice] = voice }
        if !deltas.isEmpty { draft.axes = DesignAxesCatalog.adjusted(draft.axes, by: deltas) }
        if let brandColorHex { draft.brandColorHex = brandColorHex }
    }
}

#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Structured (`@Generable`) reply for one interview turn: the conversational text plus any
/// per-axis deltas the model inferred from the owner's message. Feed the deltas through
/// `DesignInterviewModel.applyTurnReplyDeltas(...)` — deliberately declared *outside* this
/// compiler gate — so the clamping logic stays testable on toolchains without FoundationModels.
@Generable
public struct DesignInterviewTurnReply: Sendable {
    /// The assistant's transcript-facing reply.
    @Guide(description: "Your conversational reply to the owner, 1-2 sentences.")
    public var replyText: String
    /// Inferred change to the temperature axis; `nil` when the message implies none.
    @Guide(description: "Temperature axis change if the owner's message implies one, else omit.")
    public var temperatureDelta: Double?
    /// Inferred change to the weight axis; `nil` when the message implies none.
    @Guide(description: "Weight axis change if the owner's message implies one, else omit.")
    public var weightDelta: Double?
    /// Inferred change to the register axis; `nil` when the message implies none.
    @Guide(description: "Register axis change if the owner's message implies one, else omit.")
    public var registerDelta: Double?
    /// Inferred change to the time axis; `nil` when the message implies none.
    @Guide(description: "Time axis change if the owner's message implies one, else omit.")
    public var timeDelta: Double?
    /// Inferred change to the voice axis; `nil` when the message implies none.
    @Guide(description: "Voice axis change if the owner's message implies one, else omit.")
    public var voiceDelta: Double?
    /// Hex brand color if the owner named one; `nil` otherwise.
    @Guide(description: "Hex color if the owner mentioned a brand color, else omit.")
    public var brandColorHex: String?
}
#endif
