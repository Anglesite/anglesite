import AnglesiteCore

/// Test-only escape hatch around `@Dependency` resolution of `ThemeCatalog`, mirroring
/// `ContentOperationsOverride`. `@Dependency` is gated to the AppIntents perform flow; direct
/// `intent.perform()` calls from unit tests crash without it. Tests bind this `@TaskLocal` to a
/// fake catalog before invoking `ApplyThemeIntent`, which reads
/// `ThemeCatalogOverride.scoped ?? self.catalog`, so production flows through `@Dependency`.
public enum ThemeCatalogOverride {
    /// The task-scoped fake catalog. Always `nil` in production; a bound value also signals
    /// "under test" to ``ApplyThemeIntent``, which then skips its `requestConfirmation` gate.
    @TaskLocal public static var scoped: ThemeCatalog?
}
