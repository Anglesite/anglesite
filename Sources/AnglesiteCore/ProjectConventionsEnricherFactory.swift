// Sources/AnglesiteCore/ProjectConventionsEnricherFactory.swift
import Foundation

/// Chooses the production `ProjectConventionsEngine.ConventionsEnricher`. `nil` pre-Xcode-27 (no
/// `FoundationModels`), matching `PageCopyGeneratorFactory`'s gating pattern — `AppDelegate`
/// constructs `ProjectConventionsEngine` with whatever this returns, so the engine works
/// identically (just without tone/brand enrichment) on the reduced CI toolchain.
public enum ProjectConventionsEnricherFactory {
    /// The production enricher: one on-device `FoundationModelAssistant` guided-generation call
    /// producing `GeneratedProjectConventions` from a sample of the site's text. Returns `nil`
    /// when the toolchain can't import `FoundationModels` (pre-Xcode-27 / reduced CI), which the
    /// engine treats as "extraction only, no tone/brand fields".
    public static func makeDefault() -> ProjectConventionsEngine.ConventionsEnricher? {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return { sampleText, context in
            let result = try await FoundationModelAssistant(tier: .onDevice).generateStructured(
                prompt: """
                Read the following excerpt from a website's content and describe its conventions.
                Excerpt:
                \(sampleText)
                """,
                context: context,
                resultType: GeneratedProjectConventions.self
            )
            return (toneDescriptors: result.toneDescriptors, brandTerms: result.brandTerms)
        }
        #else
        return nil
        #endif
    }
}
