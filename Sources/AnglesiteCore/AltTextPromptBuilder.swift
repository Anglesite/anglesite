// Sources/AnglesiteCore/AltTextPromptBuilder.swift
import Foundation

/// Builds the alt-text generation prompt, optionally prefixed with a short guidance preamble
/// drawn from the site's learned `ProjectConventions` (#313). A pure function — kept separate
/// from `AltTextGenerator` and `SiteAssistantSessionFactory` so it's directly unit-testable
/// without constructing either.
public enum AltTextPromptBuilder {
    /// Returns `basePrompt` prefixed with a guidance preamble when the site's conventions carry
    /// real signal; otherwise the bare prompt unchanged. Each guidance line is gated on an
    /// override or a positive sample size so a freshly created site's zero-valued defaults never
    /// masquerade as learned style.
    public static func build(basePrompt: String, conventions: ProjectConventions?) -> String {
        guard let conventions, let preamble = guidance(from: conventions) else { return basePrompt }
        return "\(preamble)\n\n\(basePrompt)"
    }

    private static func guidance(from conventions: ProjectConventions) -> String? {
        var lines: [String] = []
        let altLength = conventions.images.altTextAverageLength
        if altLength.isOverridden || altLength.sampleSize.map({ $0 > 0 }) == true {
            lines.append("Aim for around \(altLength.value) characters, matching this site's existing alt text.")
        }
        let endsWithPunctuation = conventions.images.altTextEndsWithPunctuation
        if (endsWithPunctuation.isOverridden || endsWithPunctuation.sampleSize.map({ $0 > 0 }) == true),
           endsWithPunctuation.value {
            lines.append("This site's existing alt text tends toward full sentences ending with punctuation.")
        }
        if !conventions.writing.brandTerms.value.isEmpty {
            let terms = conventions.writing.brandTerms.value.joined(separator: ", ")
            lines.append("Use this site's own capitalization for brand/product terms when they appear: \(terms).")
        }
        guard !lines.isEmpty else { return nil }
        return (["This site has learned conventions to match:"] + lines).joined(separator: "\n")
    }
}
