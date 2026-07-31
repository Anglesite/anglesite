import Foundation

/// The copy-edit skill's 10-point checklist as a guided-generation prompt (#465). Pure and
/// non-gated. Facts-only framing follows `SiteGraphExplainPrompt`: the model reviews ONLY the
/// provided page text and must quote excerpts verbatim so `CopyRewriteApplier` can find them.
public enum CopyEditPrompt {
    /// The 10-point review checklist, verbatim. Public so tests and any surface that explains
    /// the audit to the user share the exact wording the model was actually given.
    public static let checklist = """
    1. Clarity — would a first-time visitor instantly understand what this page offers?
    2. Benefits over features — does the copy say what the visitor gets, not just what the business does?
    3. Voice consistency — does the tone match the site's voice throughout?
    4. Calls to action — is there a clear call to action on this page, and is it compelling?
    5. Scannability — short paragraphs, meaningful headings, front-loaded sentences?
    6. Reader focus — more "you" than "we"?
    7. Jargon — any insider terms a customer wouldn't use?
    8. Social proof — are claims backed by specifics where possible?
    9. Missing information — anything a customer always needs (hours, location, pricing signals)?
    10. Mobile readability — any walls of text?
    """

    /// Assembles the guided-generation prompt for one chunk: optional `preamble` (site-voice
    /// guidance) first, then the checklist, framing rules, and the page text. The "quote
    /// excerpts verbatim, character for character" demand is load-bearing — both
    /// ``CopyRewriteApplier`` and ``CopyEditReportBuilder``'s hallucination filter match
    /// excerpts by exact substring. Findings are capped at 5 per page to keep the review
    /// high-impact rather than exhaustive.
    public static func build(chunk: ContentChunk, preamble: String?) -> String {
        var sections: [String] = []
        if let preamble { sections.append(preamble) }
        sections.append("""
        You are a copy editor reviewing one page of a small business's website against this checklist:
        \(checklist)

        Report up to 5 highest-impact findings for this page — if the copy is strong, report none. \
        For each finding: the checklist category, a severity (high, medium, or low), a short excerpt \
        quoted verbatim from the page text (copy it exactly, character for character), a one-sentence \
        plain-language issue, and a suggested rewrite in the site's voice. Base findings only on the \
        page text below; do not invent facts about the business.

        Page route: \(chunk.route)\(chunk.truncated ? "\n(Note: page text was truncated.)" : "")

        Page text:
        \(chunk.text)
        """)
        return sections.joined(separator: "\n\n")
    }
}
