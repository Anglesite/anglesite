import Foundation

/// Plain, view-facing result of summarizing a failed deploy. Non-gated so `DeployModel`,
/// `DeployDrawerView`, and CI-run `AnglesiteCore` tests can all reference it; the `@Generable`
/// counterpart (`GeneratedDeployFailureSummary`) lives behind the FoundationModels gate.
public struct DeployFailureSummary: Equatable, Sendable {
    /// What went wrong, phrased for the site owner rather than in build-log terms.
    public let summary: String
    /// The model's best guess at the root cause — a guess, so views present it as such rather
    /// than as a diagnosis.
    public let likelyCause: String
    /// The concrete next step the owner can take.
    public let suggestedFix: String

    /// Memberwise initializer — public so the gated FoundationModels summarizer (and test
    /// fixtures) can construct summaries from outside this file.
    public init(summary: String, likelyCause: String, suggestedFix: String) {
        self.summary = summary
        self.likelyCause = likelyCause
        self.suggestedFix = suggestedFix
    }
}

/// Seam for producing a `DeployFailureSummary`. Takes plain `siteID`/`siteDirectory` (not the
/// gated `AssistantContext`) so the protocol stays compilable on CI. A `nil` return means the
/// on-device model was unavailable or generation failed — callers fall back to the raw log.
public protocol DeployFailureSummarizing: Sendable {
    /// Summarizes an already-digested failure log (callers pass `DeployLogDigest` output, not
    /// the full raw log) — `nil` per the protocol doc's fallback contract.
    func summarize(failureLog: String, siteID: String, siteDirectory: URL) async -> DeployFailureSummary?
}

/// Fallback conformer used when `FoundationModels` isn't compiled in (CI / pre-Xcode-27).
public struct NoopDeploySummarizer: DeployFailureSummarizing {
    /// Creates the no-op summarizer; it holds no state.
    public init() {}
    /// Always `nil`, which forces callers onto the raw-log fallback — the correct behavior when
    /// no on-device model exists to summarize with.
    public func summarize(failureLog: String, siteID: String, siteDirectory: URL) async -> DeployFailureSummary? {
        nil
    }
}
