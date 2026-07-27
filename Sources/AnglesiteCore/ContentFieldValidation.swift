// Sources/AnglesiteCore/ContentFieldValidation.swift
import Foundation

/// Value checks for `ContentTypeField` values, applied before a content entry is written to disk.
///
/// Scaffolding renders; this validates. Kept separate from `ContentScaffold` so the create path can
/// reject a bad value *before* asking for a render, and so the rules are testable on their own.
public enum ContentFieldValidation {
    /// Whether `value` is an absolute URL with a scheme **and** a non-empty host.
    ///
    /// Deliberately stricter than the template's `z.string().url()`, which accepts anything
    /// `new URL()` parses — including `mailto:` and other host-less schemes. A `.url` field feeds a
    /// `u-*` microformat property (`u-bookmark-of`, `u-in-reply-to`, `u-like-of`), which needs a
    /// dereferenceable target, so requiring a host is the useful rule. Anything accepted here is
    /// accepted by `z.string().url()`, so a value that passes never fails `astro check`.
    ///
    /// Mirrors the same host-not-just-scheme rule `IntegrationPlanner` applies to its `.url` fields.
    public static func isAbsoluteURL(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let components = URLComponents(string: trimmed),
              let scheme = components.scheme, !scheme.isEmpty,
              let host = components.host, !host.isEmpty
        else { return false }
        return true
    }
}
