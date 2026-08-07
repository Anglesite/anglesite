import Foundation

/// Classifies a legacy `public/.well-known/security.txt` — written before #743 introduced
/// `SECURITY_TXT_MARKER` — as Anglesite's own historical output or hand-authored content
/// (design doc "Detection: security.txt (new: SecurityTxtModeMigration)"). Pure; no filesystem
/// access, no `.site-config` parsing — callers pass the already-read raw values.
public enum SecurityTxtLegacyClassifier {
    /// Whether `existingContent` matches exactly what the pre-#743 generator would have written
    /// from the site's *current* `SECURITY_CONTACT`/`SITE_URL`. `Expires` is inherently
    /// time-variant, so only its line shape is checked, never its value.
    public enum Classification: Sendable, Equatable {
        /// The content matches the old generator's shape exactly — safe to adopt as generated.
        case matchesLegacyShape
        /// The content doesn't match (different contact, extra content, hand-formatting, or no
        /// current contact to reconstruct against) — must be preserved as hand-authored.
        case doesNotMatch
    }

    /// Classifies `existingContent` (the file's current text) against `rawContact` (the site's
    /// current, undecoded `.site-config` `SECURITY_CONTACT` value — read as one whole string,
    /// matching what the pre-#843 generator read before comma-list support existed) and
    /// `siteURL` (the current `.site-config` `SITE_URL`).
    public static func classify(
        existingContent: String,
        rawContact: String?,
        siteURL: String?
    ) -> Classification {
        guard let reconstructed = legacyBody(rawContact: rawContact, siteURL: siteURL) else {
            return .doesNotMatch
        }
        return matches(existingContent, reconstructed) ? .matchesLegacyShape : .doesNotMatch
    }

    /// What the pre-#743 `buildSecurityTxt` would have emitted, or `nil` when no usable contact
    /// exists to reconstruct — mirrors `edge-artifacts.ts`'s exact shape as of commit
    /// `71301584^` (before #743's marker/RFC-9116-hardening rewrite): `Contact:`/`Expires:`/
    /// `Canonical:`, no marker, single contact only.
    private static func legacyBody(rawContact: String?, siteURL: String?) -> LegacyBody? {
        guard let contactURI = legacyContactURI(rawContact) else { return nil }
        let trimmedSiteURL = (siteURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let origin = (trimmedSiteURL.isEmpty ? "https://example.com" : trimmedSiteURL)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        return LegacyBody(contactURI: contactURI, canonical: "\(origin)/.well-known/security.txt")
    }

    private struct LegacyBody {
        let contactURI: String
        let canonical: String
    }

    /// Reproduces the pre-#743 `buildSecurityTxt`'s contact normalization exactly: an
    /// `http(s):`/`mailto:`/`tel:` URI is used as-is (unlike the current generator, the old one
    /// accepted insecure `http://`), a bare value containing `@` becomes a `mailto:` URI,
    /// anything else is unusable.
    private static func legacyContactURI(_ raw: String?) -> String? {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.range(of: "^(https?:|mailto:|tel:)", options: [.regularExpression, .caseInsensitive]) != nil {
            return trimmed
        }
        if trimmed.contains("@") { return "mailto:\(trimmed)" }
        return nil
    }

    /// True when `content`'s `Contact:`/`Canonical:` lines match `expected` exactly and an
    /// `Expires:` line with a parseable ISO-8601 value sits between them — `Expires` itself is
    /// never compared since it's recomputed fresh on every build. Tolerates the file's trailing
    /// newline (an empty final element from the split) but nothing else past `Canonical:`.
    private static func matches(_ content: String, _ expected: LegacyBody) -> Bool {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard lines.count == 3 || (lines.count == 4 && lines[3].isEmpty) else { return false }
        guard lines[0] == "Contact: \(expected.contactURI)" else { return false }
        guard lines[1].hasPrefix("Expires: "), isPlausibleISO8601(String(lines[1].dropFirst("Expires: ".count)))
        else { return false }
        return lines[2] == "Canonical: \(expected.canonical)"
    }

    /// `ISO8601DateFormatter` needs `.withFractionalSeconds` to parse `Date.toISOString()`'s
    /// millisecond suffix (what the old generator emitted); falls back to the no-fraction variant
    /// so a hand-typed `Expires:` without milliseconds isn't misclassified as unparseable.
    private static func isPlausibleISO8601(_ value: String) -> Bool {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if withFraction.date(from: value) != nil { return true }
        return ISO8601DateFormatter().date(from: value) != nil
    }
}
