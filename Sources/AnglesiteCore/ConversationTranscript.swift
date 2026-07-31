import Foundation

/// A single chat row, provider-agnostic and free of SwiftUI/persistence concerns.
///
/// Extracted from `ChatModel.Message` (App target) so the event-accumulation logic that produces
/// these rows can be unit-tested in `AnglesiteCore` without the App shell (#161). `ChatModel`
/// re-exports this as `ChatModel.Message` via a typealias, so its SwiftUI views are unaffected.
public struct ChatMessage: Identifiable, Equatable, Sendable {
    /// What kind of row this is. Beyond the classic user/assistant pair, the transcript carries
    /// out-of-band rows (`edit`, `annotation`, `citation`) that render as cards, not speech
    /// bubbles, and carry their payload in the matching `*Metadata` property.
    public enum Role: Equatable, Sendable {
        /// A prompt the user typed.
        case user
        /// A streamed model response.
        case assistant
        /// App-generated status text (e.g. the "Cancelled." row).
        case system
        /// An in-band failure — a `.failed` event or a non-clean backend exit.
        case error
        /// An assistant-applied content edit; payload in ``ChatMessage/editMetadata``.
        case edit
        /// A preview annotation; payload in ``ChatMessage/annotationMetadata``.
        case annotation
        /// RAG citation chips for a turn; payload in ``ChatMessage/citationMetadata``.
        case citation
    }

    /// Stable row identity — SwiftUI list identity, and how the transcript tracks its in-flight
    /// assistant row across out-of-band mutations.
    public let id: UUID
    /// What kind of row this is — see ``Role``.
    public let role: Role
    /// The row's text. Mutable because streamed `.textDelta` events append to it in place.
    public var content: String
    /// Tool invocations within this assistant turn, in arrival order.
    public var toolCalls: [ChatToolCall]
    /// Creation time. Drives ``ConversationTranscript/insertByTimestamp(_:)``'s chronological
    /// re-insertion after an optimistic drop.
    public let timestamp: Date
    /// Only set on `role: .edit` rows. Carries file + commit + undone flag.
    public var editMetadata: ChatEditMetadata?
    /// Only set on `role: .annotation` rows. Carries the backing annotation id.
    public var annotationMetadata: ChatAnnotationMetadata?
    /// Only set on `role: .citation` rows. Carries the retrieved files for this turn.
    public var citationMetadata: ChatCitationMetadata?

    /// Creates a row. Everything past `role`/`content` defaults, so ordinary user/assistant rows
    /// stay one-liners and only the out-of-band roles pass their metadata payload.
    public init(
        id: UUID = UUID(),
        role: Role,
        content: String,
        toolCalls: [ChatToolCall] = [],
        timestamp: Date = Date(),
        editMetadata: ChatEditMetadata? = nil,
        annotationMetadata: ChatAnnotationMetadata? = nil,
        citationMetadata: ChatCitationMetadata? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.toolCalls = toolCalls
        self.timestamp = timestamp
        self.editMetadata = editMetadata
        self.annotationMetadata = annotationMetadata
        self.citationMetadata = citationMetadata
    }
}

/// One tool invocation within an assistant turn. `id` pairs a `.toolUse` with its later `.toolResult`.
public struct ChatToolCall: Identifiable, Equatable, Sendable {
    /// The provider's tool-use id (not a UUID) — what pairs this call with its later result.
    public let id: String
    /// The tool name as the provider reported it. `"(unbound)"` marks a result that arrived
    /// with no matching call (see ``ConversationTranscript/apply(_:)``).
    public let name: String
    /// The tool input pre-rendered for the tool-call card — see
    /// ``ConversationTranscript/renderJSON(_:)``.
    public let inputDisplay: String
    /// The returned content once the paired `.toolResult` arrives; `nil` while still pending.
    public var result: String?
    /// Whether ``result`` is a tool-reported failure.
    public var isError: Bool

    /// Creates a call row, pending by default — `result`/`isError` are filled in later when the
    /// paired result event streams in.
    public init(id: String, name: String, inputDisplay: String, result: String? = nil, isError: Bool = false) {
        self.id = id
        self.name = name
        self.inputDisplay = inputDisplay
        self.result = result
        self.isError = isError
    }
}

/// Payload of a `.edit` row: which file an assistant-applied edit touched, the commit that
/// captured it, and whether it has since been undone.
public struct ChatEditMetadata: Equatable, Sendable {
    /// The edited file, as the apply reported it.
    public let file: String
    /// The commit that captured the edit — the handle its undo (a revert) operates on.
    public let commit: String
    /// Set once the edit has been reverted, so the row's Undo affordance can reflect it.
    public var undone: Bool
    /// Creates the payload; the properties document each field's contract.
    public init(file: String, commit: String, undone: Bool) {
        self.file = file
        self.commit = commit
        self.undone = undone
    }
}

/// Payload of an `.annotation` row: just the id of the backing annotation record, which the
/// row renders from rather than duplicating its content into the transcript.
public struct ChatAnnotationMetadata: Equatable, Sendable {
    /// Identity of the annotation this row mirrors.
    public let annotationID: String
    /// Creates the payload.
    public init(annotationID: String) { self.annotationID = annotationID }
}

/// Payload of a `.citation` row: the files retrieved as RAG context for one turn, surfaced as
/// clickable chips below the assistant's response.
public struct ChatCitationMetadata: Equatable, Sendable {
    /// The retrieved files, in the order the backend reported them.
    public let citations: [RetrievedCitation]
    /// Creates the payload.
    public init(citations: [RetrievedCitation]) { self.citations = citations }
}

/// The provider-agnostic reducer that turns a stream of ``AssistantEvent`` values into chat rows.
///
/// `ChatModel` (App target) owns one of these and forwards each streamed event to ``apply(_:)``;
/// the SwiftUI/persistence/undo concerns stay in `ChatModel`. Keeping the accumulation here makes
/// the streaming + tool-calling contract (#161 item 5) and conversation reset (#161 item 7)
/// testable on CI without a live model or the App target.
public struct ConversationTranscript: Equatable, Sendable {
    /// All rows in display order: user prompts, assistant turns, tool calls, plus out-of-band
    /// `.edit`/`.annotation` rows appended via ``append(_:)``.
    public private(set) var messages: [ChatMessage] = []
    /// Telemetry from the most recent `.turnComplete` that carried usage.
    public private(set) var lastUsage: AssistantUsage?
    /// The most recent in-band error (`.failed`) or non-clean backend exit.
    public private(set) var lastError: String?

    /// Id of the in-flight assistant message that streamed events extend. `nil` between turns.
    /// Tracked by id (not array index) so out-of-band mutations during a turn — e.g.
    /// `resolveAnnotation` calling ``remove(id:)``/``insertByTimestamp(_:)`` on the MainActor while
    /// the stream loop is suspended — can't shift it onto the wrong row.
    private var inFlightAssistantID: UUID?
    /// Names the backend in the `.backendExited` error string (e.g. "On-Device", "Claude").
    private let providerName: String

    /// Creates an empty transcript. `providerName` names the backend in the `.backendExited`
    /// error row (e.g. "On-Device", "Claude") so the user can tell which one died.
    public init(providerName: String = "assistant") {
        self.providerName = providerName
    }

    /// Begins a turn: appends the user prompt and an empty assistant message (which subsequent
    /// events extend), clears any stale error, and returns the appended user message so the caller
    /// can persist it without relying on its position in ``messages``. Calling this while a turn is
    /// already in flight simply starts a fresh turn — the previous assistant row is left finalized.
    @discardableResult
    public mutating func beginTurn(userPrompt: String) -> ChatMessage {
        lastError = nil
        let userMessage = ChatMessage(role: .user, content: userPrompt)
        let assistantMessage = ChatMessage(role: .assistant, content: "")
        messages.append(userMessage)
        messages.append(assistantMessage)
        inFlightAssistantID = assistantMessage.id
        return userMessage
    }

    /// Ends the in-flight turn, clearing the in-flight marker. Returns the final assistant message
    /// (so the caller can persist it), or `nil` if no turn was in flight.
    @discardableResult
    public mutating func endTurn() -> ChatMessage? {
        defer { inFlightAssistantID = nil }
        guard let id = inFlightAssistantID else { return nil }
        return messages.first { $0.id == id }
    }

    /// Clears all rows and the in-flight marker for a fresh conversation. Leaves `lastUsage`
    /// intact (it reflects the last *completed* turn's telemetry, not in-flight state), and leaves
    /// `lastError` intact so a caller that resets after a failed turn can still inspect the reason.
    public mutating func reset() {
        messages = []
        inFlightAssistantID = nil
    }

    /// Appends an out-of-band row (an `.edit` from a successful apply, or an `.annotation`),
    /// preserving order without disturbing the in-flight assistant message.
    public mutating func append(_ message: ChatMessage) {
        messages.append(message)
    }

    /// Mutates the message with the given id in place, if present.
    public mutating func update(id: UUID, _ body: (inout ChatMessage) -> Void) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        body(&messages[idx])
    }

    /// Removes the message with the given id, returning it (for an optimistic-drop-then-restore
    /// flow). Returns `nil` if no message matched.
    @discardableResult
    public mutating func remove(id: UUID) -> ChatMessage? {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return nil }
        return messages.remove(at: idx)
    }

    /// Re-inserts a message at its chronological position (before the first row newer than it,
    /// else appended). Used to restore a row dropped optimistically when its async action fails.
    public mutating func insertByTimestamp(_ message: ChatMessage) {
        let idx = messages.firstIndex { $0.timestamp > message.timestamp } ?? messages.count
        messages.insert(message, at: idx)
    }

    /// Applies one streamed event to the in-flight assistant message. Events that arrive with no
    /// in-flight turn are dropped (mirrors `ChatModel`'s guard — e.g. a late event after `reset`).
    public mutating func apply(_ event: AssistantEvent) {
        guard let id = inFlightAssistantID, let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        switch event {
        case .started:
            // Surfaced as data only; no chat chrome.
            break

        case .textDelta(let text):
            messages[idx].content += text

        case .thinking:
            // Captured but not rendered — thinking blocks already stream to the Debug pane.
            break

        case .toolUse(let toolID, let name, let input):
            let display = Self.renderJSON(input)
            messages[idx].toolCalls.append(ChatToolCall(id: toolID, name: name, inputDisplay: display, result: nil, isError: false))

        case .toolResult(let toolID, let content, let isError):
            if let i = messages[idx].toolCalls.firstIndex(where: { $0.id == toolID }) {
                messages[idx].toolCalls[i].result = content
                messages[idx].toolCalls[i].isError = isError
            } else {
                // Result without a matching tool_use — happens if the agent crashed mid-turn and
                // resumed without the original tool_use. Surface it as an unbound tool call so the
                // user can still see what happened.
                messages[idx].toolCalls.append(ChatToolCall(id: toolID, name: "(unbound)", inputDisplay: "", result: content, isError: isError))
            }

        case .turnComplete(let usage):
            if let usage { lastUsage = usage }

        case .failed(let message):
            lastError = message
            messages.append(ChatMessage(role: .error, content: message))

        case .cancelled:
            messages.append(ChatMessage(role: .system, content: "Cancelled."))

        case .backendExited(let code):
            if code != 0 && code != -15 {
                let note = "\(providerName) backend exited with code \(code)"
                lastError = note
                messages.append(ChatMessage(role: .error, content: note))
            }

        case .citations(let items):
            guard !items.isEmpty else { break }
            messages.append(ChatMessage(
                role: .citation,
                content: "",
                citationMetadata: ChatCitationMetadata(citations: items)
            ))
        }
    }

    /// Compact, deterministic pretty-print of a `JSONValue` for the tool-call card. Single-line
    /// strings get displayed inline; objects/arrays get rendered with two-space indent so they
    /// don't blow up the chat layout when the tool input is large.
    public static func renderJSON(_ value: JSONValue) -> String {
        let raw = value.rawValue
        guard JSONSerialization.isValidJSONObject(raw) || raw is String || raw is NSNumber else {
            return String(describing: raw)
        }
        let opts: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys]
        if let data = try? JSONSerialization.data(withJSONObject: raw, options: opts),
           let string = String(data: data, encoding: .utf8) {
            return string
        }
        return String(describing: raw)
    }
}
