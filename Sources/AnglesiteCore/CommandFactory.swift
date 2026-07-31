import Foundation

/// Constructs the deterministic command actors the App Intents wrap. The live implementation
/// returns the real zero-arg actors; tests inject a fake whose actors are built with the
/// actors' existing closure seams to return canned `Result`s (see `SiteOperationsTests`).
public protocol CommandFactory: Sendable {
    /// A fresh ``DeployCommand`` for one deploy invocation.
    func deploy() -> DeployCommand
    /// A fresh ``BackupCommand`` for one backup invocation.
    func backup() -> BackupCommand
    /// A fresh ``AuditCommand`` for one security-audit invocation.
    func audit() -> AuditCommand
    /// A fresh ``SocialWorkerProvisionCommand`` for one social-worker provisioning run.
    func socialWorkerProvision() -> SocialWorkerProvisionCommand
}

/// Production ``CommandFactory``: returns the real zero-arg command actors with their default
/// (live) dependencies. Intents resolve this unless a test injects a canned-result factory.
public struct LiveCommandFactory: CommandFactory {
    /// Stateless — nothing to configure; the commands wire their own live dependencies.
    public init() {}
    /// Returns a live ``DeployCommand``.
    public func deploy() -> DeployCommand { DeployCommand() }
    /// Returns a live ``BackupCommand``.
    public func backup() -> BackupCommand { BackupCommand() }
    /// Returns a live ``AuditCommand``.
    public func audit() -> AuditCommand { AuditCommand() }
    /// Returns a live ``SocialWorkerProvisionCommand``.
    public func socialWorkerProvision() -> SocialWorkerProvisionCommand { SocialWorkerProvisionCommand() }
}
