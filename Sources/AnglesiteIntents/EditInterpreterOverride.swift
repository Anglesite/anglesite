import AnglesiteCore

/// Test seam: inject a fake `EditInterpreting` so `perform` doesn't touch the on-device model.
public enum EditInterpreterOverride {
    /// The injected fake interpreter, or `nil` in production (where ``EditContentIntent``
    /// falls through to its `@Dependency`-resolved interpreter). Task-local so parallel tests
    /// can each bind their own fake without racing on shared mutable state.
    @TaskLocal public static var scoped: (any EditInterpreting)?
}
