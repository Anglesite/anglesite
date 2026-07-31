import Foundation

// NaturalLanguage is Darwin-only (cross-platform port design §5); off-Darwin, callers fall back
// to ``LexicalEmbeddingProvider``.
#if canImport(NaturalLanguage)
import NaturalLanguage

/// Production ``EmbeddingProvider`` backed by Apple's on-device `NLEmbedding.sentenceEmbedding`.
/// Synchronous and asset-light, so it works without a network embedding service (project
/// strategy). Returns `nil` from init when no model is available, letting callers degrade to
/// lexical-only ranking.
public struct NLEmbeddingProvider: EmbeddingProvider {
    private let embedding: NLEmbedding
    /// The OS model's vector dimension, fixed at init — every vector `embed(_:)` returns has
    /// exactly this many components (the ``EmbeddingProvider`` contract).
    public let dimension: Int

    /// Loads the OS sentence-embedding model for `language`, or fails (`nil`) when the OS ships
    /// no model for it — the signal callers use to degrade to lexical-only ranking rather than
    /// treating a missing model as an error.
    public init?(language: NLLanguage = .english) {
        guard let embedding = NLEmbedding.sentenceEmbedding(for: language) else { return nil }
        self.embedding = embedding
        self.dimension = embedding.dimension
    }

    /// Embeds `text` as a unit-normalized sentence vector. Normalization happens here because
    /// `NLEmbedding.sentenceEmbedding` doesn't actually return unit vectors despite its
    /// documented contract (see the inline note), and other ``EmbeddingProvider`` consumers may
    /// rely on unit length.
    /// - Throws: ``EmbeddingError/emptyText`` for whitespace-only input;
    ///   ``EmbeddingError/modelUnavailable`` when the model returns no vector (or a degenerate
    ///   zero vector) for this input.
    public func embed(_ text: String) async throws -> [Float] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw EmbeddingError.emptyText }
        guard let raw = embedding.vector(for: trimmed) else { throw EmbeddingError.modelUnavailable }
        // Despite the documented contract, `sentenceEmbedding.vector(for:)` does NOT return a unit
        // vector here (verified: magnitudes ≠ 1) — so normalize to honor the EmbeddingProvider
        // contract. (Ranking via `VectorMath.cosine` is scale-invariant regardless, but other
        // consumers may rely on unit length.) A degenerate zero vector means the model produced
        // nothing usable for this input.
        let floats = raw.map { Float($0) }
        let magnitude = (floats.reduce(0) { $0 + $1 * $1 }).squareRoot()
        guard magnitude > 0 else { throw EmbeddingError.modelUnavailable }
        return floats.map { $0 / magnitude }
    }
}
#endif
