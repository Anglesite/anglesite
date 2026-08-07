import Foundation

/// Read-only seam for Cloudflare's Agent Readiness score (URL Scanner API's `agentReadiness`
/// scan option, #1248). Token passed per call, matching `CloudflareReading`. The underlying scan
/// is asynchronous — submit, then poll for a result — so this seam mirrors that with two calls
/// instead of one.
public protocol AgentReadinessScanning: Sendable {
    /// Submits a scan of `url` with Agent Readiness checks enabled. Returns the scan id to poll
    /// via `agentReadinessResult(scanID:apiToken:)`.
    func submitAgentReadinessScan(url: URL, apiToken: String) async throws -> UUID

    /// Polls a submitted scan. `nil` means the scan is still processing — callers should wait and
    /// call again. Once Cloudflare finishes the scan, this decodes and returns the report;
    /// if the finished result carries no Agent Readiness section at all (unexpected, since the
    /// option was requested at submission), it throws `CloudflareError.malformedResponse` rather
    /// than returning a report built from absent data.
    func agentReadinessResult(scanID: UUID, apiToken: String) async throws -> AgentReadinessReport?
}
