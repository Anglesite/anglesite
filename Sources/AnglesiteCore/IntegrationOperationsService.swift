// Sources/AnglesiteCore/IntegrationOperationsService.swift
import Foundation

/// The seam between integration front-doors (wizard UI, intents) and the plan/apply machinery.
/// A protocol rather than the concrete ``IntegrationOperations`` so callers can be tested
/// against a stub that never resolves real sites or touches the filesystem.
public protocol IntegrationOperationsService: Sendable {
    /// The catalog of installable integrations, for pickers.
    func descriptors() -> [IntegrationDescriptor]
    /// Resolves a descriptor plus the wizard's answers into a reviewable ``OperationPlan``,
    /// without writing anything. Async because some integrations resolve external facts at plan
    /// time (greenHostCheck's Green Web Foundation lookup).
    func plan(integrationID: IntegrationID, answers: Answers, siteID: String) async -> Result<OperationPlan, IntegrationError>
    /// Applies a previously reviewed plan to the site, returning the terminal step (`.done` or
    /// `.failed`) for the UI to surface.
    func apply(_ plan: OperationPlan, siteID: String) async -> IntegrationScaffolder.SetupStep
}

// FileManager is documented thread-safe for the shared `.default` singleton; wrap it in
// @unchecked Sendable so it can be stored in a Sendable struct and passed across isolation
// boundaries without suppressing the warning at every call-site.
private struct SendableFileManager: @unchecked Sendable {
    let value: FileManager
}

/// The production ``IntegrationOperationsService``: resolves the site's `Source/` directory and
/// the template root through injected closures, folds plan-time external checks (greenHostCheck)
/// into the answers before planning, and delegates the actual writes to ``IntegrationScaffolder``.
public struct IntegrationOperations: IntegrationOperationsService {
    private let sourceDirectory: @Sendable (String) async -> URL?
    private let templateDirectory: @Sendable () -> URL?
    private let scaffolder: IntegrationScaffolder
    private let fm: SendableFileManager
    private let greenHostChecker: any GreenHostChecking

    /// Creates a service with fully injectable seams: site and template resolution are closures
    /// (rather than `SiteStore`/`TemplateRuntime` directly) so tests can run against temp
    /// directories, and the `GreenHostChecking` dependency is injectable so the greenHostCheck
    /// flow never hits the real API in tests. Production callers should use ``live()``.
    public init(sourceDirectory: @escaping @Sendable (String) async -> URL?,
                templateDirectory: @escaping @Sendable () -> URL?,
                fileManager: FileManager = .default,
                greenHostChecker: any GreenHostChecking = GreenHostChecker()) {
        self.sourceDirectory = sourceDirectory
        self.templateDirectory = templateDirectory
        self.fm = SendableFileManager(value: fileManager)
        self.greenHostChecker = greenHostChecker
        // Wrap in SendableFileManager to cross the actor-init isolation boundary cleanly.
        let sfm = SendableFileManager(value: fileManager)
        self.scaffolder = IntegrationScaffolder(fileManager: sfm.value)
    }

    /// Forwards to ``IntegrationCatalog/all`` — the catalog is static data, so there is no
    /// per-site filtering to do here.
    public func descriptors() -> [IntegrationDescriptor] { IntegrationCatalog.all }

    /// Plans an integration against the resolved site. For `.greenHostCheck` the answers are
    /// computed here first — the deploy host is resolved and checked against the Green Web
    /// Foundation — and a "not green" result is deliberately *not* a failure: the check
    /// succeeded, the badge just isn't offered, so it surfaces as a plan warning the review
    /// step renders (issue #684).
    public func plan(integrationID: IntegrationID, answers: Answers, siteID: String) async -> Result<OperationPlan, IntegrationError> {
        guard let source = await sourceDirectory(siteID) else { return .failure(.siteNotFound) }
        guard let template = templateDirectory() else { return .failure(.templateUnavailable) }

        var resolvedAnswers = answers
        if integrationID == .greenHostCheck {
            guard let siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: source),
                  let hostname = URL(string: siteURL)?.host else {
                return .failure(.deployRequired)
            }
            switch await greenHostChecker.check(hostname: hostname) {
            case .success(let result):
                resolvedAnswers["green"] = result == .green ? "true" : "false"
                resolvedAnswers["hostname"] = hostname
                resolvedAnswers["checkedAt"] = ISO8601DateFormatter().string(from: Date())
            case .failure(.network):
                return .failure(.externalCheckFailed(
                    "Couldn't reach the Green Web Foundation to check your host. Check your connection and try again."))
            case .failure(.unavailable(let message)):
                return .failure(.externalCheckFailed(message))
            }
        }

        let result = IntegrationPlanner.plan(descriptor: IntegrationCatalog.descriptor(for: integrationID),
                                             answers: resolvedAnswers, sourceDirectory: source, templateDirectory: template,
                                             fileManager: fm.value)
        guard integrationID == .greenHostCheck, resolvedAnswers["green"] == "false",
              case .success(let plan) = result else {
            return result
        }
        // A "not green" result isn't a failure — the check succeeded, the badge just isn't
        // offered (issue #684 point 3). Surface the explanation as a plan warning, which the
        // existing review step already renders (same mechanism as brandColor/siteName fallbacks).
        return .success(OperationPlan(
            integrationID: plan.integrationID,
            steps: plan.steps,
            warnings: plan.warnings + [PlanWarning(
                "The Green Web Foundation didn't find \(resolvedAnswers["hostname"] ?? "your host") in its green hosting " +
                "directory, so no badge will show. If this is unexpected, check " +
                "https://www.thegreenwebfoundation.org/directory/ or your host's own sustainability page — your host " +
                "may need to register, or this may be a different domain than the one that's certified.")]))
    }

    /// Applies the plan via ``IntegrationScaffolder``, consuming its progress stream and
    /// returning only the terminal step — intermediate progress is the scaffolder stream's
    /// concern; front-doors that call through this seam just need the outcome.
    public func apply(_ plan: OperationPlan, siteID: String) async -> IntegrationScaffolder.SetupStep {
        guard let source = await sourceDirectory(siteID) else {
            return .failed(step: "resolve", message: "Couldn't find that site.")
        }
        var terminal: IntegrationScaffolder.SetupStep? = nil
        for await s in scaffolder.apply(plan, in: source) {
            if case .done = s { terminal = s }
            if case .failed = s { terminal = s }
        }
        return terminal ?? .failed(step: "apply", message: "No steps ran.")
    }
}

public extension IntegrationOperations {
    /// The production instance: resolves a site id to its `Source/` dir via `SiteStore.shared`
    /// and the template root via `TemplateRuntime`. Single construction path for every front-door.
    static func live() -> IntegrationOperations {
        IntegrationOperations(
            sourceDirectory: { id in await SiteStore.shared.find(id: id)?.sourceDirectory },
            templateDirectory: { TemplateRuntime.resolve().url }
        )
    }
}
