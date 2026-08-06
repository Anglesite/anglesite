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
            // The two endpoints are awaited independently, not as one `try await (a, b)` tuple:
            // GitHub answers `GET /repos/{o}/{r}/dependabot/alerts` with a 403 whenever Dependabot
            // alerts are simply *disabled* for the repository — a normal state, not a token
            // problem. Combining the awaits would let that ordinary 403 discard security
            // advisories that fetched perfectly well, and blame the token for it.
            async let advisoriesFetch = reader.openSecurityAdvisories(
                owner: repo.owner, name: repo.name, token: token)
            async let alertsFetch = reader.openDependabotAlerts(
                owner: repo.owner, name: repo.name, token: token)

            var advisories: [SecurityAdvisory]?
            var alerts: [DependabotAlert]?
            var advisoriesError: (any Error)?
            var alertsError: (any Error)?
            do { advisories = try await advisoriesFetch } catch { advisoriesError = error }
            do { alerts = try await alertsFetch } catch { alertsError = error }

            // A newer recheck superseded us; drop both results silently.
            guard !Task.isCancelled else { return }
            if let advisoriesError, advisoriesError is CancellationError { return }
            if let alertsError, alertsError is CancellationError { return }

            self?.commit(advisories: advisories, alerts: alerts,
                         advisoriesError: advisoriesError, alertsError: alertsError)
        }
        inFlight = task
        return task
    }

    /// Commits whichever halves succeeded. A half that failed leaves its list empty and is
    /// explained by `lastError` — never silently blank.
    private func commit(advisories: [SecurityAdvisory]?, alerts: [DependabotAlert]?,
                        advisoriesError: (any Error)?, alertsError: (any Error)?) {
        openAdvisories = advisories ?? []
        openAlerts = alerts ?? []
        lastError = Self.message(advisoriesError: advisoriesError, alertsError: alertsError)
        lastCheckedAt = Date()
        isRunning = false
    }

    /// The user-facing explanation for a check where one or both halves failed, or `nil` when
    /// both succeeded. A single failed half never claims the token is at fault — a repository
    /// setting is the likelier cause, and the other half's results are on screen next to it.
    private static func message(advisoriesError: (any Error)?, alertsError: (any Error)?) -> String? {
        switch (advisoriesError, alertsError) {
        case (nil, nil):
            return nil
        case (.some(let advisoriesErr), .some(let alertsErr)):
            return wholeCheckMessage(advisoriesError: advisoriesErr, alertsError: alertsErr)
        case (.some(let error), nil):
            return "Couldn't check this repository's security advisories (\(reason(for: error))). Its open Dependabot alerts are still shown."
        case (nil, .some(let error)):
            return "Couldn't check this repository's Dependabot alerts (\(reason(for: error))) — they may be turned off for it. Its open security advisories are still shown."
        }
    }

    /// The both-failed message when the two halves' errors don't share an unambiguous cause.
    /// `message(advisoriesError:alertsError:)` routes the (401-involved) and (403, 403) cases to
    /// `wholeCheckMessage(advisoriesError:alertsError:)` before falling back to this.
    private static func wholeCheckMessage(for error: any Error) -> String {
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

    /// The both-halves-failed message. A 401 on either half means the token itself is invalid —
    /// an unambiguous shared cause worth sending the user to Settings for regardless of the other
    /// half's status. A 403 on *both* halves is not that: `openDependabotAlerts` 403s whenever
    /// Dependabot alerts are simply off for the repo (see `recheck`'s doc comment), and advisories
    /// can 403 on its own repo-config grounds too — two 403s don't establish the token is at
    /// fault, so this doesn't send the user to recreate one that may already be correctly scoped.
    private static func wholeCheckMessage(advisoriesError: any Error, alertsError: any Error) -> String {
        let advisoriesStatus = unauthorizedStatus(for: advisoriesError)
        let alertsStatus = unauthorizedStatus(for: alertsError)
        if advisoriesStatus == 401 || alertsStatus == 401 {
            return "Your GitHub token doesn't have permission to read this repository's security advisories and Dependabot alerts. Recreate it with Repository security advisories: Read and Dependabot alerts: Read."
        }
        if advisoriesStatus == 403, alertsStatus == 403 {
            return "GitHub denied access to this repository's security advisories and Dependabot alerts. This can mean the token is missing Repository security advisories: Read or Dependabot alerts: Read, or that one or both features simply aren't enabled for this repository."
        }
        return wholeCheckMessage(for: advisoriesError)
    }

    /// The HTTP status behind a `.unauthorized` failure, or `nil` for any other error (including
    /// other `GitHubRepoAPIError` cases).
    private static func unauthorizedStatus(for error: any Error) -> Int? {
        guard let apiError = error as? GitHubRepoAPIError, case .unauthorized(let status) = apiError else {
            return nil
        }
        return status
    }

    /// A short parenthetical cause, for the half-failed messages above.
    private static func reason(for error: any Error) -> String {
        guard let apiError = error as? GitHubRepoAPIError else {
            return error.localizedDescription
        }
        switch apiError {
        case .unauthorized: return "GitHub refused the request"
        case .network: return "couldn't reach GitHub"
        case .http(let status): return "HTTP \(status)"
        case .api(let message): return message
        case .malformedResponse, .nameAlreadyExists: return "unexpected response from GitHub"
        }
    }
}
