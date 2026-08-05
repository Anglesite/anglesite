import Foundation
import Observation

/// Per-site inbound security-report state: a GitHub repo's open security advisories and open
/// Dependabot alerts (#975, the inbound half of #843). Drives the security-reports toolbar
/// badge and the Website Settings ▸ Security Reports "Open reports" section — both read this
/// one instance so a check kicked off from either place is visible in both.
///
/// Structurally a sibling of `HealthModel`: cancel-then-restart `recheck`, a settled
/// `lastCheckedAt`, and a `badgeState` the view layer never has to derive from raw data itself.
@MainActor
@Observable
public final class SecurityReportsModel {
    /// The three-way badge color. Unlike `HealthModel.BadgeState`, there is no `.unknown` case:
    /// "never checked" and "checked, nothing open" both read as `.clean` — the badge itself
    /// decides whether to render at all based on `totalCount`/`isRunning`, not on this state.
    public enum BadgeState: Sendable, Equatable {
        case clean
        case warnings
        case failures
    }

    public private(set) var openAdvisories: [SecurityAdvisory] = []
    public private(set) var openAlerts: [DependabotAlert] = []
    public private(set) var lastCheckedAt: Date?
    public private(set) var isRunning: Bool = false
    /// User-facing message from the most recent failed check, or `nil` after a successful one
    /// (or before any check has run).
    public private(set) var lastError: String?

    private let reader: any RepoAdvisoryReading
    private var inFlight: Task<Void, Never>?

    public init(reader: any RepoAdvisoryReading = HTTPGitHubClient()) {
        self.reader = reader
    }

    public var totalCount: Int { openAdvisories.count + openAlerts.count }

    /// `.failures` if any open item is critical/high severity, `.warnings` if the only open
    /// items are moderate/low/unknown, `.clean` otherwise (including "nothing checked yet").
    public var badgeState: BadgeState {
        let severities = openAdvisories.map(\.severity) + openAlerts.map(\.severity)
        if severities.contains(where: { $0 == .critical || $0 == .high }) { return .failures }
        if !severities.isEmpty { return .warnings }
        return .clean
    }

    /// Cancels any in-flight check and starts a new one. `repo == nil` (no GitHub origin) or a
    /// missing/empty `token` both clear state to empty rather than erroring — neither is a
    /// failure, just nothing to show, and neither touches `lastCheckedAt` since no check ran.
    @discardableResult
    public func recheck(repo: RemoteRepo?, token: String?) -> Task<Void, Never> {
        inFlight?.cancel()
        guard let repo, let token, !token.isEmpty else {
            inFlight = nil
            openAdvisories = []
            openAlerts = []
            lastError = nil
            isRunning = false
            return Task {}
        }
        isRunning = true
        let task = Task { @MainActor [weak self, reader] in
            do {
                async let advisories = reader.openSecurityAdvisories(owner: repo.owner, name: repo.name, token: token)
                async let alerts = reader.openDependabotAlerts(owner: repo.owner, name: repo.name, token: token)
                let (fetchedAdvisories, fetchedAlerts) = try await (advisories, alerts)
                guard !Task.isCancelled else { return }
                self?.commit(advisories: fetchedAdvisories, alerts: fetchedAlerts, error: nil)
            } catch is CancellationError {
                return  // a newer recheck superseded us; drop the result silently
            } catch {
                guard !Task.isCancelled else { return }
                self?.commit(advisories: nil, alerts: nil, error: error)
            }
        }
        inFlight = task
        return task
    }

    private func commit(advisories: [SecurityAdvisory]?, alerts: [DependabotAlert]?, error: Error?) {
        if let advisories, let alerts {
            openAdvisories = advisories
            openAlerts = alerts
            lastError = nil
        } else {
            lastError = Self.message(for: error)
        }
        lastCheckedAt = Date()
        isRunning = false
    }

    private static func message(for error: Error?) -> String {
        guard let apiError = error as? GitHubRepoAPIError else {
            return "Couldn't check this repository's security reports."
        }
        switch apiError {
        case .unauthorized:
            return "Your GitHub token doesn't have permission to read this repository's security advisories and Dependabot alerts. Recreate it with Repository security advisories: Read and Dependabot alerts: Read."
        case .network:
            return "Couldn't reach GitHub. Check your connection and try again."
        case .http(let status):
            return "GitHub returned an unexpected response (HTTP \(status))."
        case .api(let message):
            return "GitHub rejected the request: \(message)"
        case .malformedResponse, .nameAlreadyExists:
            return "GitHub returned an unexpected response."
        }
    }
}
