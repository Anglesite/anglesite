// Sources/AnglesiteCore/SetupThemeTool.swift
import Foundation

/// Pure, non-gated helpers so parse/reply logic is unit-testable on CI, mirroring
/// `SetupIntegrationArguments`.
public enum SetupThemeArguments {
    /// Maps a ``DesignApplyService`` apply result to the chat reply the FM tool returns.
    ///
    /// Failures are worded for the site owner, not the developer: no error types, no file-system
    /// vocabulary. The partial-write case names the files that were already updated because
    /// ``DesignApplyError/writeFailed(message:partiallyWritten:)`` carries that list precisely so the
    /// reply can warn that the site is in a mixed state until a retry.
    public static func reply(for result: Result<AppliedDesign, DesignApplyError>, themeName: String) -> String {
        switch result {
        case .success:
            return "Applied the \(themeName) theme."
        case .failure(.missingGlobalCSS):
            return "I couldn't find this site's stylesheet, so I couldn't apply \(themeName)."
        case .failure(.missingRootBlock):
            return "This site's stylesheet doesn't have the expected structure, so I couldn't apply \(themeName)."
        case .failure(.writeFailed(let message, let partiallyWritten)):
            guard !partiallyWritten.isEmpty else {
                return "Applying \(themeName) failed: \(message)."
            }
            let files = partiallyWritten.joined(separator: ", ")
            return "Applying \(themeName) failed partway through: \(message). Some files were already updated (\(files)) — the site may be in a mixed state until you try again."
        }
    }
}

#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// FoundationModels tool letting the on-device assistant apply a built-in theme by id.
///
/// Gated to the Xcode-27 toolchain *and* `canImport(FoundationModels)` (see
/// `SetupIntegrationTool` for the rationale) — which is why everything unit-testable lives in
/// the non-gated `SetupThemeArguments` / `DesignApplyService` instead of here.
public struct SetupThemeTool: Tool, Sendable {
    /// The tool's wire name — a `static` mirror of `name` so call sites (transcript
    /// inspection, logging) can match tool invocations without constructing the tool.
    public static let toolName = "setupTheme"
    /// `Tool` conformance: the name the model calls this tool by.
    public let name = SetupThemeTool.toolName
    /// `Tool` conformance: the prompt-visible description the model uses to decide when to
    /// call this tool.
    public let description = "Apply one of the built-in visual themes to the current site."

    /// The model-generated argument payload for a `setupTheme` call.
    @Generable
    public struct Arguments {
        /// The catalog id of the theme to apply. An id the catalog doesn't recognize is not an
        /// error — ``SetupThemeTool/call(arguments:)`` answers with the list of available
        /// themes so the model can retry.
        @Guide(description: "The theme id to apply, e.g. 'warm', 'classic', 'bold'.")
        public var themeID: String
    }

    private let catalog: ThemeCatalog
    /// The site's `Source/` directory — the same value `AssistantContext.siteDirectory` carries,
    /// which `DesignApplyService.apply(_:to:)`'s `URL` overload expects directly. (Not an
    /// `AnglesitePackage`: the package-based overload re-derives `Source/` from a package root,
    /// and the conversation context only ever hands tools the already-resolved source directory.)
    private let sourceDirectory: URL

    /// Creates the tool bound to one site's theme catalog and resolved `Source/` directory
    /// (see the `sourceDirectory` note above for why it's a `URL`, not a package).
    public init(catalog: ThemeCatalog, sourceDirectory: URL) {
        self.catalog = catalog
        self.sourceDirectory = sourceDirectory
    }

    /// Resolves the requested theme and applies it via `DesignApplyService`, always returning
    /// a user-facing chat reply rather than throwing: an unrecognized id gets a corrective
    /// reply listing the available themes, and apply failures are worded by
    /// `SetupThemeArguments.reply(for:themeName:)`.
    public func call(arguments: Arguments) async throws -> String {
        guard let theme = catalog.theme(id: arguments.themeID) else {
            let names = catalog.themes.map(\.name).joined(separator: ", ")
            return "I don't recognize that theme. Available themes: \(names)."
        }
        let input = DesignApplyInput(
            cssVars: DesignTokenWriter.templateCSSVars(for: theme),
            rationaleMarkdown: nil,
            brandSummary: theme.blurb,
            sourceLabel: "Built-in theme: \(theme.name)"
        )
        let result = DesignApplyService.apply(input, to: sourceDirectory)
        return SetupThemeArguments.reply(for: result, themeName: theme.name)
    }
}
#endif
