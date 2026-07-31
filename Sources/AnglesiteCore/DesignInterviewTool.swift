// Sources/AnglesiteCore/DesignInterviewTool.swift
import Foundation

#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Chat entry point for the design interview. Unlike `SetupIntegrationTool`/`SetupThemeTool`
/// (stateless plan-then-apply calls), the interview is inherently multi-turn — this tool's `call`
/// starts or continues a session-scoped `DesignInterviewModel` the caller supplies, rather than
/// owning conversation state itself.
public struct DesignInterviewTool: Tool, Sendable {
    /// Canonical tool name, exposed statically so call sites (tool registration, transcript
    /// filtering) can reference it without constructing a tool instance.
    public static let toolName = "designInterview"
    /// `Tool` requirement — always ``toolName``; the static exists so the name has one
    /// spelling everywhere.
    public let name = DesignInterviewTool.toolName
    /// `Tool` requirement — the model-facing summary the assistant uses to decide when to
    /// invoke the interview.
    public let description = "Have a short conversation to design or redesign a site's look and feel."

    /// Model-generated arguments for one interview turn. The `@Guide` descriptions are the
    /// model-facing contract; keep them in sync with what `call(arguments:)` actually does.
    @Generable
    public struct Arguments {
        /// The owner's message in this turn of the design conversation.
        @Guide(description: "The owner's message in this turn of the design conversation.")
        public var message: String
        /// When `true`, the owner delegated the design entirely — `call(arguments:)` skips the
        /// remaining questions and jumps straight to axis confirmation.
        @Guide(description: "Set to true if the owner wants Anglesite to just pick a design for them.")
        public var designForMe: Bool?
    }

    /// Resolves the conversation's model on each call. Front doors that already hold a model
    /// (the GUI sheet) wrap it in a constant closure via ``init(model:)``; the chat front door
    /// (#665) passes ``FoundationModelAssistant``'s lazy, session-cached accessor instead, so the
    /// interview isn't built until the assistant actually invokes the tool. Throwing so a
    /// provider whose backing state is gone fails the tool call loudly rather than silently
    /// handing back a fresh interview with no history.
    public typealias ModelProvider = @Sendable () async throws -> DesignInterviewModel

    private let provider: ModelProvider
    /// Wraps an already-constructed model in a constant provider — the GUI-sheet front door,
    /// which owns its interview's lifetime directly.
    public init(model: DesignInterviewModel) { self.provider = { model } }
    /// Takes a lazy provider — the chat front door (#665), which defers building the interview
    /// until the assistant actually invokes the tool. See ``ModelProvider`` for why it throws.
    public init(provider: @escaping ModelProvider) { self.provider = provider }

    /// One conversation turn. `designForMe == true` short-circuits the question flow
    /// (``DesignInterviewModel``'s `skipToAxisConfirmation`) and returns a canned handoff
    /// message; otherwise the owner's message is forwarded to the interview and the reply is
    /// the interview's latest transcript entry — the tool relays conversation state, it never
    /// synthesizes its own.
    public func call(arguments: Arguments) async throws -> String {
        let model = try await provider()
        if arguments.designForMe == true {
            let businessType = await MainActor.run { () -> String in
                model.skipToAxisConfirmation()
                return model.draft.businessType
            }
            return "I'll design it for you based on what a \(businessType) site usually needs. Review the axes and tell me to apply when you're happy."
        }
        await model.send(arguments.message)
        return await MainActor.run { model.transcript.last?.text ?? "" }
    }
}
#endif
