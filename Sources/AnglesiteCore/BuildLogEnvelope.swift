import Foundation

/// Extracts the versioned `pre-deploy-check.ts --json` envelope (#742) out of a larger, noisier
/// log — the shape `npm run build:ci` (#799) produces when a non-interactive runner (a future
/// Worker-triggered bake container, or Workers Builds) captures combined build + scan stdout in
/// one stream, unlike `DeployCommand`'s own `.preflight` step, which already runs the scan in
/// isolation and hands `PreDeployCheck.parse` a clean envelope directly.
///
/// This type does not re-implement decoding — `PreDeployCheck.parse` remains the single decoder
/// (#742). It only locates the envelope's boundaries within a larger string, then defers to
/// `PreDeployCheck.parse` for everything after that.
public enum BuildLogEnvelope {
    /// What ``BuildLogEnvelope/extract(fromLog:exitCode:)`` found. Two-way by design: callers
    /// choose a whole rendering path from this alone — the structured blocked/passed scan UI for
    /// `.outcome`, or a plain log excerpt for `.rawExcerpt` — with no third "maybe" state to
    /// handle.
    public enum Result: Sendable, Equatable {
        /// A `{"version":...}` JSON object was located and decoded (successfully or not — an
        /// unsupported/malformed envelope still surfaces as `.outcome(.error(...))`, matching
        /// `PreDeployCheck.parse`'s own contract).
        case outcome(PreDeployCheck.Outcome)
        /// No JSON envelope could be located in the log at all — an ordinary build failure (a
        /// missing module, a syntax error) rather than a gate-blocked scan. Callers render this as
        /// a plain log excerpt instead of the `Phase.blocked` sheet.
        case rawExcerpt(String)
    }

    /// Cap on the number of trailing lines kept in a `.rawExcerpt` fallback, so a build that fails
    /// early in a very long log (e.g. a dependency install trace) still surfaces something
    /// readable instead of megabytes of noise.
    public static let rawExcerptLineLimit = 200

    /// Scans `log` for the last top-level `{...}` object whose first key is `"version"` — the
    /// shape `pre-deploy-check.ts --json` always emits as the final thing it prints (main(),
    /// `Resources/Template/scripts/pre-deploy-check.ts`). Searching from the end (rather than the
    /// start) matters because build tool output can itself contain unrelated `{...}` fragments
    /// (e.g. a stack trace or a JSON config dump) earlier in the log.
    public static func extract(fromLog log: String, exitCode: Int32?) -> Result {
        guard let envelopeRange = lastVersionedJSONObjectRange(in: log) else {
            return .rawExcerpt(rawExcerpt(of: log))
        }
        let envelope = String(log[envelopeRange])
        return .outcome(PreDeployCheck.parse(output: envelope, exitCode: exitCode))
    }

    /// Finds the range of the last substring in `log` that is both valid JSON and an object whose
    /// top-level `version` key is present — a cheap, allocation-light way to say "this looks like
    /// our envelope" without fully decoding `ScanReport` twice (`PreDeployCheck.parse` does the
    /// real decode). Scans backward from each `{` found from the end, trying the substring from
    /// that `{` to the end of the string; the pre-deploy-check script's envelope is always the last
    /// thing printed, so the first `{` (scanning backward) that parses as `{"version": ...}` is it.
    private static func lastVersionedJSONObjectRange(in log: String) -> Range<String.Index>? {
        var searchEnd = log.endIndex
        while let openBrace = log.range(of: "{", options: .backwards, range: log.startIndex..<searchEnd) {
            let candidate = log[openBrace.lowerBound...]
            if looksLikeVersionedEnvelope(candidate) {
                return openBrace.lowerBound..<log.endIndex
            }
            searchEnd = openBrace.lowerBound
        }
        return nil
    }

    private static func looksLikeVersionedEnvelope(_ candidate: Substring) -> Bool {
        let data = Data(candidate.utf8)
        struct VersionProbe: Decodable { let version: Int }
        return (try? JSONDecoder().decode(VersionProbe.self, from: data)) != nil
    }

    private static func rawExcerpt(of log: String) -> String {
        let lines = log.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count > rawExcerptLineLimit else { return log }
        return lines.suffix(rawExcerptLineLimit).joined(separator: "\n")
    }
}
