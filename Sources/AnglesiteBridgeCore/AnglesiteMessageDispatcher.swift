import Foundation
import AnglesiteCore

/// Webview-agnostic message schema + routing for the `anglesite` script-message namespace
/// (cross-platform port design, docs/superpowers/specs/2026-07-08-cross-platform-swift-port-
/// design.md §6 "AnglesiteBridgeCore split"). Each platform's webview adapter (`WKWebView`
/// today; WebKitGTK/WebView2 later) forwards the raw decoded message body here and gets back a
/// `DispatchResult` describing what to do next — the adapter's only remaining job is shuttling
/// bytes in and out of its native webview API.
///
/// Four message types ride this bridge:
///
/// 1. `anglesite:apply-edit` (an `EditMessage`) — routed through the injected `EditRouter`; the
///    adapter delivers the reply back to the page (e.g. `window.anglesite?._handleReply?.(...)`
///    on WKWebView).
/// 2. `anglesite:visible-elements` (a `VisibleElementReport`, #145/B.1) — dispatched to the
///    optional `onVisibleElements` callback. No reply; the JS side doesn't await one.
/// 3. `anglesite:canvas-selection` (a `CanvasSelectionMessage`) — dispatched to the optional
///    `onCanvasSelection` callback. Posted by the component-harness canvas overlay
///    (`JS/edit-overlay/src/component-canvas.ts`) on click. No reply.
/// 4. `anglesite:computed-styles` (a `ComputedStylesReport`) — dispatched to the optional
///    `onComputedStyles` callback, posted alongside a canvas selection. No reply.
public enum AnglesiteMessageDispatcher {
    /// Receives the decoded elements of an `anglesite:visible-elements` report (message type 2
    /// above). Async so implementations can hop to their model's actor; no reply flows back.
    public typealias VisibleElementsHandler = @Sendable ([VisibleElement]) async -> Void
    /// Receives a decoded `anglesite:canvas-selection` message (message type 3 above).
    public typealias CanvasSelectionHandler = @Sendable (CanvasSelectionMessage) async -> Void
    /// Receives a decoded `anglesite:computed-styles` report (message type 4 above).
    public typealias ComputedStylesHandler = @Sendable (ComputedStylesReport) async -> Void

    /// The `WKUserContentController`/`WebKitUserContentManager`/WebView2 script-message name
    /// every platform adapter registers its handler under — the JS overlay posts messages here
    /// regardless of which native webview it's running in.
    public static let scriptMessageNamespace = "anglesite"

    /// Outcome of dispatching one incoming message body. The platform adapter reads this to
    /// decide whether to emit a reply or log a rejection.
    public enum DispatchResult: Sendable {
        /// `anglesite:apply-edit` succeeded; the adapter should emit the reply back to the page.
        case editReply(EditReply)
        /// `anglesite:visible-elements` was forwarded to the optional handler.
        case visibleElementsHandled
        /// `anglesite:visible-elements` arrived but no `onVisibleElements` handler is installed.
        /// Useful for tests; in production the wiring is checked at handler-init time.
        case visibleElementsDropped
        /// `anglesite:canvas-selection` was forwarded to the optional handler.
        case canvasSelectionHandled
        /// `anglesite:canvas-selection` arrived but no `onCanvasSelection` handler is installed.
        case canvasSelectionDropped
        /// `anglesite:computed-styles` was forwarded to the optional handler.
        case computedStylesHandled
        /// `anglesite:computed-styles` arrived but no `onComputedStyles` handler is installed.
        case computedStylesDropped
        /// Body was undecodable. Log and move on.
        case rejected(RejectionReason)

        /// Why a message body couldn't be dispatched. The envelope-level cases come first
        /// (the body never made it past the `type` peek); the `*Decode` cases carry the typed
        /// decoder error for a body whose `type` matched a known message.
        public enum RejectionReason: Sendable, Equatable {
            /// The body wasn't a dictionary at all.
            case notAnObject
            /// The body has no `type` field.
            case missingType
            /// The `type` field isn't a string.
            case wrongType
            /// The `type` string doesn't name any known message; carries the unrecognized value.
            case unknownType(String)
            /// `anglesite:apply-edit` matched but the payload failed `EditMessage.decode`.
            case editDecode(EditMessage.DecodeError)
            /// `anglesite:visible-elements` matched but the payload failed to decode.
            case visibleElementsDecode(VisibleElementReport.DecodeError)
            /// `anglesite:canvas-selection` matched but the payload failed to decode.
            case canvasSelectionDecode(ComponentCanvasDecodeError)
            /// `anglesite:computed-styles` matched but the payload failed to decode.
            case computedStylesDecode(ComponentCanvasDecodeError)
        }
    }

    /// Peek at the `type` field, dispatch to the matching decoder, and route. Pure — no I/O
    /// beyond the router call and the optional handler calls.
    public static func dispatch(
        body: Any,
        via router: EditRouter,
        onVisibleElements: VisibleElementsHandler? = nil,
        onCanvasSelection: CanvasSelectionHandler? = nil,
        onComputedStyles: ComputedStylesHandler? = nil
    ) async -> DispatchResult {
        guard let dict = body as? [String: Any] else { return .rejected(.notAnObject) }
        guard let rawType = dict["type"] else { return .rejected(.missingType) }
        guard let typeStr = rawType as? String else { return .rejected(.wrongType) }

        switch typeStr {
        case EditMessage.MessageType.applyEdit.rawValue:
            switch EditMessage.decode(from: body) {
            case .success(let message):
                let reply = await router.apply(message)
                return .editReply(reply)
            case .failure(let error):
                return .rejected(.editDecode(error))
            }

        case VisibleElementReport.messageType:
            switch VisibleElementReport.decode(from: body) {
            case .success(let report):
                guard let handler = onVisibleElements else { return .visibleElementsDropped }
                await handler(report.elements)
                return .visibleElementsHandled
            case .failure(let error):
                return .rejected(.visibleElementsDecode(error))
            }

        case CanvasSelectionMessage.messageType:
            switch CanvasSelectionMessage.decode(from: body) {
            case .success(let message):
                guard let handler = onCanvasSelection else { return .canvasSelectionDropped }
                await handler(message)
                return .canvasSelectionHandled
            case .failure(let error):
                return .rejected(.canvasSelectionDecode(error))
            }

        case ComputedStylesReport.messageType:
            switch ComputedStylesReport.decode(from: body) {
            case .success(let report):
                guard let handler = onComputedStyles else { return .computedStylesDropped }
                await handler(report)
                return .computedStylesHandled
            case .failure(let error):
                return .rejected(.computedStylesDecode(error))
            }

        default:
            return .rejected(.unknownType(typeStr))
        }
    }
}
