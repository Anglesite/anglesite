import Foundation

/// Whole-site copy audit seam (#465). The FM implementation iterates chunks one guided-generation
/// call at a time (chunk-first — every call fits the on-device window); GUI/intents/tools depend
/// only on this protocol so tests can inject fakes.
public protocol CopyEditAuditing: Sendable {
    /// Audits every chunk and aggregates the results into one report. Never throws by design —
    /// a failed chunk degrades to a named skipped route, and total unavailability travels in
    /// ``CopyEditReport/unavailableMessage``, so every front-door always gets a renderable
    /// report. `preamble` is prepended verbatim to each chunk's prompt (site-voice guidance);
    /// `siteID`/`siteDirectory` scope the assistant context.
    func audit(chunks: [ContentChunk], preamble: String?, siteID: String, siteDirectory: URL) async -> CopyEditReport
}

/// `nil` below the Xcode-27 toolchain — callers hide/disable the feature (pattern:
/// `SiteGraphExplainerFactory`).
public enum CopyEditAuditorFactory {
    /// The FoundationModels-backed auditor on the Xcode-27 toolchain; `nil` elsewhere so callers
    /// hide or disable the feature rather than shipping a degraded audit (see the type doc).
    public static func makeDefault() -> (any CopyEditAuditing)? {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return FoundationModelCopyEditAuditor()
        #else
        return nil
        #endif
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
import OSLog

/// The production ``CopyEditAuditing`` implementation: one FoundationModels guided-generation
/// call per chunk, so every request fits the on-device context window regardless of site size.
public struct FoundationModelCopyEditAuditor: CopyEditAuditing {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "CopyEditAuditor")

    /// Creates an auditor. Stateless — the assistant is resolved per ``audit(chunks:preamble:siteID:siteDirectory:)``
    /// call, so runtime availability changes (Apple Intelligence toggled) are always seen fresh.
    public init() {}

    /// Chunk-first FM audit. Partial results over aborts (spec §6): a single failed chunk
    /// becomes a named skip, while the assistant going *unavailable* mid-run stops the audit
    /// with an explanation instead of silently skipping every remaining page.
    public func audit(chunks: [ContentChunk], preamble: String?, siteID: String, siteDirectory: URL) async -> CopyEditReport {
        // Heavy generation requests the PCC tier through the shared seam (#464); today that is
        // backed on-device, and chunking keeps each call correct at 4K regardless.
        guard let assistant = ContentAssistantFactory.make(tier: .privateCloudCompute) else {
            return CopyEditReportBuilder.report(
                results: chunks.map { ($0, nil) },
                unavailableMessage: ContentHelpDialogs.assistantUnavailable(feature: "Copy review"))
        }
        var results: [(chunk: ContentChunk, drafts: [CopyFindingDraft]?)] = []
        for chunk in chunks {
            do {
                let generated = try await assistant.generateStructured(
                    prompt: CopyEditPrompt.build(chunk: chunk, preamble: preamble),
                    context: AssistantContext(siteID: siteID, siteDirectory: siteDirectory),
                    resultType: GeneratedPageCopyFindings.self
                )
                results.append((chunk, generated.findings.map {
                    CopyFindingDraft(category: $0.category, severity: $0.severity,
                                     excerpt: $0.excerpt, issue: $0.issue,
                                     suggestedRewrite: $0.suggestedRewrite)
                }))
            } catch AssistantError.unavailable(let message) {
                // Apple Intelligence went unavailable mid-audit (e.g. toggled off at runtime) —
                // stop rather than degrading every remaining page to an unexplained "Not reviewed"
                // skip. The report carries the explanation so front-doors can surface it directly.
                Self.logger.notice("Copy audit stopped: FM unavailable — \(message, privacy: .public)")
                let unavailableMessage = message.isEmpty
                    ? ContentHelpDialogs.assistantUnavailable(feature: "Copy review")
                    : message
                return CopyEditReportBuilder.report(
                    results: chunks.map { ($0, nil) }, unavailableMessage: unavailableMessage)
            } catch {
                // Partial results over aborts (spec §6): one failed page becomes a named skip.
                // Logged (not silent) so a skipped-chunk cause is diagnosable (Task-8 minor).
                Self.logger.error("Copy audit chunk failed for \(chunk.route, privacy: .public): \(String(describing: error), privacy: .public)")
                results.append((chunk, nil))
            }
        }
        return CopyEditReportBuilder.report(results: results)
    }
}
#endif
