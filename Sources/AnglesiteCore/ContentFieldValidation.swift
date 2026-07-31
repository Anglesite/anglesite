// Sources/AnglesiteCore/ContentFieldValidation.swift
import Foundation

/// Value checks shared by anything that accepts a `ContentTypeField`-shaped value, applied before
/// that value is persisted or otherwise acted on.
///
/// Scaffolding renders; this validates. Kept separate from `ContentScaffold` so a create path can
/// reject a bad value *before* asking for a render, and so the rules are testable on their own.
/// Not limited to content entries — `IntegrationPlanner` also validates its `.url` fields against
/// `isAbsoluteURL` below, since a wizard field feeding a CSP domain has the same host and
/// port/whitespace hazards as a `u-*` microformat property does.
public enum ContentFieldValidation {
    /// Whether `value` is an absolute URL with a scheme **and** a non-empty host.
    ///
    /// Deliberately stricter than the template's `z.string().url()`, which accepts anything
    /// `new URL()` parses — including `mailto:` and other host-less schemes. A `.url` field feeds a
    /// `u-*` microformat property (`u-bookmark-of`, `u-in-reply-to`, `u-like-of`) or a CSP domain
    /// entry, both of which need a dereferenceable target, so requiring a host is the useful rule.
    /// Anything accepted here is accepted by `z.string().url()` — including the port range, see
    /// below — so a value that passes never fails `astro check`.
    ///
    /// The single definition of "is this a URL" for the module — see #1016.
    public static func isAbsoluteURL(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              // `URLComponents` rejects an interior space but happily parses an interior or
              // trailing newline (unlike `new URL()`/WHATWG, which reject both) — and
              // `ContentScaffold.escapeYAML` only escapes `\` and `"`, not newlines. A value with a
              // raw newline would therefore pass this check but split the YAML frontmatter line it's
              // written into (e.g. `bookmarkOf: "https://example.com/post\nevil: true"` becomes two
              // YAML lines). No legitimate absolute URL contains raw whitespace, so reject any that
              // does, after trimming, rather than relying on the parser to catch it.
              trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              let components = URLComponents(string: trimmed),
              let scheme = components.scheme, !scheme.isEmpty,
              let host = components.host, !host.isEmpty,
              // `URLComponents` parses ports above 65535 (e.g. `:99999`) without complaint, but the
              // WHATWG URL parser behind `z.string().url()` rejects anything outside 0...65535 — so
              // this bound has to be enforced here to keep the two parsers' accept sets in sync.
              components.port.map { (0...65_535).contains($0) } ?? true
        else { return false }
        return true
    }
}
