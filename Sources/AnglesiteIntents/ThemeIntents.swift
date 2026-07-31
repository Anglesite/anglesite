// Sources/AnglesiteIntents/ThemeIntents.swift
import AppIntents
import AnglesiteCore
import Foundation

/// Siri/Shortcuts front door for applying a built-in visual theme to a site.
///
/// `SiteEntity.directory` (set from `SiteStore.Site.packageURL` — see `SiteEntity.swift`) is the
/// `.anglesite` package root, not the `Source/` git directory. So this intent builds a real
/// `AnglesitePackage(url:)` from it and uses the package-based `DesignApplyService.apply`
/// overload, which re-derives `Source/` internally. (Contrast `SetupThemeTool` in
/// `AnglesiteCore`, which is handed an already-resolved `Source/` directory by the conversation
/// context and calls the `URL` overload directly — there is no phantom
/// `AnglesitePackage(sourceDirectory:)` initializer; it does not exist.)
public struct ApplyThemeIntent: AppIntent {
    /// The verb Siri/Shortcuts display and match against.
    public static let title: LocalizedStringResource = "Apply Theme"
    /// One-line explanation shown in the Shortcuts action gallery.
    public static let description = IntentDescription("Apply a built-in visual theme to a site.")

    /// The site whose design tokens the theme rewrites, resolved through ``SiteEntityQuery``.
    @Parameter(title: "Site") public var site: SiteEntity
    /// The catalog id of the theme. A plain string (not an `AppEnum`) so the catalog can grow
    /// without a schema change; an unrecognized id gets a dialog listing what's available
    /// rather than an error.
    @Parameter(title: "Theme", description: "e.g. warm, classic, bold, elegant.") public var themeID: String
    @Dependency private var catalog: ThemeCatalog

    /// Required by `AppIntent` — the runtime constructs the intent, then fills `@Parameter`s.
    public init() {}

    /// Shortcuts editor sentence: "Apply *theme* theme to *site*".
    public static var parameterSummary: some ParameterSummary {
        Summary("Apply \(\.$themeID) theme to \(\.$site)")
    }

    /// Looks up the theme, confirms (a theme rewrites the site's visual identity in place),
    /// and applies it through `DesignApplyService` — all dialog wording lives in `run()`.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: try await run()))
    }

    private func run() async throws -> String {
        // Tests bind ThemeCatalogOverride.scoped; production goes through @Dependency.
        let themeCatalog = ThemeCatalogOverride.scoped ?? catalog
        guard let theme = themeCatalog.theme(id: themeID) else {
            let names = themeCatalog.themes.map(\.name).joined(separator: ", ")
            return "I don't recognize that theme. Available: \(names)."
        }
        guard let packageURL = site.directory else {
            return "I couldn't find \(site.displayName)'s location."
        }
        // A bound override means we're under test — skip the real Siri confirmation UI, which
        // isn't introspectable under `swift test` (mirrors AddDNSRecordIntent/DeleteDNSRecordIntent).
        if ThemeCatalogOverride.scoped == nil {
            try await requestConfirmation(dialog: "Apply the \(theme.name) theme to \(site.displayName)?")
        }
        let package = AnglesitePackage(url: packageURL)
        let input = DesignApplyInput(
            cssVars: DesignTokenWriter.templateCSSVars(for: theme),
            rationaleMarkdown: nil,
            brandSummary: theme.blurb,
            sourceLabel: "Built-in theme: \(theme.name)"
        )
        let result = DesignApplyService.apply(input, to: package)
        return SetupThemeArguments.reply(for: result, themeName: theme.name)
    }
}

// MARK: - Test-only helpers

extension ApplyThemeIntent {
    /// Drives `perform`'s dialog logic directly, bypassing the AppIntents `@Dependency` gate and
    /// (since a bound override also skips `requestConfirmation`) the confirmation gate too.
    /// Only callable when `ThemeCatalogOverride.scoped` is bound.
    func performForTesting() async throws -> String {
        guard ThemeCatalogOverride.scoped != nil else {
            fatalError("performForTesting requires a bound ThemeCatalogOverride.scoped")
        }
        return try await run()
    }
}
