import Foundation

/// One user-registered connection to an ACP (Agent Client Protocol) agent — Zed's JSON-RPC
/// protocol for editor<->agent communication. Non-secret fields only; a `.remote` connection's
/// bearer token lives in `SecretStore` under `SecretAccounts.acpAgentToken(id:)`, keyed by `id`.
public struct ACPAgentConnection: Codable, Identifiable, Sendable, Equatable {
    /// Stable identity — also the Keychain key for a `.remote` connection's bearer token
    /// (`SecretAccounts.acpAgentToken(id:)`), so it must survive renames and transport edits;
    /// only deleting the connection retires it.
    public let id: UUID
    /// Owner-chosen display name. Surfaced as the assistant's `providerName` in chat, so it's
    /// how the owner tells which agent is answering.
    public var name: String
    /// How the app reaches this agent — see `Transport` for the consequences of each choice.
    public var transport: Transport

    /// The two ways an ACP agent can be reached. The choice also decides which filesystem the
    /// agent sees: a `.stdio` agent works on the container's clone of the site, a `.remote`
    /// agent only on paths meaningful to its own host — see `ACPAssistant`'s working-directory
    /// note.
    public enum Transport: Codable, Sendable, Equatable {
        /// Launched inside the open site's container, alongside the dev server and MCP sidecar.
        case stdio(command: String, arguments: [String])
        /// Reached over the network; the bearer token (if any) is stored separately in Keychain.
        case remote(url: URL)
    }

    /// Memberwise init. Pass a fresh `UUID` for a new connection; reuse the existing `id` when
    /// editing one, since it keys the stored bearer token (see `id`).
    public init(id: UUID, name: String, transport: Transport) {
        self.id = id
        self.name = name
        self.transport = transport
    }
}
