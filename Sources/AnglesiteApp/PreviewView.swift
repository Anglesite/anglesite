import SwiftUI
import AppKit
import WebKit
import AppIntents
import AnglesiteBridge
import AnglesiteCore
import AnglesiteIntents

/// SwiftUI wrapper around a `WKWebView` showing the live Astro dev server.
///
/// `url` is owned by the caller (a `PreviewModel` driven by a `SiteRuntime`). When it changes —
/// e.g. a supervised dev-server restart rebinds a new port — the web view reloads from the new URL.
///
/// `router` is the `EditRouter` the in-page overlay's `AnglesiteScriptHandler` forwards edits to.
/// In production it's the `MCPApplyEditRouter` from `PreviewModel`, wrapping the session's
/// `MCPClient`; tests can substitute any `EditRouter`.
///
/// `annotationProvider` is the per-window `PreviewAnnotationProvider` (Siri AI Phase B). When
/// supplied, the script handler routes `anglesite:visible-elements` messages into it, and the
/// WKWebView gets an `appEntityUIElementProvider` so AppKit's hit-test resolves visible regions
/// to live entities. Nil → those features are inert (overlay still works for hover/click/drop).
struct PreviewView: NSViewRepresentable {
    let url: URL
    let router: EditRouter
    let annotationProvider: PreviewAnnotationProvider?

    /// Called with the `WKWebView` once it's created, so the owning `PreviewModel` can hold a weak
    /// reference and drive the View-menu preview commands (reload/history/zoom).
    /// Defaults to a no-op for callers (e.g. tests) that don't need it.
    var onWebView: (WKWebView) -> Void = { _ in }

    /// Called with the `WKWebView` when SwiftUI tears this view down (`dismantleNSView`) — e.g. a
    /// dev-server restart or failure switches `previewPane` away from the `.ready` branch. The
    /// owning `PreviewModel` needs this explicit signal: its `webView` reference is weak, and ARC
    /// zeroing a weak var does NOT fire `didSet`, so without it the model's KVO-fed
    /// `canGoBack`/`canGoForward` mirrors would freeze at their last values (#546 review).
    /// Defaults to a no-op for callers that don't track the web view.
    var onWebViewDismantled: (WKWebView) -> Void = { _ in }

    func makeNSView(context: Context) -> WKWebView {
        let onVisibleElements: AnglesiteScriptHandler.VisibleElementsHandler? = annotationProvider.map { provider in
            // `provider` is `@MainActor`, so the implicit hop happens at the `update(_:)` call.
            // Captured strongly: the handler is owned by the WKWebView, which is owned by
            // SwiftUI's NSViewRepresentable lifecycle; the provider is owned by SiteWindow's
            // `@State`, which outlives the WKWebView. The closure becomes unreachable when the
            // WKWebView is torn down, releasing the strong reference.
            { @Sendable elements in await provider.update(elements) }
        }
        let handler = AnglesiteScriptHandler(router: router, onVisibleElements: onVisibleElements)
        let configuration = WebViewBridge.localDevConfiguration(handler: handler)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        WebViewBridge.applyPreviewDefaults(to: webView)
        if let annotationProvider {
            webView.appEntityUIElementProvider = { [weak annotationProvider] _, hitContext in
                guard let annotationProvider else { return [] }
                return annotationProvider.uiElements(for: hitContext)
            }
        }
        webView.load(URLRequest(url: url))
        context.coordinator.loadedURL = url
        // Stashed on the coordinator because `dismantleNSView` is static — it has no access to
        // this instance's closures at teardown time.
        context.coordinator.onDismantle = onWebViewDismantled
        onWebView(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onDismantle = onWebViewDismantled
        guard context.coordinator.loadedURL != url else { return }
        context.coordinator.loadedURL = url
        webView.load(URLRequest(url: url))
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.onDismantle?(webView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedURL: URL?
        var onDismantle: ((WKWebView) -> Void)?
    }
}
