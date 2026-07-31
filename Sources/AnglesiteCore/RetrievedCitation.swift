import Foundation

/// A lightweight value type representing one file cited during RAG retrieval. Carries enough
/// for the chat UI to render a chip and navigate to the file without reaching back into the index.
public struct RetrievedCitation: Sendable, Equatable, Identifiable {
    /// The cited document's stable id in the knowledge index.
    public let id: String
    /// Project-relative path of the cited file — what chip navigation opens.
    public let path: String
    /// What kind of document was cited (page, post, …), copied from the index entry.
    public let kind: SiteKnowledgeIndex.Document.Kind
    /// Human-readable title, when the document has one; the UI falls back to ``path``.
    public let title: String?
    /// Line span of the matched chunk within the file, when retrieval was chunk-scoped —
    /// lets navigation land on the relevant passage, not just the file.
    public let lineRange: ClosedRange<Int>?
    /// Retrieval relevance score, kept for ordering and debugging rather than display.
    public let score: Double

    /// Memberwise creation, for tests and callers that already hold the fields.
    public init(id: String, path: String, kind: SiteKnowledgeIndex.Document.Kind, title: String?, lineRange: ClosedRange<Int>?, score: Double) {
        self.id = id
        self.path = path
        self.kind = kind
        self.title = title
        self.lineRange = lineRange
        self.score = score
    }

    /// Projects a ``SiteKnowledgeIndex/SearchResult`` down to just the citation fields — the
    /// point of this type: the chat UI keeps the chip metadata without retaining the indexed
    /// document content behind it.
    public init(_ result: SiteKnowledgeIndex.SearchResult) {
        self.init(
            id: result.document.id,
            path: result.document.path,
            kind: result.document.kind,
            title: result.document.title,
            lineRange: result.lineRange,
            score: result.score
        )
    }
}
