// Sources/AnglesiteCore/ProjectConventions.swift
import Foundation

/// Where a `Learned` field's current value came from.
public enum ConventionSource: Sendable, Codable, Equatable {
    /// Computed by the extractor or enrichment pass. `confidence` is the share of evidence
    /// agreeing with the value (0–1); `0` marks an unset default. Note the FM enricher writes
    /// `confidence: 1` — signal checks must accept any positive confidence, not gate on
    /// sample size (see `BrandVoiceGuidance.hasSignal`).
    case inferred(confidence: Double)
    /// Explicitly set by the user (Style Guide inspector or brand-voice interview). Re-learning
    /// never replaces it — see ``ProjectConventions/merging(overriddenFrom:)``.
    case userOverride
}

/// One inferred-or-overridden fact about a project's conventions. Re-learning never overwrites
/// a `.userOverride` value — see `ProjectConventions.merging(overriddenFrom:)`.
public struct Learned<Value: Sendable & Codable & Equatable>: Sendable, Codable, Equatable {
    /// The current value of the fact, regardless of whether it was inferred or user-set.
    public var value: Value
    /// Provenance of ``value`` — the merge invariant keys off this, not off the value itself.
    public var source: ConventionSource
    /// How many files this was inferred from, when known. `nil`/0 lets a future UI show a
    /// "low confidence" indicator instead of asserting a rule from too little evidence.
    public var sampleSize: Int?

    /// Memberwise initializer. `sampleSize` defaults to `nil` because user overrides and
    /// interview answers have no file-count evidence behind them.
    public init(value: Value, source: ConventionSource, sampleSize: Int? = nil) {
        self.value = value
        self.source = source
        self.sampleSize = sampleSize
    }

    /// `true` when ``source`` is `.userOverride` — the predicate
    /// ``ProjectConventions/merging(overriddenFrom:)`` uses to decide which fields survive a
    /// background re-learn.
    public var isOverridden: Bool {
        if case .userOverride = source { return true }
        return false
    }
}

/// The dominant heading style the extractor detected across a site's markdown headings.
/// A style is only asserted when ≥70% of sampled headings agree — anything less is `mixed`
/// (see `ProjectConventionsExtractor`).
public enum HeadingCapitalization: String, Sendable, Codable, Equatable, CaseIterable {
    /// Most headings capitalize every significant word ("Getting Started With Anglesite").
    case titleCase
    /// Most headings capitalize only the first word ("Getting started with anglesite").
    case sentenceCase
    /// No style reached the confidence threshold — also the zero-evidence default, so
    /// generation shouldn't impose either style.
    case mixed
}

/// The dominant file-naming style of a site's content/page slugs. Same ≥70% confidence
/// threshold as ``HeadingCapitalization``.
public enum SlugStyle: String, Sendable, Codable, Equatable, CaseIterable {
    /// Lowercase words joined with hyphens (`my-first-post`).
    case kebabCase
    /// Lowercase words joined with underscores (`my_first_post`).
    case snakeCase
    /// No style reached the confidence threshold — also the zero-evidence default.
    case mixed
}

/// Prose-style facts about a site: how it capitalizes, sounds, and names things. The voice
/// fields (`toneDescriptors`, `brandTerms`, `audience`, `avoidPhrases`) feed generation prompts
/// via `BrandVoiceGuidance`.
public struct WritingConventions: Sendable, Codable, Equatable {
    /// Dominant heading style, inferred from markdown headings by the deterministic extractor.
    public var headingCapitalization: Learned<HeadingCapitalization>
    /// Adjectives describing the site's voice (e.g. "warm", "technical"). Produced by the
    /// throttled on-device enrichment pass, not the deterministic extractor — text stats alone
    /// can't judge tone.
    public var toneDescriptors: Learned<[String]>
    /// Product/brand names and site-specific terms generation should spell exactly as the site
    /// does. Enrichment-produced, like ``toneDescriptors``.
    public var brandTerms: Learned<[String]>
    /// Who the site speaks to, in the owner's words. `""` = unset. Set by the brand-voice
    /// interview (#465); never inferred by the extractor.
    public var audience: Learned<String>
    /// Words/phrases generation must avoid. `[]` = unset. Set by the brand-voice interview.
    public var avoidPhrases: Learned<[String]>

    /// Memberwise initializer. The interview-only fields (`audience`, `avoidPhrases`) default
    /// to zero-confidence "unset" so extractor call sites that predate #465 don't have to
    /// supply them.
    public init(
        headingCapitalization: Learned<HeadingCapitalization>,
        toneDescriptors: Learned<[String]>,
        brandTerms: Learned<[String]>,
        audience: Learned<String> = Learned(value: "", source: .inferred(confidence: 0), sampleSize: 0),
        avoidPhrases: Learned<[String]> = Learned(value: [], source: .inferred(confidence: 0), sampleSize: 0)
    ) {
        self.headingCapitalization = headingCapitalization
        self.toneDescriptors = toneDescriptors
        self.brandTerms = brandTerms
        self.audience = audience
        self.avoidPhrases = avoidPhrases
    }

    private enum CodingKeys: String, CodingKey {
        case headingCapitalization, toneDescriptors, brandTerms, audience, avoidPhrases
    }

    /// Pre-#465 conventions.json has no voice fields; default them instead of failing the decode
    /// (a decode failure would silently drop the user's whole learned state).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headingCapitalization = try c.decode(Learned<HeadingCapitalization>.self, forKey: .headingCapitalization)
        toneDescriptors = try c.decode(Learned<[String]>.self, forKey: .toneDescriptors)
        brandTerms = try c.decode(Learned<[String]>.self, forKey: .brandTerms)
        audience = try c.decodeIfPresent(Learned<String>.self, forKey: .audience)
            ?? Learned(value: "", source: .inferred(confidence: 0), sampleSize: 0)
        avoidPhrases = try c.decodeIfPresent(Learned<[String]>.self, forKey: .avoidPhrases)
            ?? Learned(value: [], source: .inferred(confidence: 0), sampleSize: 0)
    }
}

/// Read as ground truth from `src/content.config.ts` (Task 3) — not inferred, so no `Learned`
/// wrapper and never user-overridable. Maps collection name to its declared field names.
public struct FrontmatterConventions: Sendable, Codable, Equatable {
    /// Collection name → declared field names, in schema order. Empty when the site has no
    /// `content.config.ts` (or it couldn't be parsed).
    public var collections: [String: [String]]

    /// Memberwise initializer.
    public init(collections: [String: [String]]) {
        self.collections = collections
    }
}

/// Which Astro components a site actually uses, so suggestions favor components the owner
/// already reaches for.
public struct ComponentConventions: Sendable, Codable, Equatable {
    /// Component tag name → number of usages across `.astro` files. A count, not a preference —
    /// which is why it's excluded from ``OverridableField``.
    public var usageCounts: Learned<[String: Int]>

    /// Memberwise initializer.
    public init(usageCounts: Learned<[String: Int]>) {
        self.usageCounts = usageCounts
    }
}

/// Alt-text habits inferred from the site's existing images, used to make generated alt text
/// (e.g. `AltTextGenerator`) match what the owner already writes.
public struct ImageConventions: Sendable, Codable, Equatable {
    /// Average character length of non-empty alt texts. `0` means no evidence yet.
    public var altTextAverageLength: Learned<Int>
    /// Whether a majority of alt texts end with sentence punctuation — a stylistic choice
    /// (screen-reader pause behavior) worth matching either way.
    public var altTextEndsWithPunctuation: Learned<Bool>

    /// Memberwise initializer.
    public init(altTextAverageLength: Learned<Int>, altTextEndsWithPunctuation: Learned<Bool>) {
        self.altTextAverageLength = altTextAverageLength
        self.altTextEndsWithPunctuation = altTextEndsWithPunctuation
    }
}

/// File-naming facts, so newly scaffolded pages/posts get slugs shaped like the existing ones.
public struct NamingConventions: Sendable, Codable, Equatable {
    /// Dominant slug style across `src/content/` and `src/pages/` file names.
    public var slugStyle: Learned<SlugStyle>

    /// Memberwise initializer.
    public init(slugStyle: Learned<SlugStyle>) {
        self.slugStyle = slugStyle
    }
}

/// SEO-relevant metadata habits inferred from existing frontmatter.
public struct SEOConventions: Sendable, Codable, Equatable {
    /// Average character length of non-empty frontmatter `description` values — a target for
    /// generated meta descriptions. `0` means no evidence yet.
    public var metaDescriptionAverageLength: Learned<Int>

    /// Memberwise initializer.
    public init(metaDescriptionAverageLength: Learned<Int>) {
        self.metaDescriptionAverageLength = metaDescriptionAverageLength
    }
}

/// One site's learned/edited project conventions. See the design doc for the taxonomy and the
/// override-preserving merge invariant.
public struct ProjectConventions: Sendable, Codable, Equatable {
    /// Prose style and brand voice.
    public var writing: WritingConventions
    /// Declared content-collection schemas — ground truth, never overridable.
    public var frontmatter: FrontmatterConventions
    /// Component usage counts.
    public var components: ComponentConventions
    /// Alt-text habits.
    public var images: ImageConventions
    /// Slug/file-naming habits.
    public var naming: NamingConventions
    /// Metadata habits.
    public var seo: SEOConventions
    /// When the last full extraction ran, or `nil` if this value has never been learned from
    /// disk (e.g. it's still ``empty`` or a seeded pre-restart snapshot).
    public var lastLearnedAt: Date?

    /// Memberwise initializer.
    public init(
        writing: WritingConventions,
        frontmatter: FrontmatterConventions,
        components: ComponentConventions,
        images: ImageConventions,
        naming: NamingConventions,
        seo: SEOConventions,
        lastLearnedAt: Date?
    ) {
        self.writing = writing
        self.frontmatter = frontmatter
        self.components = components
        self.images = images
        self.naming = naming
        self.seo = seo
        self.lastLearnedAt = lastLearnedAt
    }

    /// A zero-confidence, empty starting point — what a brand-new site (or a site that hasn't
    /// been scanned yet) reports.
    public static let empty = ProjectConventions(
        writing: WritingConventions(
            headingCapitalization: Learned(value: .mixed, source: .inferred(confidence: 0), sampleSize: 0),
            toneDescriptors: Learned(value: [], source: .inferred(confidence: 0), sampleSize: 0),
            brandTerms: Learned(value: [], source: .inferred(confidence: 0), sampleSize: 0)
        ),
        frontmatter: FrontmatterConventions(collections: [:]),
        components: ComponentConventions(
            usageCounts: Learned(value: [:], source: .inferred(confidence: 0), sampleSize: 0)
        ),
        images: ImageConventions(
            altTextAverageLength: Learned(value: 0, source: .inferred(confidence: 0), sampleSize: 0),
            altTextEndsWithPunctuation: Learned(value: false, source: .inferred(confidence: 0), sampleSize: 0)
        ),
        naming: NamingConventions(
            slugStyle: Learned(value: .mixed, source: .inferred(confidence: 0), sampleSize: 0)
        ),
        seo: SEOConventions(
            metaDescriptionAverageLength: Learned(value: 0, source: .inferred(confidence: 0), sampleSize: 0)
        ),
        lastLearnedAt: nil
    )
}

/// Every field a user can override from the Style Guide inspector (Task 10). Frontmatter
/// (ground truth) and component usage counts (a count, not a preference) are intentionally
/// excluded.
public enum OverridableField: String, Sendable, Codable, CaseIterable {
    /// ``WritingConventions/headingCapitalization``.
    case headingCapitalization
    /// ``WritingConventions/toneDescriptors``.
    case toneDescriptors
    /// ``WritingConventions/brandTerms``.
    case brandTerms
    /// ``WritingConventions/audience``.
    case audience
    /// ``WritingConventions/avoidPhrases``.
    case avoidPhrases
    /// ``ImageConventions/altTextAverageLength``.
    case altTextAverageLength
    /// ``ImageConventions/altTextEndsWithPunctuation``.
    case altTextEndsWithPunctuation
    /// ``NamingConventions/slugStyle``.
    case slugStyle
    /// ``SEOConventions/metaDescriptionAverageLength``.
    case metaDescriptionAverageLength
}

/// A typed value for one `OverridableField`. The case identifies the field; the payload is
/// already the right type for it, so callers can't set a `String` onto an `Int` field.
public enum OverrideValue: Sendable, Equatable {
    /// New value for ``OverridableField/headingCapitalization``.
    case headingCapitalization(HeadingCapitalization)
    /// New value for ``OverridableField/toneDescriptors``.
    case toneDescriptors([String])
    /// New value for ``OverridableField/brandTerms``.
    case brandTerms([String])
    /// New value for ``OverridableField/audience``.
    case audience(String)
    /// New value for ``OverridableField/avoidPhrases``.
    case avoidPhrases([String])
    /// New value for ``OverridableField/altTextAverageLength``.
    case altTextAverageLength(Int)
    /// New value for ``OverridableField/altTextEndsWithPunctuation``.
    case altTextEndsWithPunctuation(Bool)
    /// New value for ``OverridableField/slugStyle``.
    case slugStyle(SlugStyle)
    /// New value for ``OverridableField/metaDescriptionAverageLength``.
    case metaDescriptionAverageLength(Int)
}

extension ProjectConventions {
    /// Sets the matching field's value and flips its `source` to `.userOverride`.
    public mutating func apply(_ value: OverrideValue) {
        switch value {
        case .headingCapitalization(let v):
            writing.headingCapitalization = Learned(value: v, source: .userOverride)
        case .toneDescriptors(let v):
            writing.toneDescriptors = Learned(value: v, source: .userOverride)
        case .brandTerms(let v):
            writing.brandTerms = Learned(value: v, source: .userOverride)
        case .audience(let v):
            writing.audience = Learned(value: v, source: .userOverride)
        case .avoidPhrases(let v):
            writing.avoidPhrases = Learned(value: v, source: .userOverride)
        case .altTextAverageLength(let v):
            images.altTextAverageLength = Learned(value: v, source: .userOverride)
        case .altTextEndsWithPunctuation(let v):
            images.altTextEndsWithPunctuation = Learned(value: v, source: .userOverride)
        case .slugStyle(let v):
            naming.slugStyle = Learned(value: v, source: .userOverride)
        case .metaDescriptionAverageLength(let v):
            seo.metaDescriptionAverageLength = Learned(value: v, source: .userOverride)
        }
    }

    /// Reverts one field's `source` back to `.inferred`, keeping its current value in place until
    /// the next rebuild recomputes it fresh.
    public mutating func clearOverride(_ field: OverridableField) {
        switch field {
        case .headingCapitalization:
            writing.headingCapitalization.source = .inferred(confidence: 0)
        case .toneDescriptors:
            writing.toneDescriptors.source = .inferred(confidence: 0)
        case .brandTerms:
            writing.brandTerms.source = .inferred(confidence: 0)
        case .audience:
            writing.audience.source = .inferred(confidence: 0)
        case .avoidPhrases:
            writing.avoidPhrases.source = .inferred(confidence: 0)
        case .altTextAverageLength:
            images.altTextAverageLength.source = .inferred(confidence: 0)
        case .altTextEndsWithPunctuation:
            images.altTextEndsWithPunctuation.source = .inferred(confidence: 0)
        case .slugStyle:
            naming.slugStyle.source = .inferred(confidence: 0)
        case .metaDescriptionAverageLength:
            seo.metaDescriptionAverageLength.source = .inferred(confidence: 0)
        }
    }

    /// `self` is a freshly-recomputed rebuild result. Returns a copy where every field the user
    /// had overridden in `previous` is preserved verbatim; every other field keeps `self`'s fresh
    /// value. This is the invariant that makes re-learning safe to run automatically in the
    /// background without clobbering user edits.
    public func merging(overriddenFrom previous: ProjectConventions) -> ProjectConventions {
        var merged = self
        if previous.writing.headingCapitalization.isOverridden {
            merged.writing.headingCapitalization = previous.writing.headingCapitalization
        }
        if previous.writing.toneDescriptors.isOverridden {
            merged.writing.toneDescriptors = previous.writing.toneDescriptors
        }
        if previous.writing.brandTerms.isOverridden {
            merged.writing.brandTerms = previous.writing.brandTerms
        }
        if previous.writing.audience.isOverridden {
            merged.writing.audience = previous.writing.audience
        }
        if previous.writing.avoidPhrases.isOverridden {
            merged.writing.avoidPhrases = previous.writing.avoidPhrases
        }
        if previous.images.altTextAverageLength.isOverridden {
            merged.images.altTextAverageLength = previous.images.altTextAverageLength
        }
        if previous.images.altTextEndsWithPunctuation.isOverridden {
            merged.images.altTextEndsWithPunctuation = previous.images.altTextEndsWithPunctuation
        }
        if previous.naming.slugStyle.isOverridden {
            merged.naming.slugStyle = previous.naming.slugStyle
        }
        if previous.seo.metaDescriptionAverageLength.isOverridden {
            merged.seo.metaDescriptionAverageLength = previous.seo.metaDescriptionAverageLength
        }
        return merged
    }
}
