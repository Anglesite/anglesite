import Foundation

/// Trigger logic extracted from `DeployModel` so it is covered by `swift test` on CI (the app
/// target has no CI-run test bundle). Digests the raw log and short-circuits empty input before
/// touching the model.
public enum DeployFailureSummaryRequest {
    /// Digests `logText` via ``DeployLogDigest`` and asks `summarizer` for a summary. Returns
    /// `nil` without ever invoking the summarizer when the digest comes back empty — there is
    /// nothing meaningful to summarize, and prompting the on-device model with empty input would
    /// only waste its token budget and produce a hallucinated answer.
    public static func run(
        logText: String,
        siteID: String,
        siteDirectory: URL,
        using summarizer: any DeployFailureSummarizing
    ) async -> DeployFailureSummary? {
        let digest = DeployLogDigest.extract(from: logText)
        guard !digest.isEmpty else { return nil }
        return await summarizer.summarize(failureLog: digest, siteID: siteID, siteDirectory: siteDirectory)
    }
}
