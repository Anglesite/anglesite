import Foundation

/// Pure chat rendering of a `CopyEditReport`, non-gated for CI tests. `capped` is non-nil when
/// a site-wide audit was truncated to the tool's chunk budget (no silent caps — spec §6).
public enum ReviewCopyReply {
    /// Renders the report as one chat reply: findings as severity-tagged bullets with their
    /// suggested rewrites, plus explicit lines for skipped routes and any cap — the reply always
    /// discloses what wasn't reviewed (no silent caps — spec §6).
    public static func text(for report: CopyEditReport, capped: Int?) -> String {
        if let unavailableMessage = report.unavailableMessage {
            return unavailableMessage
        }
        var lines: [String] = []
        if report.findings.isEmpty {
            lines.append("I found no copy issues across \(report.auditedCount) page\(report.auditedCount == 1 ? "" : "s") — the copy reads well.")
        } else {
            lines.append("Copy review (\(report.auditedCount) page\(report.auditedCount == 1 ? "" : "s") audited):")
            for f in report.findings {
                lines.append("• [\(severityLabel(f.severity))] \(f.route) — \(f.issue) Suggestion: \(f.suggestedRewrite)")
            }
        }
        if !report.skippedRoutes.isEmpty {
            lines.append("Skipped (couldn't review): \(report.skippedRoutes.joined(separator: ", ")).")
        }
        if let capped {
            lines.append("I reviewed the first \(capped) pages only — use Review Copy in the app for the full site.")
        }
        return lines.joined(separator: "\n")
    }

    static func severityLabel(_ s: CopyFindingSeverity) -> String {
        switch s {
        case .high: return "high"
        case .medium: return "medium"
        case .low: return "low"
        }
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Chat front-door for the copy audit (#465). Page-scoped when `route` is given; otherwise a
/// site-wide pass capped at `maxSiteChunks` chunks (a chat turn shouldn't run for minutes — the
/// GUI report is the uncapped surface, and the cap is always disclosed in the reply).
public struct ReviewCopyTool: Tool, Sendable {
    /// Stable wire name, kept as a static so registration/telemetry sites can reference it
    /// without constructing the tool.
    public static let toolName = "reviewCopy"
    /// Chunk budget for a site-wide chat audit — bounds a chat turn's latency. The GUI report
    /// is the uncapped surface, and hitting this cap is always disclosed in the reply.
    public static let maxSiteChunks = 8
    /// `Tool` conformance: the name the model calls this tool by.
    public let name = ReviewCopyTool.toolName
    /// `Tool` conformance: model-facing usage guidance. The "do not search first" instruction
    /// exists because models otherwise chain a content search before calling, and a stale/empty
    /// search result talks them out of a call that would have succeeded.
    public let description = "Review the site's written copy for clarity, tone, calls to action, and jargon. Pass a route (like '/about') for one page, or omit it to review the site. If the user gives you a route, call this directly with it — do not search for the page first; this tool reads pages from disk and will find them even if a prior search came back empty."

    /// Model-generated arguments; the `@Guide` text is what steers the model, this is just
    /// its shape.
    @Generable
    public struct Arguments {
        /// Page route to audit (e.g. `/about`); `nil` or empty audits the whole site under
        /// the chunk cap.
        @Guide(description: "Page route to review (e.g. '/about'). Omit to review the whole site.")
        public var route: String?
    }

    private let auditor: any CopyEditAuditing
    private let conventionsStore: ProjectConventionsStore?
    private let siteID: String
    private let siteDirectory: URL

    /// Creates the tool. `auditor` is a protocol seam so tests exercise the tool without
    /// on-device inference; `conventionsStore` is optional because a site may not have learned
    /// conventions yet — the brand-voice preamble degrades to defaults rather than blocking.
    public init(auditor: any CopyEditAuditing, conventionsStore: ProjectConventionsStore?,
                siteID: String, siteDirectory: URL) {
        self.auditor = auditor
        self.conventionsStore = conventionsStore
        self.siteID = siteID
        self.siteDirectory = siteDirectory
    }

    /// Chunks the site from disk, narrows to the requested route (or applies the site-wide
    /// cap), runs the audit with the brand-voice preamble, and renders the report via
    /// `ReviewCopyReply`. "Couldn't find" outcomes are conversational strings, not thrown
    /// errors — a throw would surface to the model, not the owner.
    public func call(arguments: Arguments) async throws -> String {
        var chunks = SiteContentChunker.chunks(sourceDirectory: siteDirectory)
        var capped: Int? = nil
        if let route = arguments.route, !route.isEmpty {
            chunks = chunks.filter { $0.route == route }
            guard !chunks.isEmpty else { return "I couldn't find a page at \(route)." }
        } else if chunks.count > Self.maxSiteChunks {
            chunks = Array(chunks.prefix(Self.maxSiteChunks))
            capped = Self.maxSiteChunks
        }
        guard !chunks.isEmpty else { return "I couldn't find any pages or posts to review." }
        let conventions = await conventionsStore?.load()
        let preamble = BrandVoiceGuidance.preamble(
            conventions: conventions, businessType: SiteBusinessType.read(sourceDirectory: siteDirectory))
        let report = await auditor.audit(
            chunks: chunks, preamble: preamble, siteID: siteID, siteDirectory: siteDirectory)
        return ReviewCopyReply.text(for: report, capped: capped)
    }
}
#endif
