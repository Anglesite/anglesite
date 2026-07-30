import SwiftUI
import AnglesiteCore

private struct FocusedPreviewKey: FocusedValueKey { typealias Value = PreviewModel }

extension FocusedValues {
    /// The focused site window's `PreviewModel`, published by `SiteWindow`. Lets View-menu commands
    /// reach the live preview without owning it.
    var preview: PreviewModel? {
        get { self[FocusedPreviewKey.self] }
        set { self[FocusedPreviewKey.self] = newValue }
    }
}

/// Browser-style View-menu commands for the live preview (#514): Reload Preview ⌘R, Back ⌃⌘← / Forward ⌃⌘→, and page zoom (Actual Size ⌘0, Zoom In ⌘+, Zoom Out ⌘−).
///
/// Reads the focused site window's `PreviewModel` through the `\.preview` focused value above.
/// Everything is disabled until that window's preview web view exists
/// (the dev server has become ready at least once); Back/Forward additionally track the web view's
/// history via the model's KVO-fed `canGoBack`/`canGoForward` mirrors, and the zoom items pin at
/// the `PreviewZoom` detent-ladder bounds. All actions no-op safely if the weak web view has
/// already been torn down.
struct PreviewNavigationCommands: Commands {
    @FocusedValue(\.preview) private var focusedPreview

    var body: some Commands {
        CommandGroup(after: .toolbar) {
            Button("Reload Preview") {
                focusedPreview?.reloadPreview()
            }
            .keyboardShortcut("r")
            .disabled(focusedPreview?.hasWebView != true)

            // ⌃⌘←/⌃⌘→ — Xcode's navigation-history keys. ⌘[/⌘] are reserved for
            // Format ▸ Text indent per the macOS editor convention (menu-bar spec §3).
            Button("Back") {
                focusedPreview?.goBack()
            }
            .keyboardShortcut(.leftArrow, modifiers: [.command, .control])
            .disabled(focusedPreview?.canGoBack != true)

            Button("Forward") {
                focusedPreview?.goForward()
            }
            .keyboardShortcut(.rightArrow, modifiers: [.command, .control])
            .disabled(focusedPreview?.canGoForward != true)

            Divider()

            Button("Actual Size") {
                focusedPreview?.zoomActualSize()
            }
            .keyboardShortcut("0")
            .disabled(focusedPreview?.hasWebView != true || focusedPreview?.zoomLevel == PreviewZoom.actualSize)

            Button("Zoom In") {
                focusedPreview?.zoomIn()
            }
            // KeyEquivalent "+" — macOS menu matching also accepts the unshifted ⌘= chord for it,
            // matching Safari/Xcode behavior.
            .keyboardShortcut("+")
            .disabled(focusedPreview?.hasWebView != true || focusedPreview?.canZoomIn != true)

            Button("Zoom Out") {
                focusedPreview?.zoomOut()
            }
            .keyboardShortcut("-")
            .disabled(focusedPreview?.hasWebView != true || focusedPreview?.canZoomOut != true)

            Divider()
        }
    }
}
