import Foundation

/// On-device–suggested short copy (SEO meta description) for a newly created page or post.
/// Non-gated so `NativeContentOperations` and CI-run tests can reference it regardless of
/// toolchain; the `@Generable` counterpart (`GeneratedPageCopySuggestion`) lives behind the
/// FoundationModels gate.
public struct PageCopySuggestion: Equatable, Sendable {
    /// The suggested SEO meta description, ready to write into the page's `description:`
    /// frontmatter as-is.
    public let description: String

    /// Wraps a generated description in the portable, non-gated suggestion type.
    public init(description: String) {
        self.description = description
    }
}

/// Seam for suggesting short copy for a new page/post title. A `nil` return means the on-device
/// model was unavailable or generation failed — callers fall back to a deterministic default.
public protocol PageCopyGenerating: Sendable {
    /// Suggests an SEO meta description for a new page/post named `title`. `siteID` and
    /// `siteDirectory` give implementations the site context (brand voice, business type) to
    /// ground the copy. Deliberately non-throwing: generation is best-effort garnish, so any
    /// failure collapses to `nil` and page creation proceeds with the deterministic default.
    func suggestDescription(title: String, siteID: String, siteDirectory: URL) async -> PageCopySuggestion?
}

/// Fallback conformer used when `FoundationModels` isn't compiled in (CI / pre-Xcode-27).
public struct NoopPageCopyGenerator: PageCopyGenerating {
    /// Creates the no-op generator. Stateless.
    public init() {}
    /// Always `nil`, so every caller takes its deterministic-default path.
    public func suggestDescription(title: String, siteID: String, siteDirectory: URL) async -> PageCopySuggestion? {
        nil
    }
}

/// Gates a base generator behind a user setting (`AppSettings.autoGeneratePageCopy`), mirroring
/// how `AltTextGenerator` is gated behind `autoGenerateAltText`. Skips the base generator entirely
/// when disabled, rather than calling it and discarding the result.
public struct SettingsGatedPageCopyGenerator: PageCopyGenerating {
    private let isEnabled: @Sendable () -> Bool
    private let base: any PageCopyGenerating

    /// Wraps `base` behind a setting check.
    ///
    /// - Parameters:
    ///   - isEnabled: Read on every call, not captured once at construction, so toggling the
    ///     setting takes effect without rebuilding the generator.
    ///   - base: The generator consulted when the setting is on.
    public init(isEnabled: @escaping @Sendable () -> Bool, base: any PageCopyGenerating) {
        self.isEnabled = isEnabled
        self.base = base
    }

    /// Forwards to the base generator, or returns `nil` without invoking it when disabled.
    public func suggestDescription(title: String, siteID: String, siteDirectory: URL) async -> PageCopySuggestion? {
        guard isEnabled() else { return nil }
        return await base.suggestDescription(title: title, siteID: siteID, siteDirectory: siteDirectory)
    }
}
