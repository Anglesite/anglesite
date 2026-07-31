import Foundation

/// Answers to the 5-question brand-voice interview (ported from the copy-edit skill):
/// audience, three-ish personality words, brand terms, phrases to avoid. Formality is
/// captured as tone words rather than a separate axis.
public struct BrandVoiceAnswers: Sendable, Equatable {
    /// Who the site speaks to, in the owner's own words. Free text; empty means unanswered.
    public var audience: String
    /// The "three-ish personality words" answer — tone descriptors like "warm" or "direct".
    public var toneWords: [String]
    /// Brand/product terms whose exact capitalization generated copy must reproduce.
    public var brandTerms: [String]
    /// Words and phrases the owner never wants to see in generated copy.
    public var avoidPhrases: [String]

    /// Memberwise initializer. Pass empty values for skipped questions — every consumer treats
    /// empty as "unanswered" and leaves the existing convention alone, never as "clear it".
    public init(audience: String, toneWords: [String], brandTerms: [String], avoidPhrases: [String]) {
        self.audience = audience
        self.toneWords = toneWords
        self.brandTerms = brandTerms
        self.avoidPhrases = avoidPhrases
    }
}

/// Pure mapping from interview answers to `.userOverride` convention writes. Only non-empty
/// answers are applied, so a partial interview never erases inferred signal.
public enum BrandVoiceInterview {
    /// Returns a copy of `conventions` with each non-empty answer applied as an override —
    /// the pure, engine-free counterpart of ``BrandVoiceWriter/save(_:engine:store:siteID:)``
    /// for callers that manage persistence themselves (and for tests).
    public static func apply(_ answers: BrandVoiceAnswers, to conventions: ProjectConventions) -> ProjectConventions {
        var out = conventions
        let audience = answers.audience.trimmingCharacters(in: .whitespacesAndNewlines)
        if !audience.isEmpty { out.apply(.audience(audience)) }
        if !answers.toneWords.isEmpty { out.apply(.toneDescriptors(answers.toneWords)) }
        if !answers.brandTerms.isEmpty { out.apply(.brandTerms(answers.brandTerms)) }
        if !answers.avoidPhrases.isEmpty { out.apply(.avoidPhrases(answers.avoidPhrases)) }
        return out
    }

    /// Comma-separated string → trimmed, non-empty items. Shared by the chat tool and GUI form.
    public static func list(_ raw: String?) -> [String] {
        guard let raw else { return [] }
        return raw.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}

/// Single write path for interview answers (#465): applies overrides through the shared
/// engine — so any open Style Guide stays consistent and later engine-snapshot persists
/// can't clobber this write — then persists the engine's merged state to the store.
/// Seeds the engine from disk first when it has no entry for the site yet.
public enum BrandVoiceWriter {
    /// Returns false (and writes nothing) when every answer is empty.
    @discardableResult
    public static func save(_ answers: BrandVoiceAnswers, engine: ProjectConventionsEngine,
                            store: ProjectConventionsStore, siteID: String) async -> Bool {
        guard hasContent(answers) else { return false }
        if await engine.conventions(siteID: siteID) == nil {
            await engine.seed(siteID: siteID, with: (await store.load()) ?? .empty)
        }
        let audience = answers.audience.trimmingCharacters(in: .whitespacesAndNewlines)
        if !audience.isEmpty { await engine.applyOverride(siteID: siteID, value: .audience(audience)) }
        if !answers.toneWords.isEmpty { await engine.applyOverride(siteID: siteID, value: .toneDescriptors(answers.toneWords)) }
        if !answers.brandTerms.isEmpty { await engine.applyOverride(siteID: siteID, value: .brandTerms(answers.brandTerms)) }
        if !answers.avoidPhrases.isEmpty { await engine.applyOverride(siteID: siteID, value: .avoidPhrases(answers.avoidPhrases)) }
        if let merged = await engine.conventions(siteID: siteID) { await store.save(merged) }
        return true
    }

    /// True when at least one answer is non-empty (audience judged after trimming) — the guard
    /// `save` uses so an all-blank interview never seeds the engine or touches the store. Public
    /// so callers (e.g. `SaveBrandVoiceTool`) can word their reply from the same predicate
    /// instead of duplicating the emptiness rules.
    public static func hasContent(_ answers: BrandVoiceAnswers) -> Bool {
        !answers.audience.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !answers.toneWords.isEmpty || !answers.brandTerms.isEmpty || !answers.avoidPhrases.isEmpty
    }
}
