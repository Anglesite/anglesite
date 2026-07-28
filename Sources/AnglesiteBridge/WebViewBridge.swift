import Foundation
import WebKit
import AnglesiteCore
import AnglesiteBridgeCore

/// Bridges the WKWebView preview to the native edit pipeline.
///
/// Phase 4 step 1 ships the WKWebView configuration tuned for previewing a local Astro dev server.
/// Step 2 (#16) registers the `anglesite` `WKScriptMessageHandler` on this same configuration to
/// receive edit messages from the injected JS overlay.
public enum WebViewBridge {
    /// The script-message namespace, shared with every platform adapter — see
    /// `AnglesiteMessageDispatcher.scriptMessageNamespace`.
    public static let scriptMessageNamespace = AnglesiteMessageDispatcher.scriptMessageNamespace

    /// A `WKWebViewConfiguration` tuned for previewing a local Astro dev server. In Debug builds it
    /// uses a non-persistent data store so nothing is cached between launches (the dev server moves
    /// fast); in Release it uses the default store. When `handler` is provided it is registered on
    /// the user-content controller under the `anglesite` namespace — that's the JS → native channel
    /// for edit messages from the overlay. The overlay bundle (`edit-overlay/overlay.js`) is
    /// injected via `WKUserScript` at `atDocumentEnd` when present; missing bundle is non-fatal —
    /// the preview just loads without edit affordances. The configuration is also opted into the
    /// full inline Writing Tools experience (#91, see `enableWritingTools`) so Apple Intelligence's
    /// rewrite / proofread / tone / summarize popover is offered in editable Keystatic prose fields.
    ///
    /// `@MainActor` because every WebKit type touched here (`WKWebViewConfiguration`,
    /// `WKUserContentController`, `WKWebsiteDataStore`, `WKUserScript`) is main-actor isolated
    /// in modern SDKs. This matches the existing call sites: SwiftUI view bodies and the
    /// `WKScriptMessageHandler` delegate, both of which are already on the main actor.
    @MainActor
    public static func localDevConfiguration(handler: WKScriptMessageHandler? = nil, bundle: Bundle = .main) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        #if DEBUG
        config.websiteDataStore = .nonPersistent()
        #endif
        enableWritingTools(on: config)
        if let handler {
            config.userContentController.add(handler, name: scriptMessageNamespace)
        }
        if let script = makeOverlayUserScript(in: bundle) {
            config.userContentController.addUserScript(script)
        }
        return config
    }

    /// Loads the bundled edit overlay (built by `scripts/build-overlay.sh`) as a `WKUserScript`,
    /// or returns `nil` when the bundle hasn't been produced (e.g. `swift test`, or a build where
    /// the prebuild script was skipped). The lookup + read is shared with every platform adapter
    /// via `AnglesiteOverlayBundle`; only the `WKUserScript` wrapping is WKWebView-specific.
    @MainActor
    public static func makeOverlayUserScript(in bundle: Bundle = .main) -> WKUserScript? {
        guard let source = AnglesiteOverlayBundle.source(in: bundle) else { return nil }
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
    }

    /// Reads `url` and wraps it as a `WKUserScript` at `atDocumentEnd`. Returns `nil` on read
    /// failure. Public so it's testable with a real file path independent of any `Bundle`.
    @MainActor
    public static func makeOverlayUserScript(from url: URL) -> WKUserScript? {
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
    }

    /// Per-instance defaults that aren't expressible on the configuration. Opts the preview into
    /// Safari's Develop-menu inspection in all build configurations through public WebKit API.
    @MainActor
    public static func applyPreviewDefaults(to webView: WKWebView) {
        webView.isInspectable = true
    }

    /// The cookie name the in-container auth-proxy expects (design 2026-06-23 §4).
    public static let sessionTokenCookieName = "session_token"

    /// Injects the session token as an HttpOnly, Secure cookie into a `WKHTTPCookieStore` so the
    /// `WKWebView` carries it on every request (including WebSocket upgrades for HMR) to the
    /// tunneled auth-proxy. Call this before loading the preview URL.
    @MainActor
    public static func injectSessionToken(
        into cookieStore: WKHTTPCookieStore,
        token: SessionToken,
        for domain: String
    ) async {
        let properties: [HTTPCookiePropertyKey: Any] = [
            .name: sessionTokenCookieName,
            .value: token.value,
            .domain: domain,
            .path: "/",
            .secure: "TRUE",
            HTTPCookiePropertyKey("HttpOnly"): true,
        ]
        guard let cookie = HTTPCookie(properties: properties) else {
            assertionFailure("Failed to create session token cookie for domain \(domain)")
            return
        }
        await cookieStore.setCookie(cookie)
    }

    /// Opt the preview into the full inline Writing Tools experience (#91).
    ///
    /// Writing Tools is Apple Intelligence's on-device / Private Cloud Compute rewrite engine —
    /// rewrite, proofread, tone shift (friendly / professional / concise), and summarize, all with
    /// **zero** external API / LLM token cost. WebKit surfaces the system popover natively for
    /// *editable* web content (`contenteditable` / `<input>` / `<textarea>`): when the overlay
    /// promotes a Keystatic prose element to `contentEditable = "true"` (see `overlay.ts`'s
    /// click-to-edit), selecting text inside it offers the popover. The rewrite is applied **inline
    /// to the DOM**, so it flows back through the existing pipeline unchanged — the overlay's
    /// blur-time `replace-text` `apply-edit` captures the rewritten `textContent`, routes it through
    /// `MCPApplyEditRouter` → the plugin's `apply_edit` tool, and lands as a single undoable commit.
    /// No new message type is needed.
    ///
    /// On macOS the behavior is a **configuration** property (`WKWebViewConfiguration`, settable
    /// before the web view is created), not a `WKWebView` instance property — `WKWebView` only
    /// exposes the read-only `isWritingToolsActive`. `.complete` selects the full inline experience;
    /// the WebKit default is `.limited` (a panel-only fallback), so this opt-in is required to get
    /// the inline popover. The setting is macOS-only for Anglesite's current WebKit usage, so the
    /// shared bridge gates it at compile time and leaves the future iOS `UIViewRepresentable`
    /// preview on WebKit's platform default. On a Mac without Apple Intelligence this is a safe
    /// no-op: WebKit simply never offers the affordance.
    @MainActor
    public static func enableWritingTools(on configuration: WKWebViewConfiguration) {
        #if os(macOS)
        configuration.writingToolsBehavior = .complete
        #endif
    }
}
