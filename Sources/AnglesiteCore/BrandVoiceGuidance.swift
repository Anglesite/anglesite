import Foundation

/// Natural-language brand-voice preamble for content-help prompts (#465) — the general form of
/// `AltTextPromptBuilder`'s guidance, built from the site's learned/overridden `ProjectConventions`.
/// Pure and non-gated so it's unit-testable on CI.
public enum BrandVoiceGuidance {
    /// Returns `nil` when there is no voice signal at all — callers then omit the preamble
    /// entirely rather than prompt with boilerplate.
    public static func preamble(conventions: ProjectConventions?, businessType: String?) -> String? {
        var lines: [String] = []
        if let w = conventions?.writing {
            if hasSignal(w.toneDescriptors), !w.toneDescriptors.value.isEmpty {
                lines.append("Write in a \(w.toneDescriptors.value.joined(separator: ", ")) tone.")
            }
            if hasSignal(w.audience), !w.audience.value.isEmpty {
                lines.append("The audience is \(w.audience.value).")
            }
            if !w.brandTerms.value.isEmpty {
                lines.append("Use this site's own capitalization for brand/product terms when they appear: \(w.brandTerms.value.joined(separator: ", ")).")
            }
            if hasSignal(w.avoidPhrases), !w.avoidPhrases.value.isEmpty {
                lines.append("Never use these words or phrases: \(w.avoidPhrases.value.joined(separator: ", ")).")
            }
        }
        if let businessType, !businessType.isEmpty {
            lines.append("This is the website of a \(businessType).")
        }
        guard !lines.isEmpty else { return nil }
        return (["Match this site's voice:"] + lines).joined(separator: "\n")
    }

    /// A `Learned` value counts if the user set it, it was inferred from real samples, or the
    /// enricher inferred it with positive confidence (the enricher writes confidence without
    /// sampleSize — see ProjectConventionsEngine.maybeEnrich).
    static func hasSignal<V>(_ learned: Learned<V>) -> Bool {
        if learned.isOverridden { return true }
        if learned.sampleSize.map({ $0 > 0 }) == true { return true }
        if case .inferred(let confidence) = learned.source, confidence > 0 { return true }
        return false
    }
}

/// Reads `BUSINESS_TYPE` from the site's `Source/.site-config`, the same key the markdown
/// skills used. `nil` when the file or key is absent.
public enum SiteBusinessType {
    /// Reads `BUSINESS_TYPE` fresh from disk on every call — the file is tiny and callers only
    /// ask at prompt-build time, so caching would just risk staleness after an external edit
    /// (`.site-config` lives in `Source/`, which the owner can edit outside the app).
    public static func read(sourceDirectory: URL) -> String? {
        let url = sourceDirectory.appendingPathComponent(".site-config")
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return SiteConfigFile.value(forKey: "BUSINESS_TYPE", in: contents)
    }
}

/// Reads display values from `Source/.site-config`, falling back sensibly.
public enum SiteConfigValues {
    /// The site's display name: `SITE_NAME` from `.site-config` when present and non-empty,
    /// otherwise the source directory's own name — a plain checkout with no config still gets a
    /// usable label. `nil` only when even the directory name is empty, so callers can supply
    /// their own placeholder for that degenerate case.
    public static func siteName(sourceDirectory: URL) -> String? {
        let url = sourceDirectory.appendingPathComponent(".site-config")
        if let contents = try? String(contentsOf: url, encoding: .utf8),
           let name = SiteConfigFile.value(forKey: "SITE_NAME", in: contents), !name.isEmpty {
            return name
        }
        let dirName = sourceDirectory.lastPathComponent
        return dirName.isEmpty ? nil : dirName
    }
}
