import Foundation
import Observation
import AnglesiteCore

/// Drives the Email Setup wizard (#769): walks the owner through
/// `EmailSetupPlanner`'s Apple-first decision tree, reconciles the resulting DNS plan against
/// any SPF record the zone already has, and applies it via `EmailSetupExecutor`. Fresh-per-open,
/// same lifecycle as `CopyEditReportModel`/`SocialPlanModel` — not a persistent zone-editing
/// model like `DomainModel`.
@Observable @MainActor
final class EmailSetupModel: Identifiable {
    let id = UUID()
    let siteID: String
    let sourceDirectory: URL

    enum Step {
        case ecosystem
        case appleTier
        /// Recommendation shown, owner fills in domain + DMARC report address and can switch to
        /// an alternative provider before building the plan.
        case details
        case buildingPlan
        case review(plan: EmailSetupPlanner.DNSPlan, spfWasMerged: Bool)
        case applying
        case result(EmailSetupExecutor.Result)
    }

    private(set) var step: Step = .ecosystem
    private var ecosystem: EmailSetupPlanner.Ecosystem?
    var appleTier: EmailSetupPlanner.AppleTier = .personal
    var domain: String
    var dmarcReportEmail: String = ""
    private(set) var recommendation: EmailSetupPlanner.Recommendation?
    var selectedProvider: EmailSetupPlanner.Provider?

    private let ops: any DomainOperationsService
    private var inFlight: Task<Void, Never>?

    /// `domain` prefills from the site's declared `anglesite.json` hostname (empty if none yet);
    /// the owner can still edit it before building a plan.
    init(
        siteID: String, sourceDirectory: URL, domain: String,
        ops: any DomainOperationsService = DomainOperations()
    ) {
        self.siteID = siteID
        self.sourceDirectory = sourceDirectory
        self.domain = domain
        self.ops = ops
    }

    var isRunning: Bool {
        switch step {
        case .buildingPlan, .applying: return true
        default: return false
        }
    }

    var availableProviders: [EmailSetupPlanner.Provider] {
        guard let recommendation else { return [] }
        return [recommendation.provider] + recommendation.alternatives
    }

    func choose(ecosystem: EmailSetupPlanner.Ecosystem) {
        self.ecosystem = ecosystem
        switch ecosystem {
        case .apple:
            step = .appleTier
        case .mixedOrOther:
            recommendation = EmailSetupPlanner.recommend(ecosystem: .mixedOrOther)
            selectedProvider = recommendation?.provider
            step = .details
        }
    }

    func choose(appleTier: EmailSetupPlanner.AppleTier) {
        self.appleTier = appleTier
        recommendation = EmailSetupPlanner.recommend(ecosystem: .apple, appleTier: appleTier)
        selectedProvider = recommendation?.provider
        step = .details
    }

    func selectProvider(_ provider: EmailSetupPlanner.Provider) {
        selectedProvider = provider
    }

    /// Backs up one step from `.details`/`.appleTier` — mirrors a wizard's Back button rather
    /// than dismissing outright.
    func back() {
        switch step {
        case .appleTier:
            step = .ecosystem
        case .details:
            step = ecosystem == .apple ? .appleTier : .ecosystem
        default:
            break
        }
    }

    func buildPlan() {
        guard let provider = selectedProvider, !isRunning else { return }
        let trimmedDomain = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let trimmedEmail = dmarcReportEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDomain.isEmpty, !trimmedEmail.isEmpty else { return }
        inFlight?.cancel()
        domain = trimmedDomain
        dmarcReportEmail = trimmedEmail
        inFlight = Task { @MainActor [weak self] in
            await self?.runBuildPlan(provider: provider, domain: trimmedDomain, dmarcReportEmail: trimmedEmail)
        }
    }

    func apply() {
        guard case .review(let plan, _) = step, !isRunning else { return }
        let domain = self.domain
        let dmarcReportEmail = self.dmarcReportEmail
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runApply(plan: plan, domain: domain, dmarcReportEmail: dmarcReportEmail)
        }
    }

    // MARK: - Private

    private func runBuildPlan(provider: EmailSetupPlanner.Provider, domain: String, dmarcReportEmail: String) async {
        step = .buildingPlan
        let basePlan = EmailSetupPlanner.dnsPlan(for: provider, domain: domain, dmarcReportEmail: dmarcReportEmail)
        var existingSPF: String?
        if case .success(let records) = await ops.listRecords(domain: domain) {
            existingSPF = records.first {
                $0.type == "TXT" && $0.name.caseInsensitiveCompare(domain) == .orderedSame
                    && $0.content.lowercased().hasPrefix("v=spf1")
            }?.content
        }
        let reconciled = EmailSetupPlanner.reconcilingExistingSPF(in: basePlan, existingSPFRecordContent: existingSPF)
        step = .review(plan: reconciled, spfWasMerged: reconciled != basePlan)
    }

    private func runApply(plan: EmailSetupPlanner.DNSPlan, domain: String, dmarcReportEmail: String) async {
        step = .applying
        let executor = EmailSetupExecutor(ops: ops)
        let result = await executor.apply(
            plan: plan, domain: domain, dmarcReportEmail: dmarcReportEmail, sourceDirectory: sourceDirectory)
        step = .result(result)
    }
}
