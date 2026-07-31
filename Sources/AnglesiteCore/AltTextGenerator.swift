import Foundation

// Gated to the Xcode-27 toolchain — `GeneratedAltText` is `@Generable` (FoundationModels), absent
// at runtime on CI (#128) — and to canImport for genuine off-Darwin portability (cross-platform
// port design §5). Same pattern as FoundationModelAssistant.swift / GenerableTypes.swift.
#if compiler(>=6.4) && canImport(FoundationModels)

/// Post-processes a successful image-drop edit by generating alt text with the on-device vision
/// model and applying it to the `<img>` (C.7, #157).
///
/// Wired as ``MCPApplyEditRouter``'s post-processor: after the plugin writes a dropped image and
/// returns `{ src, srcset }`, this resolves the written file, asks the model for a
/// ``GeneratedAltText``, and issues a follow-up `replace-attr` edit setting `alt` on the same
/// element (reusing the drop's `path`/`selector`). A decorative image gets `alt=""` plus
/// `role="presentation"`. Everything is best-effort: generation failures are logged and swallowed
/// so the original drop is never disturbed.
///
/// The vision call (`produce`) and the follow-up edit applier (`apply`) are injected, so the routing
/// logic is fully testable without a live model.
public struct AltTextGenerator: Sendable {
    /// Produces alt text for the image at `imageURL`. Production wraps
    /// `FoundationModelAssistant.generateStructured(prompt:imageURL:context:resultType:)`.
    public typealias Producer = @Sendable (_ imageURL: URL, _ context: AssistantContext) async throws -> GeneratedAltText
    /// Applies a follow-up edit (the generated `alt`/`role`). Production routes it through the
    /// per-site `apply_edit` MCP tool.
    public typealias Applier = @Sendable (_ edit: EditMessage) async -> Void

    private let siteID: String
    private let siteDirectory: URL
    private let isEnabled: @Sendable () -> Bool
    private let produce: Producer
    private let apply: Applier
    private let log: @Sendable (String) async -> Void

    /// Creates a generator for one site.
    ///
    /// `isEnabled` is a closure rather than a captured `Bool` so the owner's setting is re-read
    /// on every edit — toggling it takes effect immediately without rebuilding the edit pipeline.
    /// `log` defaults to a no-op because failures here are best-effort by design; production
    /// passes the debug-pane logger so swallowed errors still leave a trace ("logs are sacred").
    public init(
        siteID: String,
        siteDirectory: URL,
        isEnabled: @escaping @Sendable () -> Bool,
        produce: @escaping Producer,
        apply: @escaping Applier,
        log: @escaping @Sendable (String) async -> Void = { _ in }
    ) {
        self.siteID = siteID
        self.siteDirectory = siteDirectory
        self.isEnabled = isEnabled
        self.produce = produce
        self.apply = apply
        self.log = log
    }

    /// Runs after a successful `apply_edit`. No-ops unless the setting is on and the edit was an
    /// image drop (`replace-image-src`) that applied with a returned image `src`.
    public func postProcess(reply: EditReply, message: EditMessage) async {
        guard isEnabled(),
              message.op == EditMessage.Op.replaceImageSrc,
              reply.status == .applied,
              let src = reply.result?.src
        else { return }

        let context = AssistantContext(
            siteID: siteID,
            siteDirectory: siteDirectory,
            currentPageRoute: message.path,
            selectedElementSelector: message.selector
        )
        let alt: GeneratedAltText
        do {
            alt = try await produce(imageFileURL(forSrc: src), context)
        } catch {
            await log("alt-text generation failed for \(src): \(error)")
            return
        }

        // Decorative ⇒ empty alt + role="presentation"; otherwise the descriptive alt.
        await apply(attrEdit(name: "alt", value: alt.isDecorative ? "" : alt.altText, from: message))
        if alt.isDecorative {
            await apply(attrEdit(name: "role", value: "presentation", from: message))
        }
    }

    /// The plugin writes dropped images under `public/`, returning a site-relative `src` such as
    /// `/images/hero.webp`. Resolve it back to the on-disk file for the vision model to read.
    /// Covered by the `resolvesImagePath` test through `postProcess` (which captures the URL it
    /// passes to `produce`), so it needs no wider visibility.
    private func imageFileURL(forSrc src: String) -> URL {
        let relative = src.hasPrefix("/") ? String(src.dropFirst()) : src
        return siteDirectory
            .appendingPathComponent("public", isDirectory: true)
            .appendingPathComponent(relative)
    }

    /// A `replace-attr` edit on the same element as `message`. The plugin's patcher expects the
    /// value as `{ name, value }` (see `server/patcher.mjs`).
    private func attrEdit(name: String, value: String, from message: EditMessage) -> EditMessage {
        EditMessage(
            id: UUID().uuidString,
            type: .applyEdit,
            path: message.path,
            selector: message.selector,
            op: EditMessage.Op.replaceAttr,
            value: .object(["name": .string(name), "value": .string(value)])
        )
    }
}
#endif
