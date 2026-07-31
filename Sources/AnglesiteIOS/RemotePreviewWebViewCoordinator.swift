#if os(iOS)
import Foundation

/// Coordinator for `RemotePreviewWebView`: remembers the last URL actually loaded so
/// `updateUIView` can skip redundant reloads. Reference semantics are the point — SwiftUI
/// recreates the (value-type) representable freely, but the coordinator persists.
@MainActor
public final class RemotePreviewWebViewCoordinator {
    var loadedURL: URL?

    /// Public because `RemotePreviewWebView.makeCoordinator()` is public API and its return
    /// type must be constructible; carries no configuration.
    public init() {}
}
#endif
