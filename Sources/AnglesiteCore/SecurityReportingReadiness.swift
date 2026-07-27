import Foundation

/// What Website Settings ▸ Security Reports should offer for a site, given its GitHub repo facts.
///
/// Pure by design: the network reads (repo visibility, private-vulnerability-reporting state)
/// happen in the model layer, and every branch of the decision is unit-testable without fakes.
public enum SecurityReportingReadiness: Sendable, Equatable {
    /// No `origin`, or an origin that isn't GitHub.
    case notGitHub
    /// The repo's advisory form is already one of the published contacts.
    case alreadyConfigured
    /// Public with private vulnerability reporting on — the form is usable, offer to publish it.
    case ready
    /// Public but private vulnerability reporting is off — offer to enable it, then publish.
    case needsPVR
    /// A private repo: outside reporters cannot reach the advisory form at all.
    case repoPrivate

    /// Precedence: `notGitHub` → `alreadyConfigured` → `repoPrivate` → `needsPVR` → `ready`.
    ///
    /// `alreadyConfigured` deliberately outranks `repoPrivate`: an owner who published the form
    /// and later made the repo private has already done the setup, so the UI should confirm the
    /// channel and warn about visibility rather than re-offer configuration.
    public static func evaluate(
        repo: RemoteRepo?,
        isPrivate: Bool,
        pvrEnabled: Bool,
        contacts: String
    ) -> SecurityReportingReadiness {
        guard let repo else { return .notGitHub }
        if SecurityReportingAsset.usesAdvisoryForm(contacts, repo: repo) { return .alreadyConfigured }
        if isPrivate { return .repoPrivate }
        return pvrEnabled ? .ready : .needsPVR
    }
}
