import Foundation

/// A provider-agnostic streaming event from a ``ConversationalAssistant``.
///
/// Minimal event surface consumed by `ChatModel`: the cases the transcript knows how to render plus
/// lifecycle/error/usage metadata. Keeping this provider-neutral lets Foundation Models populate
/// the chat surface without faking a subprocess protocol.
/// The `toolUse`/`toolResult` cases use the provider-neutral `id:` label deliberately.
public enum AssistantEvent: Sendable, Equatable {
    /// First event of a turn: the resolved model and the tool names available this turn.
    case started(model: String?, toolNames: [String])
    /// A chunk of streamed assistant text. Appended to the in-flight message.
    case textDelta(String)
    /// An assistant "thinking" block. The chat panel captures but does not render these.
    case thinking(String)
    /// The assistant invoked a tool; the result arrives later as `.toolResult` (paired by `id`).
    case toolUse(id: String, name: String, input: JSONValue)
    /// A tool returned its content. `isError` flags a tool-reported failure.
    case toolResult(id: String, content: String, isError: Bool)
    /// Terminal-ish event carrying turn telemetry (token usage, cost, duration), if available.
    case turnComplete(AssistantUsage?)
    /// The backend reported an in-band error string (distinct from a thrown setup error).
    case failed(message: String)
    /// The turn was cancelled by the caller.
    case cancelled
    /// The backing process/session exited with this OS code (`0` is clean).
    case backendExited(code: Int32)
    /// Files retrieved as RAG context for this turn. The chat panel surfaces these as clickable
    /// citation chips below the assistant's response.
    case citations([RetrievedCitation])
}

/// Token/cost telemetry for one completed turn.
///
/// Cache-specific token fields are intentionally omitted here; callers that need backend-specific
/// telemetry should read the concrete backend directly.
public struct AssistantUsage: Sendable, Equatable {
    /// Prompt tokens consumed this turn.
    public let inputTokens: Int
    /// Completion tokens produced this turn.
    public let outputTokens: Int
    /// Estimated cost in US dollars, or `nil` for backends with no metering (e.g. on-device).
    public let costUSD: Double?
    /// Wall-clock turn duration in milliseconds, if the backend reports one.
    public let durationMs: Int?

    /// Creates a usage record. Cost and duration default to `nil` since not every backend
    /// reports them (see the type doc for what's deliberately omitted).
    public init(inputTokens: Int, outputTokens: Int, costUSD: Double? = nil, durationMs: Int? = nil) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.costUSD = costUSD
        self.durationMs = durationMs
    }
}

/// Errors thrown by a ``ContentAssistant`` when a requested capability isn't supported by the
/// backend (for example, not every backend can do FoundationModels guided generation).
public enum AssistantError: Error, Sendable, Equatable {
    /// The backend can't perform the requested capability; the associated message names what
    /// was asked for. Callers should have consulted ``ContentAssistant/capabilities`` first —
    /// this is the backstop, not the routing mechanism.
    case unsupported(String)
    /// Thrown by ``ContentAssistant/generate(prompt:context:)`` when the underlying stream produces
    /// a `.failed` event — i.e. the backend reported an in-band error that `generate()` cannot yield
    /// as a text chunk. Distinct from the in-stream form `AssistantEvent.failed`, which
    /// ``ConversationalAssistant/converse(prompt:context:)`` surfaces as a yielded value (not a throw).
    case streamFailed(String)
    /// The backend's model isn't usable on this host (e.g. Apple Intelligence not enabled, or the
    /// on-device model hasn't finished downloading). The associated message is user-facing and should
    /// direct the user to the fix — for FoundationModels, System Settings → Apple Intelligence.
    case unavailable(String)
}

/// A ``ContentAssistant`` that also supports a multi-turn, tool-using conversation with a rich
/// event stream. `ChatModel` depends on this refinement (not the base `ContentAssistant`) because
/// it needs structured tool-use/usage events that the base `generate()` flattens to plain text.
public protocol ConversationalAssistant: ContentAssistant {
    /// Streams a full conversational turn as ``AssistantEvent`` values. The outer `async throws`
    /// covers setup failure (backend unavailable); in-band failures surface as `.failed`.
    func converse(prompt: String, context: AssistantContext) async throws -> AsyncStream<AssistantEvent>

    /// Terminates the in-flight turn, if any. No-op when nothing is running.
    func cancel() async

    /// Resets session/continuation state so the next `converse` starts a fresh conversation.
    func resetSession() async
}
