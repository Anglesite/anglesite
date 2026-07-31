import AnglesiteCore

/// Test-only escape hatch around `@Dependency` resolution of `DomainOperationsService`,
/// mirroring `IntegrationOperationsOverride`. Tests bind this `@TaskLocal` to a fake service
/// before invoking the domain intents; the intents read `DomainOperationsOverride.scoped ?? self.ops`,
/// so production flows through `@Dependency`.
public enum DomainOperationsOverride {
    /// The injected fake service, or `nil` in production. Task-local (not a plain static) so
    /// parallel tests can each bind their own fake without racing on shared mutable state.
    @TaskLocal public static var scoped: (any DomainOperationsService)?
}
