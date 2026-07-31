import Foundation

/// On-device semantic ranking layer over #329's lexical ``SiteKnowledgeIndex``. Holds one
/// embedding vector per document, persisted via ``SemanticIndexCache``. The lexical index is
/// untouched; this is purely additive.
public actor SemanticRanker {
    private struct Stored {
        let contentHash: String
        let vector: [Float]
    }

    private let provider: EmbeddingProvider
    private let cache: SemanticIndexCache?
    /// `[siteID: [docID: Stored]]`.
    private var vectorsBySite: [String: [String: Stored]] = [:]

    /// Creates a ranker over the given embedding provider.
    ///
    /// - Parameters:
    ///   - provider: Source of document/query vectors; its `dimension` doubles as the cache
    ///     invalidation key (see ``SemanticIndexCache``).
    ///   - cache: Cold-start persistence, seeded on the first ``sync(siteID:documents:)`` of a
    ///     site and rewritten after every mutation. Pass `nil` to keep vectors purely in-memory —
    ///     production's v0 wiring, pending the off-actor writer noted in `persist`.
    public init(provider: EmbeddingProvider, cache: SemanticIndexCache?) {
        self.provider = provider
        self.cache = cache
    }

    /// Text fed to the embedder: title + headings + a leading slice of the body. Document-level
    /// granularity (v0); chunking is a later extension.
    static func embeddedText(for document: SiteKnowledgeIndex.Document) -> String {
        var parts: [String] = []
        if let title = document.title, !title.isEmpty { parts.append(title) }
        if !document.headings.isEmpty { parts.append(document.headings.joined(separator: " ")) }
        parts.append(String(document.excerptText.prefix(2000)))
        return parts.joined(separator: "\n")
    }

    /// Reconciles the vector store for a site against the lexical index's current documents:
    /// reuse cached vectors whose content is unchanged, embed new/changed documents, and drop
    /// vectors for documents that no longer exist.
    public func sync(siteID: String, documents: [SiteKnowledgeIndex.Document]) async {
        // Seed from the cold cache on first touch of this site.
        if vectorsBySite[siteID] == nil, let cache {
            vectorsBySite[siteID] = cache.load(expectedDimension: provider.dimension)
                .mapValues { Stored(contentHash: $0.contentHash, vector: $0.vector) }
        }
        let existing = vectorsBySite[siteID] ?? [:]
        var next: [String: Stored] = [:]
        for document in documents {
            let text = Self.embeddedText(for: document)
            let hash = VectorMath.stableHash(text)
            if let prior = existing[document.id], prior.contentHash == hash {
                next[document.id] = prior
            } else if let vector = try? await provider.embed(text), Self.isUsable(vector) {
                next[document.id] = Stored(contentHash: hash, vector: vector)
            }
        }
        vectorsBySite[siteID] = next
        persist(siteID: siteID)
    }

    /// Re-embeds a single document if its content changed (incremental update during a session).
    public func upsert(siteID: String, document: SiteKnowledgeIndex.Document) async {
        let text = Self.embeddedText(for: document)
        let hash = VectorMath.stableHash(text)
        if vectorsBySite[siteID]?[document.id]?.contentHash == hash { return }
        guard let vector = try? await provider.embed(text), Self.isUsable(vector) else { return }
        vectorsBySite[siteID, default: [:]][document.id] = Stored(contentHash: hash, vector: vector)
        persist(siteID: siteID)
    }

    /// A vector is only worth storing if it has non-zero magnitude — a zero vector ranks 0 against
    /// everything (`VectorMath.cosine`), so storing it just wastes a slot. Guards against a provider
    /// that unexpectedly returns an all-zero vector for some input.
    private static func isUsable(_ vector: [Float]) -> Bool {
        vector.contains { $0 != 0 }
    }

    /// Drops a single document's vector (e.g. its file was deleted). Not `async`: actor isolation
    /// alone forces callers to `await`; the keyword would falsely imply an internal suspension point.
    public func remove(siteID: String, docID: String) {
        vectorsBySite[siteID]?[docID] = nil
        persist(siteID: siteID)
    }

    /// Drops all vectors for a site (mirrors `SiteKnowledgeIndex.unload` on site close).
    public func unload(siteID: String) {
        vectorsBySite[siteID] = nil
    }

    /// Number of vectors held for a site (inspection/tests).
    public func vectorCount(siteID: String) -> Int {
        vectorsBySite[siteID]?.count ?? 0
    }

    // MARK: - Ranking

    /// A document scored against a query, where `score` is cosine similarity in -1…1.
    public struct Ranked: Sendable, Equatable {
        /// The matched document's id in ``SiteKnowledgeIndex``.
        public let docID: String
        /// Cosine similarity against the query vector (-1…1); higher is more similar.
        public let score: Float
        /// Memberwise initializer (public so tests and callers can build expected results).
        public init(docID: String, score: Float) {
            self.docID = docID
            self.score = score
        }
    }

    /// Documents most semantically similar to `toDocID`, descending, excluding the source itself.
    public func related(siteID: String, toDocID: String, limit: Int) -> [Ranked] {
        guard let store = vectorsBySite[siteID], let source = store[toDocID] else { return [] }
        return rank(store: store, against: source.vector, excluding: toDocID, limit: limit)
    }

    /// Documents most semantically similar to an arbitrary query string, descending.
    public func search(siteID: String, queryText: String, limit: Int) async -> [Ranked] {
        guard let store = vectorsBySite[siteID],
              let queryVector = try? await provider.embed(queryText) else { return [] }
        return rank(store: store, against: queryVector, excluding: nil, limit: limit)
    }

    private func rank(store: [String: Stored], against query: [Float], excluding: String?, limit: Int) -> [Ranked] {
        store.compactMap { docID, stored -> Ranked? in
            if docID == excluding { return nil }
            return Ranked(docID: docID, score: VectorMath.cosine(query, stored.vector))
        }
        .sorted { $0.score != $1.score ? $0.score > $1.score : $0.docID < $1.docID }
        .prefix(max(0, limit))
        .map { $0 }
    }

    /// Min-max normalizes each signal to 0…1, then returns the weighted sum per docID over the
    /// union of keys (a docID absent from one side contributes 0 there).
    public nonisolated static func blend(
        lexical: [String: Double], semantic: [String: Double], semanticWeight: Double
    ) -> [String: Double] {
        func normalize(_ map: [String: Double]) -> [String: Double] {
            guard let lo = map.values.min(), let hi = map.values.max(), hi > lo else {
                // All values equal (incl. all-zero) → no discriminating signal. Map to 0 so a flat
                // signal contributes nothing to the weighted sum rather than inflating every doc.
                return map.mapValues { _ in 0 }
            }
            return map.mapValues { ($0 - lo) / (hi - lo) }
        }
        let lex = normalize(lexical), sem = normalize(semantic)
        let w = min(max(semanticWeight, 0), 1)
        var out: [String: Double] = [:]
        for docID in Set(lex.keys).union(sem.keys) {
            out[docID] = w * (sem[docID] ?? 0) + (1 - w) * (lex[docID] ?? 0)
        }
        return out
    }

    private func persist(siteID: String) {
        // Inert in v0 (production wires `cache: nil`). When the per-site cache is enabled, this
        // synchronous encode + disk write runs on the actor and `try?`-swallows failures — move it
        // off the actor (e.g. a detached writer) and log write errors as part of that follow-up.
        guard let cache, let stored = vectorsBySite[siteID] else { return }
        let entries = stored.reduce(into: [String: SemanticIndexCache.Entry]()) { result, pair in
            result[pair.key] = SemanticIndexCache.Entry(
                docID: pair.key,
                contentHash: pair.value.contentHash,
                dimension: provider.dimension,
                vector: pair.value.vector)
        }
        try? cache.save(entries)
    }
}
