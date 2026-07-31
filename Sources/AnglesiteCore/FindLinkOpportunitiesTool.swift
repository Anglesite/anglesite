// Sources/AnglesiteCore/FindLinkOpportunitiesTool.swift
import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Foundation Models tool that audits a site's internal linking structure: orphan pages,
/// missing reciprocal links, over-linked pages. Uses ``LinkGraph`` over the knowledge index.
public struct FindLinkOpportunitiesTool: Tool, Sendable {
    /// Stable wire name of the tool. A `static let` so callers (session config, tests,
    /// transcript matching) can reference it without instantiating the tool.
    public static let toolName = "findLinkOpportunities"
    /// `Tool` conformance — the name the model uses to invoke this tool.
    public let name = FindLinkOpportunitiesTool.toolName
    /// `Tool` conformance — the natural-language capability summary the model reads when
    /// deciding whether to call this tool, so it must name the concrete findings it produces.
    public let description = "Audit the site's internal linking: find orphan pages with no inbound links, missing reciprocal links, and over-linked pages."

    /// No arguments: the audit always covers the whole site, so there is nothing for the
    /// model to parameterize (and nothing for it to get wrong).
    @Generable
    public struct Arguments {}

    private let index: SiteKnowledgeIndex
    private let siteID: String

    /// Creates the tool bound to one site's knowledge index; `siteID` scopes the audit so a
    /// multi-window session never mixes documents across sites.
    public init(index: SiteKnowledgeIndex, siteID: String) {
        self.index = index
        self.siteID = siteID
    }

    /// Runs the link audit and returns a plain-text report for the model to relay.
    ///
    /// Returns an explicit "no indexed documents" message rather than an empty report when
    /// the index hasn't been populated yet — an empty-looking success would read as
    /// "linking is healthy", which is the wrong conclusion before a site is open.
    public func call(arguments: Arguments) async throws -> String {
        let documents = await index.documents(siteID: siteID)
        guard !documents.isEmpty else {
            return "No indexed documents — open a site first."
        }
        let analysis = LinkGraph.analyze(documents: documents)
        return Self.formatReport(analysis)
    }

    /// Visible for testing — formats a `LinkAnalysis` into a human-readable report.
    internal static func formatReport(_ analysis: LinkGraph.LinkAnalysis) -> String {
        let overLinked = analysis.overLinkedPages(threshold: 15)
        if analysis.orphanPages.isEmpty && analysis.reciprocalGaps.isEmpty && overLinked.isEmpty {
            return "Internal linking looks healthy — no orphan pages, no missing reciprocal links, no over-linked pages. ✓"
        }

        var sections: [String] = []

        // Orphan pages
        if analysis.orphanPages.isEmpty {
            sections.append("Orphan pages: none ✓")
        } else {
            var lines = ["Orphan pages (no inbound links):"]
            for doc in analysis.orphanPages.prefix(15) {
                let title = doc.title ?? doc.path
                lines.append("  • \(title) (\(doc.path))")
            }
            if analysis.orphanPages.count > 15 {
                lines.append("  … and \(analysis.orphanPages.count - 15) more")
            }
            sections.append(lines.joined(separator: "\n"))
        }

        // Reciprocal gaps
        if analysis.reciprocalGaps.isEmpty {
            sections.append("Reciprocal link gaps: none ✓")
        } else {
            var lines = ["Reciprocal link gaps (A links to B, but B doesn't link back):"]
            for gap in analysis.reciprocalGaps.prefix(15) {
                lines.append("  • \(gap.sourcePath) should link to \(gap.targetPath)")
            }
            if analysis.reciprocalGaps.count > 15 {
                lines.append("  … and \(analysis.reciprocalGaps.count - 15) more")
            }
            sections.append(lines.joined(separator: "\n"))
        }

        // Over-linked
        if !overLinked.isEmpty {
            var lines = ["Over-linked pages (>15 outbound links):"]
            for doc in overLinked.prefix(10) {
                let count = analysis.outboundCounts[doc.path] ?? 0
                lines.append("  • \(doc.path) — \(count) outbound links")
            }
            sections.append(lines.joined(separator: "\n"))
        }

        return sections.joined(separator: "\n\n")
    }
}
#endif
