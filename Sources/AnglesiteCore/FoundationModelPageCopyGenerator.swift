import Foundation

/// Chooses the page-copy generator for the current toolchain. Non-gated so `NativeContentOperations`
/// can default its dependency without importing FoundationModels.
public enum PageCopyGeneratorFactory {
    /// Returns the best generator the current toolchain can build: the on-device
    /// `FoundationModelPageCopyGenerator` on Xcode 27+/Darwin, else a no-op that always
    /// yields `nil` so callers fall through to their deterministic title-derived default.
    /// The branch is compile-time, mirroring the `#if compiler(>=6.4)` gate below, which is
    /// why the return type is the non-gated `any PageCopyGenerating`.
    public static func makeDefault() -> any PageCopyGenerating {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return FoundationModelPageCopyGenerator()
        #else
        return NoopPageCopyGenerator()
        #endif
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// On-device short-copy generator: suggests an SEO meta description for a new page/post title
/// via guided generation. Any failure — including `AssistantError.unavailable` when Apple
/// Intelligence is off — collapses to `nil` so the caller falls back to a deterministic default.
public struct FoundationModelPageCopyGenerator: PageCopyGenerating {
    /// Creates a generator. Stateless — the assistant session is built per call, so one
    /// instance can serve every new-page flow.
    public init() {}

    /// Suggests an SEO meta description for the given page title, or `nil` on any failure
    /// (blank title, Apple Intelligence off, generation error, or a blank model output) —
    /// the protocol contract is best-effort, and `nil` must always mean "use the
    /// deterministic default", never "use an empty description".
    public func suggestDescription(title: String, siteID: String, siteDirectory: URL) async -> PageCopySuggestion? {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return nil }
        let context = AssistantContext(siteID: siteID, siteDirectory: siteDirectory)
        do {
            let generated = try await FoundationModelAssistant(tier: .onDevice).generateStructured(
                prompt: Self.prompt(for: cleanTitle),
                context: context,
                resultType: GeneratedPageCopySuggestion.self
            )
            guard let description = Self.normalizedDescription(generated.description) else { return nil }
            return PageCopySuggestion(description: description)
        } catch {
            return nil
        }
    }

    /// The model's `@Guide` is a hint, not an enforced constraint — it can legally return a blank
    /// string. Collapse that to `nil` so a degenerate model output can't beat "no suggestion" and
    /// silently override `ContentScaffold`'s title-derived default with an empty description.
    static func normalizedDescription(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func prompt(for title: String) -> String {
        """
        A website owner is creating a new page titled "\(title)". Write a single, concise SEO \
        meta description sentence for this page (under 160 characters). Do not repeat the title \
        verbatim; describe what a visitor would find on the page.
        """
    }
}
#endif
