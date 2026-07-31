import Foundation
import WebKit
import AnglesiteCore
import AnglesiteBridgeCore

/// `WKScriptMessageHandler` adapter for the `anglesite` namespace — the WKWebView-specific thin
/// layer over `AnglesiteMessageDispatcher` (cross-platform port design §6 "AnglesiteBridgeCore
/// split"). All the message schema, decoding, and routing logic lives in the portable core; this
/// class's own job is exactly two things `WKScriptMessage` requires: unwrap `message.body`/
/// `.webView`, and evaluate the reply script back into the page.
///
/// **API change vs prior versions:** the primary entry point is now
/// `dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)` (forwarding to
/// `AnglesiteMessageDispatcher.dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)`).
/// All current callers are internal to this repo (the `WKScriptMessageHandler` impl below, the
/// unit tests — now in `AnglesiteBridgeCoreTests`, testing `AnglesiteMessageDispatcher` directly
/// — and `PreviewView`'s production init) and use `dispatch` directly. The old `handle(body:via:)`
/// signature is kept as a `@available(*, deprecated)` shim below — apply-edit only, matching its
/// prior behavior — so a downstream framework consumer hitting this gets a fix-it instead of a
/// cryptic missing-member error. The migration is mechanical: rename `handle` → `dispatch`, pass
/// `nil` for the optional handlers to preserve the apply-edit-only behavior, and match on the
/// richer `DispatchResult` enum instead of `Result<EditReply, EditMessage.DecodeError>`.
public final class AnglesiteScriptHandler: NSObject, WKScriptMessageHandler {
    // Re-exported dispatcher types, so call sites written against this class before the
    // AnglesiteBridgeCore split (`AnglesiteScriptHandler.DispatchResult` etc.) keep compiling
    // without importing the core module themselves.

    /// Callback for `anglesite:visible-elements` reports (see `AnglesiteMessageDispatcher`).
    public typealias VisibleElementsHandler = AnglesiteMessageDispatcher.VisibleElementsHandler
    /// Callback for `anglesite:canvas-selection` messages (see `AnglesiteMessageDispatcher`).
    public typealias CanvasSelectionHandler = AnglesiteMessageDispatcher.CanvasSelectionHandler
    /// Callback for `anglesite:computed-styles` reports (see `AnglesiteMessageDispatcher`).
    public typealias ComputedStylesHandler = AnglesiteMessageDispatcher.ComputedStylesHandler
    /// Outcome of dispatching one message body (see `AnglesiteMessageDispatcher.DispatchResult`).
    public typealias DispatchResult = AnglesiteMessageDispatcher.DispatchResult

    private let router: EditRouter
    private let onVisibleElements: VisibleElementsHandler?
    private let onCanvasSelection: CanvasSelectionHandler?
    private let onComputedStyles: ComputedStylesHandler?
    private let logCenter: LogCenter

    /// - Parameters:
    ///   - router: Applies decoded `anglesite:apply-edit` messages and produces the reply the
    ///     handler evaluates back into the page.
    ///   - onVisibleElements: Optional callback for `anglesite:visible-elements` reports; `nil`
    ///     means those messages are dropped (logged as such by the dispatcher's result).
    ///   - onCanvasSelection: Optional callback for `anglesite:canvas-selection` messages.
    ///   - onComputedStyles: Optional callback for `anglesite:computed-styles` reports.
    ///   - logCenter: Destination for rejection/drop diagnostics — injectable for tests.
    public init(
        router: EditRouter,
        onVisibleElements: VisibleElementsHandler? = nil,
        onCanvasSelection: CanvasSelectionHandler? = nil,
        onComputedStyles: ComputedStylesHandler? = nil,
        logCenter: LogCenter = .shared
    ) {
        self.router = router
        self.onVisibleElements = onVisibleElements
        self.onCanvasSelection = onCanvasSelection
        self.onComputedStyles = onComputedStyles
        self.logCenter = logCenter
        super.init()
    }

    /// Forwards to `AnglesiteMessageDispatcher.dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)`
    /// — kept here so existing call sites (this class's own `userContentController`, and any
    /// code written against the pre-split API) don't need to change.
    public static func dispatch(
        body: Any,
        via router: EditRouter,
        onVisibleElements: VisibleElementsHandler? = nil,
        onCanvasSelection: CanvasSelectionHandler? = nil,
        onComputedStyles: ComputedStylesHandler? = nil
    ) async -> DispatchResult {
        await AnglesiteMessageDispatcher.dispatch(
            body: body,
            via: router,
            onVisibleElements: onVisibleElements,
            onCanvasSelection: onCanvasSelection,
            onComputedStyles: onComputedStyles
        )
    }

    /// Deprecated forwarder for the old `handle(body:via:)` signature so out-of-tree adopters
    /// get a fix-it instead of a cryptic missing-member error. Always passes `nil` for
    /// `onVisibleElements`, matching the prior behavior (apply-edit only). Returns the same
    /// `Result<EditReply, EditMessage.DecodeError>` shape callers were already matching on —
    /// rejection reasons map back into the legacy decode-error type.
    @available(*, deprecated, renamed: "dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)",
               message: "handle() is apply-edit only and returns a less expressive shape. Use dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:) — it covers visible-elements/canvas-selection/computed-styles routing too and exposes the richer DispatchResult.")
    public static func handle(body: Any, via router: EditRouter) async -> Result<EditReply, EditMessage.DecodeError> {
        switch await dispatch(body: body, via: router, onVisibleElements: nil) {
        case .editReply(let reply):
            return .success(reply)
        case .rejected(.editDecode(let error)):
            return .failure(error)
        case .rejected(.notAnObject):
            return .failure(.notAnObject)
        case .rejected(.missingType):
            return .failure(.missingField("type"))
        case .rejected(.wrongType):
            return .failure(.wrongType(field: "type", expected: "string"))
        case .rejected(.unknownType(let s)):
            return .failure(.unknownType(s))
        case .rejected(.visibleElementsDecode):
            // Unreachable under `handle`'s contract (apply-edit only). Bubble up as
            // unknown-type rather than crash; deprecated path, callers should migrate.
            return .failure(.unknownType(VisibleElementReport.messageType))
        case .rejected(.canvasSelectionDecode):
            // Unreachable under `handle`'s contract (apply-edit only). Same fallthrough.
            return .failure(.unknownType(CanvasSelectionMessage.messageType))
        case .rejected(.computedStylesDecode):
            // Unreachable under `handle`'s contract (apply-edit only). Same fallthrough.
            return .failure(.unknownType(ComputedStylesReport.messageType))
        case .visibleElementsHandled, .visibleElementsDropped:
            // Unreachable: handler is nil. Same fallthrough as above.
            return .failure(.unknownType(VisibleElementReport.messageType))
        case .canvasSelectionHandled, .canvasSelectionDropped:
            // Unreachable: handler is nil. Same fallthrough as above.
            return .failure(.unknownType(CanvasSelectionMessage.messageType))
        case .computedStylesHandled, .computedStylesDropped:
            // Unreachable: handler is nil. Same fallthrough as above.
            return .failure(.unknownType(ComputedStylesReport.messageType))
        }
    }

    /// `WKScriptMessageHandler` entry point: filters to the `anglesite` namespace, dispatches the
    /// raw body off the main thread, and evaluates any edit reply back into the page via
    /// `message.webView`. Non-reply outcomes (drops, rejections) are logged, never surfaced to
    /// the page — the JS overlay only awaits apply-edit replies.
    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == WebViewBridge.scriptMessageNamespace else { return }
        let body = message.body
        let webView = message.webView
        let router = self.router
        let onVisibleElements = self.onVisibleElements
        let onCanvasSelection = self.onCanvasSelection
        let onComputedStyles = self.onComputedStyles
        let logCenter = self.logCenter
        Task {
            switch await Self.dispatch(
                body: body,
                via: router,
                onVisibleElements: onVisibleElements,
                onCanvasSelection: onCanvasSelection,
                onComputedStyles: onComputedStyles
            ) {
            case .editReply(let reply):
                guard let webView else { return }
                guard let data = try? JSONEncoder().encode(reply),
                      let json = String(data: data, encoding: .utf8)
                else {
                    await logCenter.append(source: "bridge", stream: .stderr, text: "failed to encode reply for id=\(reply.id)")
                    return
                }
                let script = "window.anglesite?._handleReply?.(\(json))"
                await MainActor.run {
                    webView.evaluateJavaScript(script)
                }
            case .visibleElementsHandled:
                return
            case .visibleElementsDropped:
                // A visible-elements message arrived but no `onVisibleElements` handler is
                // installed. Production wiring (PreviewView with an annotationProvider)
                // always installs one; reaching here implies a regression. Log so the wiring
                // failure is observable rather than silently swallowing all Siri reports.
                await logCenter.append(
                    source: "bridge",
                    stream: .stderr,
                    text: "visible-elements message dropped: no handler installed (provider not threaded through PreviewView?)"
                )
            case .canvasSelectionHandled:
                return
            case .canvasSelectionDropped:
                await logCenter.append(
                    source: "bridge",
                    stream: .stderr,
                    text: "canvas-selection message dropped: no handler installed"
                )
            case .computedStylesHandled:
                return
            case .computedStylesDropped:
                await logCenter.append(
                    source: "bridge",
                    stream: .stderr,
                    text: "computed-styles message dropped: no handler installed"
                )
            case .rejected(let reason):
                await logCenter.append(
                    source: "bridge",
                    stream: .stderr,
                    text: "rejected message: \(reason)"
                )
            }
        }
    }
}
