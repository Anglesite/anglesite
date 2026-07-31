import Foundation

/// Zoom-step policy for the live-preview web view (View ▸ Zoom In / Zoom Out / Actual Size, #514).
///
/// Pure and `AnglesiteCore`-scoped so it's unit-testable on CI — the app-target glue
/// (`PreviewModel`) applies the returned level to `WKWebView.pageZoom`. The detent ladder matches
/// Safari's page-zoom steps so the preview zooms the way users expect a browser to.
public enum PreviewZoom {
    /// The zoom detents, ascending. `actualSize` (1.0) is always a member.
    public static let levels: [Double] = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]

    /// The 100% detent — View ▸ Actual Size (⌘0).
    public static let actualSize: Double = 1.0

    /// The lowest detent — the floor `zoomOut(from:)` clamps to. Derived from ``levels`` so the
    /// ladder stays the single source of truth.
    public static var minimum: Double { levels[0] }

    /// The highest detent — the ceiling `zoomIn(from:)` clamps to. Derived from ``levels`` so the
    /// ladder stays the single source of truth.
    public static var maximum: Double { levels[levels.count - 1] }

    /// Comparison slop so a level reproduced through floating-point arithmetic still counts as
    /// "at" its detent instead of half a step away from it.
    private static let tolerance: Double = 0.001

    /// The next detent above `level`, clamped to `maximum`. An off-detent `level` snaps up to
    /// the nearest detent strictly above it.
    public static func zoomIn(from level: Double) -> Double {
        levels.first { $0 > level + tolerance } ?? maximum
    }

    /// The next detent below `level`, clamped to `minimum`. An off-detent `level` snaps down to
    /// the nearest detent strictly below it.
    public static func zoomOut(from level: Double) -> Double {
        levels.last { $0 < level - tolerance } ?? minimum
    }

    /// Whether View ▸ Zoom In should be enabled at `level` — `false` only at (or within
    /// floating-point tolerance of) ``maximum``, so the menu item disables exactly when
    /// ``zoomIn(from:)`` would be a no-op.
    public static func canZoomIn(from level: Double) -> Bool {
        level + tolerance < maximum
    }

    /// Whether View ▸ Zoom Out should be enabled at `level` — `false` only at (or within
    /// floating-point tolerance of) ``minimum``, so the menu item disables exactly when
    /// ``zoomOut(from:)`` would be a no-op.
    public static func canZoomOut(from level: Double) -> Bool {
        level - tolerance > minimum
    }
}
