import Foundation

/// The licenses the Content Licensing facet offers, and the two rules relating a chosen license to
/// the site's AI usage permissions (#991).
///
/// The classification is deliberately narrow. Whether model training is a "derivative work" or a
/// "commercial use" is a live legal question, so only licenses whose grant unambiguously covers
/// any use are marked `permitsAIUse`; NC and ND variants, custom URLs, and all-rights-reserved are
/// left unclassified rather than interpreted. That follows the spike's rule that Anglesite never
/// asserts on the user's behalf — see
/// docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md §Q3.
public enum LicenseCatalog {
    /// One offered license: stable picker identity, display strings, and the app-side AI-use
    /// classification (which is deliberately *not* part of what gets stored — see `ref`).
    public struct Entry: Sendable, Equatable, Hashable, Identifiable {
        /// Stable across releases — it is the SwiftUI picker tag, not display text.
        public let id: String
        /// Display name shown in the picker, e.g. "CC BY 4.0".
        public let name: String
        /// Canonical deed URL — the identity `entry(for:)` matches stored licenses on.
        public let url: String
        /// True when the license's grant unambiguously covers AI training and AI answers.
        public let permitsAIUse: Bool

        /// The `LicenseRef` this entry stores and publishes — URL + name only. The
        /// `permitsAIUse` classification stays app-side, because it is Anglesite's reading of
        /// the license, not something to assert on the user's behalf (see the type doc).
        public var ref: LicenseRef { LicenseRef(url: url, name: name) }
    }

    /// The offered licenses in picker order: CC0 first, then the CC 4.0 suite from most to
    /// least permissive. Extending this list requires the same "unambiguous grant" test the
    /// type doc describes before setting `permitsAIUse`.
    public static let entries: [Entry] = [
        Entry(id: "cc0-1.0", name: "CC0 1.0",
              url: "https://creativecommons.org/publicdomain/zero/1.0/", permitsAIUse: true),
        Entry(id: "cc-by-4.0", name: "CC BY 4.0",
              url: "https://creativecommons.org/licenses/by/4.0/", permitsAIUse: true),
        Entry(id: "cc-by-sa-4.0", name: "CC BY-SA 4.0",
              url: "https://creativecommons.org/licenses/by-sa/4.0/", permitsAIUse: true),
        Entry(id: "cc-by-nc-4.0", name: "CC BY-NC 4.0",
              url: "https://creativecommons.org/licenses/by-nc/4.0/", permitsAIUse: false),
        Entry(id: "cc-by-nd-4.0", name: "CC BY-ND 4.0",
              url: "https://creativecommons.org/licenses/by-nd/4.0/", permitsAIUse: false),
        Entry(id: "cc-by-nc-sa-4.0", name: "CC BY-NC-SA 4.0",
              url: "https://creativecommons.org/licenses/by-nc-sa/4.0/", permitsAIUse: false),
        Entry(id: "cc-by-nc-nd-4.0", name: "CC BY-NC-ND 4.0",
              url: "https://creativecommons.org/licenses/by-nc-nd/4.0/", permitsAIUse: false),
    ]

    /// The catalog entry a stored license refers to, matched on URL — a hand-edited `name` should
    /// not stop the picker recognizing a standard license. nil means custom or none.
    public static func entry(for license: LicenseRef?) -> Entry? {
        guard let license else { return nil }
        return entries.first { $0.url == license.url }
    }

    /// Suggests AI permissions consistent with a newly-chosen license, filling **only** purposes
    /// the user has not stated. Overwriting a stated purpose would silently discard a deliberate
    /// choice, so this never does; an unclassified license suggests nothing at all.
    public static func prefilled(_ usage: AIUsage, for license: LicenseRef?) -> AIUsage {
        guard entry(for: license)?.permitsAIUse == true else { return usage }
        var filled = usage
        if filled.search == .unset { filled.search = .yes }
        if filled.aiInput == .unset { filled.aiInput = .yes }
        if filled.aiTrain == .unset { filled.aiTrain = .yes }
        return filled
    }

    /// Why the facet should show an inline note, or nil when there is nothing to say. The typed
    /// case (rather than a `String`) keeps user-facing copy in the app module where Xcode's string
    /// extraction can reach it.
    public enum CoherenceWarning: Sendable, Equatable {
        /// The site default license already grants an AI use the policy asks crawlers not to make.
        case licensePermitsDeniedUse(licenseName: String)
    }

    /// Fires only for a classified license against a denied AI purpose — the one contradiction
    /// detectable without interpreting license text. Permitting *more* than a restrictive license
    /// requires is never flagged: it is the user's own content, and they may grant what they like.
    /// `search` is not an AI purpose and never triggers this.
    public static func coherenceWarning(for license: LicenseRef?, usage: AIUsage) -> CoherenceWarning? {
        guard let entry = entry(for: license), entry.permitsAIUse else { return nil }
        guard usage.aiInput == .no || usage.aiTrain == .no else { return nil }
        return .licensePermitsDeniedUse(licenseName: entry.name)
    }
}
