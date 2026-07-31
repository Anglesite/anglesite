import AnglesiteCore

/// Test-only escape hatch around `@Dependency` resolution.
///
/// `@Dependency` is gated by the AppIntents runtime to its own "intent perform flow."
/// Direct `intent.perform()` calls from a unit test (where there's no `intentsd` /
/// registered-app context) crash with a fatal error from `AppDependencyManager`.
/// The proper macOS 27 `AppIntentsTesting` framework requires a foregrounded,
/// registered app bundle to operate — not viable under `swift test` even with an
/// XCTest host (#104 covers this finding).
///
/// Tests set this `@TaskLocal` to a fake `SiteOperationsService` before invoking
/// `intent.perform()`; the intent's `perform()` reads `Self.scoped ?? self.ops` so
/// the `@Dependency` lookup is bypassed entirely when a scoped value is present.
/// In production the override is always `nil` and the intent resolves through
/// `@Dependency` as designed.
public enum SiteOperationsOverride {
    /// The task-scoped fake. Always `nil` in production; when bound, intents skip both
    /// `@Dependency` resolution and `requestConfirmation` (no UI surface under `swift test`).
    @TaskLocal public static var scoped: (any SiteOperationsService)?
}
