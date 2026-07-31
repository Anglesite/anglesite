import Foundation

/// `EditRouter` backed by an `MCPClient` `tools/call` to the plugin's `apply_edit` tool.
///
/// Parses the plugin's structured reply body — `{ type, id, file, range, commit, result? }` —
/// out of the MCP tool's `content[0].text` JSON string into typed Swift properties on
/// `EditReply`. Falls back gracefully to the original "stuff the text in `message`" behavior
/// when the body isn't valid JSON (e.g. older plugins, or `apply_edit` impls that don't emit
/// the structured body).
///
/// `onEdit` fires after every successful `.applied` reply with a non-nil `commit` — wired by
/// `SiteWindow` to `ChatModel.recordEdit(_:)` so the chat panel surfaces each edit as a row.
public struct MCPApplyEditRouter: EditRouter {
    /// The seam that performs the MCP `tools/call`. Production binds it to
    /// ``MCPClient/callTool(name:arguments:)``; tests inject a fake so the router's mapping
    /// logic runs without a live MCP server.
    public typealias ToolCaller = @Sendable (_ name: String, _ arguments: JSONValue) async throws -> MCPClient.ToolCallResult
    /// Synchronous hook fired only for `.applied` replies carrying a `commit` (see the type
    /// doc — `SiteWindow` wires it to `ChatModel.recordEdit(_:)`). Contrast ``PostProcessor``,
    /// which fires for every applied edit, commit or not.
    public typealias EditObserver = @Sendable (EditReply) -> Void
    /// Persists a successful runtime edit into the canonical site repository. Unlike
    /// ``PostProcessor``, this hook is awaited before the applied reply is returned: acknowledging
    /// the overlay before `Source/` is durable would recreate #718's close-window data-loss race.
    public typealias EditPersister = @Sendable (EditReply) async throws -> Void
    /// Async hook fired (fire-and-forget) when an edit is `.applied`, with both the reply and the
    /// originating message. Used by the app to run on-device alt-text generation for image drops
    /// (C.7 / `AltTextGenerator`) without coupling this router to FoundationModels. It runs detached
    /// so the overlay's reply isn't blocked on the (multi-second) follow-up work.
    ///
    /// Unlike ``EditObserver`` (`onEdit`), which requires a `commit`, this fires for *every* applied
    /// edit — including non-git sites where `commit` is nil — because alt-text post-processing should
    /// run whenever the image actually landed, committed or not. It never fires for `.failed` /
    /// `.ambiguous` replies (those return before this point).
    public typealias PostProcessor = @Sendable (_ reply: EditReply, _ message: EditMessage) async -> Void

    private let toolCaller: ToolCaller
    private let onEdit: EditObserver?
    private let persistEdit: EditPersister?
    private let postProcess: PostProcessor?

    /// Test seam — inject a closure that mimics `MCPClient.callTool` so the router's mapping
    /// logic is verifiable without a live MCP server.
    public init(
        toolCaller: @escaping ToolCaller,
        onEdit: EditObserver? = nil,
        persistEdit: EditPersister? = nil,
        postProcess: PostProcessor? = nil
    ) {
        self.toolCaller = toolCaller
        self.onEdit = onEdit
        self.persistEdit = persistEdit
        self.postProcess = postProcess
    }

    /// Production hookup: bind to a getter for the currently-active `MCPClient`. Returns
    /// `.failed("MCP not running")` via a thrown `notInitialized` when the getter is `nil`.
    public init(
        mcpClient: @escaping @Sendable () async -> MCPClient?,
        onEdit: EditObserver? = nil,
        persistEdit: EditPersister? = nil,
        postProcess: PostProcessor? = nil
    ) {
        self.toolCaller = { name, args in
            guard let client = await mcpClient() else { throw MCPClient.MCPError.notInitialized }
            return try await client.callTool(name: name, arguments: args)
        }
        self.onEdit = onEdit
        self.persistEdit = persistEdit
        self.postProcess = postProcess
    }

    /// Sends `message` as an `apply_edit` tool call and maps every outcome — preview, applied,
    /// failed, cancelled, or thrown — into an `EditReply`; this never throws, so the overlay
    /// always gets a reply to render. Hook ordering is the load-bearing part: `persistEdit` is
    /// awaited *before* the applied reply is returned (see ``EditPersister`` for why), and a
    /// persistence failure downgrades the reply to `.failed` with `commit` nil; `onEdit` fires
    /// only after persistence succeeded; `postProcess` is detached entirely.
    public func apply(_ message: EditMessage) async -> EditReply {
        // Pre-call cancellation checkpoint. In production this is belt-and-suspenders — the real
        // `toolCaller` routes through `MCPClient.callTool`, which checks cancellation itself and
        // throws `CancellationError` (handled by the catch below). It's load-bearing only for the
        // test seam, where a fake `toolCaller` with no cancellation awareness is injected; this
        // guard is then the single checkpoint that turns a pre-call cancel into a "canceled" reply.
        if Task.isCancelled {
            return EditReply(id: message.id, status: .failed, message: "canceled")
        }
        let args = message.jsonValue
        do {
            let result = try await toolCaller("apply_edit", args)
            let text = result.content.compactMap(\.text).joined(separator: "\n")
            let trimmed = text.isEmpty ? nil : text
            if let preview = Self.parsePreview(text) {
                return EditReply(id: message.id, status: .preview, message: nil,
                                 file: preview.file, before: preview.before, after: preview.after, op: preview.op)
            }
            let parsed = Self.parseStructured(text)
            if result.isError {
                return EditReply(
                    id: message.id,
                    status: .failed,
                    message: trimmed,
                    file: parsed?.file,
                    commit: parsed?.commit,
                    result: parsed?.result,
                    model: parsed?.model,
                    reason: parsed?.reason
                )
            }
            let reply = EditReply(
                id: message.id,
                status: .applied,
                message: trimmed,
                file: parsed?.file,
                commit: parsed?.commit,
                result: parsed?.result,
                model: parsed?.model,
                newFile: parsed?.newFile
            )
            if let persistEdit {
                do {
                    try await persistEdit(reply)
                } catch {
                    return EditReply(
                        id: message.id,
                        status: .failed,
                        message: "The edit changed the preview but couldn't be saved to Source: \(error.localizedDescription)",
                        file: reply.file,
                        // Not persisted, so nil rather than reply.commit — a consumer keying off
                        // `commit != nil` instead of `status` must not read this as landed.
                        commit: nil,
                        result: reply.result,
                        model: reply.model,
                        newFile: reply.newFile
                    )
                }
            }
            if reply.commit != nil { onEdit?(reply) }
            // Fire-and-forget so the overlay gets its reply immediately; alt-text generation and the
            // follow-up edit land a moment later (see `AltTextGenerator`).
            if let postProcess {
                Task { await postProcess(reply, message) }
            }
            return reply
        } catch is CancellationError {
            return EditReply(id: message.id, status: .failed, message: "canceled")
        } catch {
            return EditReply(id: message.id, status: .failed, message: "\(error)")
        }
    }

    struct PreviewParsed: Equatable {
        let file: String?
        let op: String?
        let before: String
        let after: String
    }

    /// Parses an `anglesite:edit-preview` JSON body from the MCP tool's content text. Returns
    /// `nil` when the body is not a valid preview response.
    static func parsePreview(_ text: String) -> PreviewParsed? {
        guard !text.isEmpty,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (json["type"] as? String) == "anglesite:edit-preview",
              let before = json["before"] as? String,
              let after = json["after"] as? String
        else { return nil }
        return PreviewParsed(file: json["file"] as? String, op: json["op"] as? String, before: before, after: after)
    }

    /// Parses the plugin's edit-applied/edit-failed JSON body out of the MCP tool's content
    /// text. Returns `nil` for non-JSON content (the router falls back to the message-string
    /// behavior in that case).
    static func parseStructured(_ text: String) -> Parsed? {
        guard !text.isEmpty,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let file = json["file"] as? String
        let commit = json["commit"] as? String
        // The `result` key carries `replace-image-src`'s `{ src, srcset? }`.
        var image: EditReply.ImageResult?
        if let resultDict = json["result"] as? [String: Any], let src = resultDict["src"] as? String {
            let srcset = resultDict["srcset"] as? String
            image = EditReply.ImageResult(src: src, srcset: srcset)
        }
        // `extract-component` reports the brand-new file it created as a plain top-level string
        // (`newFile`), a sibling of `file`/`commit` — NOT nested under `result` (that op has no
        // `result` object at all).
        let newFile = json["newFile"] as? String
        var model: ComponentModel?
        if let modelDict = json["model"],
           let modelData = try? JSONSerialization.data(withJSONObject: modelDict) {
            model = try? JSONDecoder().decode(ComponentModel.self, from: modelData)
        }
        // Present on `anglesite:edit-failed` bodies (e.g. "stale", "no-match", "invalid-input") —
        // the machine-readable counterpart to the free-form `detail` prose folded into `message`.
        let reason = json["reason"] as? String
        if file == nil && commit == nil && image == nil && newFile == nil && model == nil && reason == nil { return nil }
        return Parsed(file: file, commit: commit, result: image, newFile: newFile, model: model, reason: reason)
    }

    struct Parsed: Equatable {
        let file: String?
        let commit: String?
        let result: EditReply.ImageResult?
        let newFile: String?
        let model: ComponentModel?
        let reason: String?
    }
}
