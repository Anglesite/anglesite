import Foundation

/// Single source for the fixed-duration sleep that guards against macOS 27 beta's AppKit
/// constraint-update storm (#1126 class): coalescing an inspector/sheet dismissal transaction
/// with a following main-pane rebuild, toolbar re-layout, or inspector presentation into the
/// same synchronous step sends AppKit's layout engine into a runaway `-updateConstraints` loop
/// that hangs the window and then crashes the app. Giving the first transaction its own run-loop
/// turn before starting the second avoids it. Call sites: `SiteWindowModel
/// .clearInspectorThenSwitchPane`, `SiteWindowModel.openFile`'s post-pane-swap delay before the
/// Component Editor inspector presents (#1139), `SiteSearchFieldModifier.focusSearchField`, and
/// `SiteWindowModel.loadAndStart`'s dependency-sheet-to-scripts-sheet handoff.
///
/// ## Why this is still a fixed sleep, not a condition wait
///
/// #1155 asked whether a deterministic completion signal — tied to the actual AppKit
/// layout/constraint pass rather than a guessed duration — could replace this. Investigated and
/// ruled out for now:
///
/// - **`CATransaction.setCompletionBlock`**: fires once a Core Animation transaction's layer
///   changes (including any animations declared within it) have committed. But the crash-log
///   stack traces (#1126, #1139) show a runaway **Auto Layout** `-updateConstraints` cycle driven
///   by `NSWindow`'s own display pass, not a Core Animation transaction our code opens — there's
///   nothing for us to attach a completion block to that's guaranteed to enclose AppKit's internal
///   constraint pass.
/// - **`withAnimation(_:completionCriteria:completion:)`**: tracks completion of a SwiftUI
///   transaction *we* declare with an explicit animation. The state mutations at every call site
///   here (`inspectorContext = nil`, `inspectorPresented.wrappedValue = false`, …) are plain,
///   non-animated assignments — SwiftUI's `.inspector(isPresented:)` transition and the
///   corresponding AppKit split-view layout work are framework-internal, not something an
///   `withAnimation` block around our own mutation observes.
/// - **`NSWindow.didUpdateNotification`-based quiescence polling**: plausible in principle (wait
///   for N consecutive "window updated" passes with no further pending constraint invalidation,
///   capped by a timeout), but it needs a reference to the site window's `NSWindow`, which
///   `SiteWindowModel` and `SiteSearchFieldModifier` don't currently have — plumbing one through
///   would be new machinery in a crash-workaround path with no way to manually verify it against
///   the actual macOS 27 beta storm in this environment (headless: no windowed session to trigger
///   the AppKit layout race in). Swapping a working, empirically-tuned mitigation for an unverified
///   one risks reintroducing the crash. Worth revisiting with real hardware access; not attempted
///   here.
///
/// So the fix for #1155 is consolidation, not a new mechanism: one named duration and one call
/// site instead of four independent magic numbers that could drift out of sync.
enum AppKitConstraintStormMitigation {
    /// Empirically chosen (#1126/#1131/#1132/#1139) — long enough in practice to let AppKit's
    /// dismissal/layout transaction settle before the next state mutation triggers its own, short
    /// enough not to read as a stall. Not derived from a measured worst-case; see the type doc for
    /// why this isn't condition-based.
    static let settleDelay: Duration = .milliseconds(300)

    /// Suspends for `settleDelay`, giving a just-triggered AppKit transaction (inspector/sheet
    /// dismissal, pane rebuild) a run-loop turn to settle before the caller's next state mutation.
    /// Never throws — cancellation just ends the wait early, which is fine here since callers
    /// don't have follow-up cleanup contingent on the full delay elapsing.
    static func settle() async {
        try? await Task.sleep(for: settleDelay)
    }
}
