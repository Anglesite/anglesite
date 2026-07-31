import Foundation

/// Seam for App Intents (and any future system entry point — system MCP per #101)
/// to call site operations without binding to the concrete `SiteOperations` type.
///
/// `SiteOperations` is the production conformance. Tests register a fake conforming type
/// with `AppDependencyManager.shared` to drive intent suites; see the AnglesiteIntents
/// test target.
public protocol SiteOperationsService: Sendable {
    /// Resolves a site id (as carried by `SiteEntity`) to the registry's site, or `nil` when it
    /// is unknown — the intent's "site not found" path.
    func site(id: String) async -> SiteStore.Site?
    /// Deploys the site. Never throws: failures arrive as the result's own `.failed` case so
    /// intents map exactly one result type to dialog.
    func deploy(site: SiteStore.Site, onProgress: ProgressHandler?) async -> DeployCommand.Result
    /// Backs up the site, with the same never-throws result contract as `deploy`.
    func backup(site: SiteStore.Site, onProgress: ProgressHandler?) async -> BackupCommand.Result
    /// Audits the site, with the same never-throws result contract as `deploy`.
    func audit(site: SiteStore.Site, onProgress: ProgressHandler?) async -> AuditCommand.Result
    /// Provisions the V-2 social starter workers for the site; no progress hook, matching the
    /// underlying command (see ``SiteOperations``).
    func provisionSocialWorker(site: SiteStore.Site) async -> SocialWorkerProvisionCommand.Result
}

public extension SiteOperationsService {
    /// Progress-free convenience for callers with no progress UI; forwards `onProgress: nil`.
    func deploy(site: SiteStore.Site) async -> DeployCommand.Result { await deploy(site: site, onProgress: nil) }
    /// Progress-free convenience for callers with no progress UI; forwards `onProgress: nil`.
    func backup(site: SiteStore.Site) async -> BackupCommand.Result { await backup(site: site, onProgress: nil) }
    /// Progress-free convenience for callers with no progress UI; forwards `onProgress: nil`.
    func audit(site: SiteStore.Site) async -> AuditCommand.Result { await audit(site: site, onProgress: nil) }
}

extension SiteOperations: SiteOperationsService {}
