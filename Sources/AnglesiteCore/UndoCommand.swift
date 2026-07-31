import Foundation

/// Typed wrapper around the plugin's `undo_edit` MCP tool.
///
/// `undo(commit:force:)` returns an `UndoResult` enum that surfaces the three meaningful
/// outcomes — success with the new branch SHA, conflict with the drifted file list, and
/// generic failure with a reason+detail pair. The chat panel presents a warn-and-confirm
/// sheet on `.workingTreeModified` and retries with `force: true` if the owner confirms.
public struct UndoCommand: Sendable {
    /// The tool-call seam: `(toolName, arguments) → result`. Injectable so tests exercise the
    /// reply-parsing logic without a live MCP connection.
    public typealias Caller = @Sendable (_ name: String, _ arguments: JSONValue) async throws -> MCPClient.ToolCallResult

    /// The three outcomes the chat panel actually branches on — anything the server reports that
    /// isn't a success or a working-tree conflict collapses into `.failed`.
    public enum UndoResult: Sendable, Equatable {
        /// The undo landed; `newCommit` is the branch's new head SHA, which becomes the anchor for
        /// the next undo.
        case success(newCommit: String)
        /// The working tree has uncommitted drift in `files` — the caller warns the owner and may
        /// retry with `force: true` to discard it.
        case workingTreeModified(files: [String])
        /// Any other failure (transport error, malformed reply, or a server-reported reason).
        case failed(reason: String, detail: String)
    }

    private let caller: Caller

    /// Test hookup — inject a fake ``Caller`` to script the server's replies.
    public init(caller: @escaping Caller) {
        self.caller = caller
    }

    /// Production hookup — bind to a getter for the currently-active `MCPClient`. The chat
    /// view's Undo button calls this with the commit SHA of the head edit row.
    public init(mcpClient: @escaping @Sendable () async -> MCPClient?) {
        self.caller = { name, args in
            guard let client = await mcpClient() else { throw MCPClient.MCPError.notInitialized }
            return try await client.callTool(name: name, arguments: args)
        }
    }

    /// Asks the plugin to undo the edit at `commit`, classifying the JSON reply into an
    /// ``UndoResult``. Never throws — every failure mode (including a transport error or a reply
    /// that isn't valid JSON) is folded into `.failed` so the UI has exactly one error path.
    public func undo(commit: String, force: Bool) async -> UndoResult {
        let args: JSONValue = .object([
            "commit": .string(commit),
            "force": .bool(force),
        ])
        let result: MCPClient.ToolCallResult
        do {
            result = try await caller("undo_edit", args)
        } catch {
            return .failed(reason: "mcp-error", detail: error.localizedDescription)
        }
        let text = result.content.compactMap(\.text).joined(separator: "\n")
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .failed(reason: "malformed-reply", detail: text.isEmpty ? "no content" : text)
        }
        let status = json["status"] as? String ?? "unknown"
        if status == "undone", let newCommit = json["newCommit"] as? String {
            return .success(newCommit: newCommit)
        }
        let reason = json["reason"] as? String ?? "unknown"
        if reason == "working-tree-modified" {
            let files = (json["files"] as? [String]) ?? []
            return .workingTreeModified(files: files)
        }
        let detail = (json["detail"] as? String) ?? text
        return .failed(reason: reason, detail: detail)
    }
}
