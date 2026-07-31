import Foundation

// Same toolchain/runtime gate as `ContentAssistant.swift` — `Generable` (used only by the
// `generateStructured` conformance below) comes from FoundationModels, which is absent from
// GitHub's macos-15 CI runner at *load* time even when the SDK has the symbol at compile time.
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
#endif

/// `ConversationalAssistant` backed by an ACP agent connection (`ACPAgentConnection`). Constructed
/// synchronously (matching `FoundationModelAssistant`'s init) — the actual transport/handshake
/// happens lazily on first `converse`/`generate`, so building this assistant never blocks on a
/// container being up or a network round trip.
///
/// Proof-of-concept scope (ACP agent settings design spec §4.4): implements enough (`session/new`
/// + single-turn prompt/response) to make "switch which model answers chat" real. No multi-turn
/// tool-permission UI yet — `ACPClient` auto-declines any `session/request_permission`.
public actor ACPAssistant: ConversationalAssistant {
    /// Supplies the site's *current* container control, or `nil` when no container is running.
    /// A closure rather than a captured value because the container comes and goes with the
    /// preview lifecycle — it's resolved at connect time (first turn), not at init.
    public typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    /// Failures reaching the agent at all, as opposed to protocol-level errors once connected
    /// (those are `ACPClient.ACPError`).
    public enum ACPAssistantError: Error, Sendable, Equatable {
        /// A `.stdio` connection is active but no container is currently running for this site
        /// (e.g. the preview hasn't finished starting yet).
        case containerUnavailable
    }

    private let connection: ACPAgentConnection
    private let siteID: String
    private let sourceDirectory: URL
    private let makeTransport: @Sendable () async throws -> any ACPTransport

    private var client: ACPClient?
    private var sessionID: String?

    // No production call site ever called `client?.stop()` — every ACP-backed chat session leaked
    // its reader task, and for `.stdio` connections, the long-lived in-container `execInteractive`
    // guest process, for the life of the app. `cancel()` only cancels the current *turn*
    // (`session/cancel`, a notification) and deliberately leaves the client connected so a
    // follow-up message in the same session keeps working — neither it nor `resetSession()` is the
    // right place to tear the whole client down. Instead, tear down whenever this assistant itself
    // is deallocated (site window closed, or the active backend switched away from this agent,
    // both of which drop the last reference to this actor): `client` here is a plain reference to
    // another actor, so capturing it (not `self`) is safe to do synchronously in `deinit` and hand
    // to a detached `Task` for its async teardown.
    deinit {
        if let client {
            Task { await client.stop() }
        }
    }

    /// Creates the assistant without connecting anything — transport construction and the ACP
    /// handshake are deferred to the first turn (see the type doc).
    ///
    /// - Parameters:
    ///   - connection: the agent's transport coordinates (stdio command or remote endpoint) —
    ///     which transport gets built on the first turn follows from its `transport` case.
    ///   - siteID: the site whose container a `.stdio` agent execs into; also scopes secrets.
    ///   - sourceDirectory: the site's host `Source/` directory, exposed to the agent as its
    ///     working context.
    ///   - containerControlProvider: consulted per connection attempt for `.stdio` transports.
    ///     The default ("no container") makes a `.stdio` turn fail with
    ///     `ACPAssistantError.containerUnavailable` rather than hang.
    ///   - secretStore: where a `.remote` connection's bearer token is read from, keyed by
    ///     `connection.id`. A read failure degrades to an unauthenticated request — the remote
    ///     agent rejects it if a token was actually required.
    ///   - transportFactory: test seam. When set it replaces the production transport selection
    ///     entirely, and `containerControlProvider`/`secretStore` go unused.
    public init(
        connection: ACPAgentConnection,
        siteID: String,
        sourceDirectory: URL,
        containerControlProvider: @escaping ContainerControlProvider = { nil },
        secretStore: any SecretStore = PlatformSecretStore.make(),
        transportFactory: (@Sendable () async throws -> any ACPTransport)? = nil
    ) {
        self.connection = connection
        self.siteID = siteID
        self.sourceDirectory = sourceDirectory
        if let transportFactory {
            self.makeTransport = transportFactory
        } else {
            self.makeTransport = {
                switch connection.transport {
                case .stdio(let command, let arguments):
                    guard let snapshot = await containerControlProvider() else {
                        throw ACPAssistantError.containerUnavailable
                    }
                    return ACPContainerExecTransport(
                        control: snapshot.control, siteID: snapshot.siteID,
                        command: command, arguments: arguments
                    )
                case .remote(let url):
                    let token = try? secretStore.readACPAgentToken(id: connection.id)
                    return ACPHTTPTransport(endpoint: url, bearerToken: token.map { SessionToken(value: $0) })
                }
            }
        }
    }

    /// Static, connection-independent capabilities: streaming and tools yes (ACP agents call
    /// tools mid-turn, surfaced as `.toolUse`/`.toolResult` events), structured output no —
    /// guided generation is FoundationModels-only. `providerName` echoes the owner-chosen
    /// connection name so chat shows which agent is answering.
    public nonisolated var capabilities: AssistantCapabilities {
        AssistantCapabilities(
            supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false,
            supportsTools: true, maxContextTokens: nil, providerName: connection.name
        )
    }

    /// `ContentAssistant`'s plain-text path, implemented by flattening ``converse(prompt:context:)``'s
    /// event stream: only `.textDelta` text survives, `.failed` becomes a thrown
    /// `AssistantError.streamFailed`, and tool/thinking events are dropped — callers that need
    /// those use `converse` directly.
    public func generate(prompt: String, context: AssistantContext) async throws -> AsyncThrowingStream<String, Error> {
        let events = try await converse(prompt: prompt, context: context)
        return AsyncThrowingStream { continuation in
            Task {
                for await event in events {
                    switch event {
                    case .textDelta(let text): continuation.yield(text)
                    case .failed(let message): continuation.finish(throwing: AssistantError.streamFailed(message)); return
                    case .turnComplete, .backendExited: continuation.finish(); return
                    default: break
                    }
                }
                continuation.finish()
            }
        }
    }

    #if compiler(>=6.4) && canImport(FoundationModels)
    /// Always throws `AssistantError.unsupported`: guided generation is defined by
    /// FoundationModels' `Generable` machinery, which an external ACP agent can't participate
    /// in. Declared only under the same toolchain gate as the protocol requirement it satisfies
    /// (see the gate note at the top of this file).
    public func generateStructured<T: Generable & Sendable>(prompt: String, context: AssistantContext, resultType: T.Type) async throws -> T {
        throw AssistantError.unsupported("ACP agents do not support FoundationModels guided generation")
    }
    #endif

    /// Streams one conversational turn. The first call performs the lazy connect — transport
    /// construction, ACP `initialize`, `session/new` — and later calls reuse both, so the agent
    /// keeps conversation context across turns. Throws (rather than yielding `.failed`) only
    /// for setup problems (no container for a `.stdio` connection, handshake failure), per
    /// `ConversationalAssistant`'s contract.
    public func converse(prompt: String, context: AssistantContext) async throws -> AsyncStream<AssistantEvent> {
        let client = try await connectedClient()
        let sessionID = try await ensureSession(client: client)
        return try await client.sendPrompt(sessionID: sessionID, text: prompt)
    }

    /// `session/new`'s `cwd` means different filesystems depending on transport: a `.stdio` agent
    /// runs inside the site's container, where the repo is always cloned to the fixed guest path
    /// `/workspace/site` (matches `DeployExecutor`'s convention); a `.remote` agent runs wherever
    /// its own host is, where the only filesystem path that means anything to it is the one on
    /// THIS Mac — `sourceDirectory`.
    private var effectiveWorkingDirectory: String {
        switch connection.transport {
        case .stdio: return "/workspace/site"
        case .remote: return sourceDirectory.path
        }
    }

    /// Cancels the current turn via `session/cancel` — and only the turn: the client and its
    /// transport deliberately stay connected so a follow-up message in the same session keeps
    /// working. Full teardown happens in `deinit` (see the note there). No-op before the first
    /// turn ever starts.
    public func cancel() async {
        guard let client, let sessionID else { return }
        await client.cancelSession(sessionID: sessionID)
    }

    /// Drops the session id so the next ``converse(prompt:context:)`` starts a fresh
    /// `session/new`. The connected client/transport is kept — only the agent-side conversation
    /// context is discarded.
    public func resetSession() async {
        sessionID = nil
    }

    private func connectedClient() async throws -> ACPClient {
        if let client { return client }
        let transport = try await makeTransport()
        let newClient = ACPClient(transport: transport)
        try await newClient.initialize()
        client = newClient
        return newClient
    }

    private func ensureSession(client: ACPClient) async throws -> String {
        if let sessionID { return sessionID }
        let newSessionID = try await client.newSession(cwd: effectiveWorkingDirectory)
        sessionID = newSessionID
        return newSessionID
    }
}
