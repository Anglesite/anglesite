import Foundation

/// Fetches a component's structured model from the plugin's
/// `get_component_model` MCP tool.
public struct ComponentModelClient: Sendable {
    /// Injection seam matching ``MCPClient/callTool(name:arguments:)``'s shape, so tests can
    /// feed canned tool results without a live MCP connection.
    public typealias ToolCaller = @Sendable (_ name: String, _ arguments: JSONValue) async throws -> MCPClient.ToolCallResult

    private let toolCaller: ToolCaller

    /// Production initializer. Takes a *provider* closure rather than a client because the MCP
    /// connection comes up asynchronously after the site's runtime starts — resolving it per
    /// call means a fetch made before the connection exists fails cleanly with
    /// ``ModelError/notConnected`` instead of pinning a stale (or nil-forever) client at
    /// construction time.
    public init(mcpClient: @escaping @Sendable () async -> MCPClient?) {
        self.toolCaller = { name, args in
            guard let client = await mcpClient() else { throw ModelError.notConnected }
            return try await client.callTool(name: name, arguments: args)
        }
    }

    /// Test seam.
    public init(toolCaller: @escaping ToolCaller) {
        self.toolCaller = toolCaller
    }

    /// Failures from ``fetch(path:)``, kept `Equatable` and reason-coded so the editor model
    /// can pick per-failure UI (banner vs. Source-tab degradation) via ``friendlyMessage``.
    public enum ModelError: Error, Equatable {
        /// The client provider returned no live MCP connection — the site runtime isn't up yet
        /// (or went away), so no tool call was attempted at all.
        case notConnected
        /// The tool ran but reported an error result. `reason` is the plugin's machine-readable
        /// code (`"parse-failed"`, `"read-failed"`, `"invalid-input"`, `"internal-error"`) from
        /// its `anglesite:component-model-failed` envelope; `"unknown"` if the tool result
        /// didn't decode as that envelope at all. `detail` is the plugin's human-readable
        /// message.
        case toolFailed(reason: String, detail: String)
        /// The tool succeeded but its payload didn't decode as ``ComponentModel`` — an
        /// app/plugin schema mismatch, which is why ``friendlyMessage`` suggests updating the
        /// bundled plugin.
        case decodeFailed(String)
    }

    /// Wire shape of `get_component_model`'s error content: `{type, reason, detail}`.
    private struct FailureEnvelope: Decodable {
        let reason: String
        let detail: String
    }

    /// Fetches the structured model for the component at project-relative `path` (e.g.
    /// `src/components/Card.astro`). Joins all text content blocks before decoding, and decodes
    /// the plugin's failure envelope on error results so callers get a reason-coded
    /// ``ModelError/toolFailed(reason:detail:)`` rather than an opaque string.
    ///
    /// - Throws: ``ModelError``.
    public func fetch(path: String) async throws -> ComponentModel {
        let result = try await toolCaller("get_component_model", .object(["path": .string(path)]))
        let text = result.content.compactMap(\.text).joined(separator: "\n")
        guard !result.isError else {
            if let data = text.data(using: .utf8),
               let envelope = try? JSONDecoder().decode(FailureEnvelope.self, from: data) {
                throw ModelError.toolFailed(reason: envelope.reason, detail: envelope.detail)
            }
            throw ModelError.toolFailed(reason: "unknown", detail: text)
        }
        guard let data = text.data(using: .utf8) else { throw ModelError.decodeFailed("non-utf8 payload") }
        do {
            return try JSONDecoder().decode(ComponentModel.self, from: data)
        } catch {
            throw ModelError.decodeFailed(String(describing: error))
        }
    }
}

extension ComponentModelClient.ModelError {
    /// User-facing summary for `ComponentEditorModel.loadError`. Parse failures carry the
    /// compiler's own diagnostic through as-is (spec §5: shown in a banner, editor degrades to
    /// the Source tab); other reasons get a short, reason-specific sentence instead of a raw
    /// Swift error dump.
    public var friendlyMessage: String {
        switch self {
        case .notConnected:
            return "Site is not running yet."
        case .toolFailed(let reason, let detail):
            switch reason {
            case "parse-failed": return detail
            case "read-failed": return "Couldn't read this component file: \(detail)"
            case "invalid-input": return detail
            default: return "Something went wrong loading this component: \(detail)"
            }
        case .decodeFailed:
            return "Anglesite couldn't understand the component model returned by the plugin. Try updating the bundled plugin."
        }
    }
}
