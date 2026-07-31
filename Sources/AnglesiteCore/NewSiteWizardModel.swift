import Foundation
import Observation

/// Observable state machine behind the New Site wizard: step navigation, draft validation,
/// and scaffold progress. All wizard rules (what "can continue" means per step, when the
/// name collides, when the finished site may open) live here rather than in the views, so
/// they can be unit-tested without SwiftUI.
@MainActor
@Observable
public final class NewSiteWizardModel {
    /// The wizard's pages, in presentation order — ``NewSiteWizardModel/advance()`` /
    /// ``NewSiteWizardModel/back()`` walk the raw values, so case order here *is* the wizard flow.
    public enum Step: Int, CaseIterable {
        /// Name + domain choice — the only step with hard validation (``NewSiteWizardModel/detailsError``).
        case details
        /// Broad site category (``SiteType``); picking one re-seeds the default theme.
        case type
        /// Theme selection, including the ``CustomTheme`` own-colors escape hatch.
        case look
        /// Optional homepage content (headline, blurb, hero image) — skippable.
        case content
        /// Save location and package file name.
        case save
        /// Terminal step while ``NewSiteWizardModel/build(using:)`` runs; `canContinue` is
        /// always `false` here.
        case building
    }

    /// The step currently shown. Mutated only via ``advance()``/``back()`` and ``build(using:)``.
    public var step: Step = .details
    /// The accumulating answers; a plain value handed to the scaffolder unchanged at build time.
    public var draft = NewSiteDraft(siteType: .business, name: "")
    /// Drives the Image Playground sheet presentation in the Content step (#92).
    public var showingImagePlayground = false
    /// Every ``SiteScaffolder/ScaffoldStep`` emitted so far, in order — the Building step's
    /// live checklist. Append-only; never trimmed, so warnings stay visible after completion.
    public private(set) var progress: [SiteScaffolder.ScaffoldStep] = []
    /// The `.failed` step, if any — kept separately from ``progress`` so the UI can branch on
    /// "the build died" without re-scanning the whole stream.
    public private(set) var fatal: SiteScaffolder.ScaffoldStep?
    /// The new site's registered id once scaffolding reaches `.done`; `nil` until then (or on
    /// failure). Gate opening the site on ``didCompleteCleanly``, not just this being non-nil.
    public private(set) var completedSiteID: String?

    /// Themes offered in the Look step; also supplies the per-type default seeded by
    /// ``choose(type:)`` and the initializer.
    public let catalog: ThemeCatalog
    /// Pre-selected save location for the Save step (typically `~/Sites/`); `nil` lets the
    /// save panel fall back to its own default.
    public let defaultSaveDirectory: URL?
    private let slugTaken: @Sendable (String) -> Bool

    /// Creates the model and seeds the draft's theme with the catalog default for the initial
    /// site type, so the Look step never starts with nothing selected.
    ///
    /// - Parameters:
    ///   - catalog: Themes for the Look step and the per-type default seeding.
    ///   - defaultSaveDirectory: Pre-selected save location for the Save step; `nil` defers
    ///     to the save panel's own default.
    ///   - slugTaken: Injected collision check against the recents registry — the model
    ///     deliberately doesn't know about `SiteStore`, keeping it testable with a plain
    ///     closure.
    public init(catalog: ThemeCatalog, defaultSaveDirectory: URL? = nil, slugTaken: @escaping @Sendable (String) -> Bool) {
        self.catalog = catalog
        self.defaultSaveDirectory = defaultSaveDirectory
        self.slugTaken = slugTaken
        // Seed a default theme for the initial type.
        draft.themeID = catalog.defaultThemeID(for: draft.siteType)
    }

    /// The folder slug the current name would produce (``SiteSlug/derive(from:)``), shown live
    /// in the Details step so owners see the URL-ish identity their name implies before committing.
    public var slugPreview: String { SiteSlug.derive(from: draft.name) }

    /// Default `.anglesite` package file name derived from the slug; used verbatim when the
    /// owner leaves the Save step's name field empty (see ``build(using:)``).
    public var defaultSaveFileName: String { "\(slugPreview).anglesite" }

    /// Non-fatal build warnings (e.g. a failed install), surfaced so a failure isn't hidden behind a dead-end preview (#229).
    public var warnings: [String] {
        progress.compactMap { if case .warning(_, let message) = $0 { return message } else { return nil } }
    }

    /// Convenience over ``warnings`` for the wizard's "finished with warnings" branch.
    public var hasWarnings: Bool { !warnings.isEmpty }

    /// Site registered with no warnings — only then may the wizard open it immediately (else it stays put so warnings are read) (#229).
    public var didCompleteCleanly: Bool { completedSiteID != nil && !hasWarnings }

    /// Owner-facing validation message for the Details step, or `nil` when there's nothing to
    /// show. An empty name is deliberately *not* an error — it's merely "incomplete" (Continue
    /// stays disabled via ``canContinue``), so the owner isn't scolded before they've typed
    /// anything. The only real error is a slug collision with an existing site.
    public var detailsError: String? {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return nil }              // empty is "incomplete", not an error to show
        if slugTaken(slugPreview) { return "A site named \u{201C}\(slugPreview)\u{201D} already exists." }
        return nil
    }

    /// The `workers.dev` hostname the site will get before a custom domain is attached, shown
    /// in the Details step so "decide later" still promises a concrete public address.
    public var cloudflareDevPreview: String {
        "\(slugPreview).workers.dev"
    }

    /// Per-step gate for the wizard's Continue button. Notably: `.content` is always passable
    /// (content is optional), `.building` never is (the build owns navigation from there), and
    /// `.details` additionally requires a valid domain only when the owner chose to transfer one.
    public var canContinue: Bool {
        switch step {
        case .details:
            return !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && detailsError == nil
                && (draft.domainChoice != .transfer || Self.isValidDomain(draft.domain))
        case .type:    return true
        case .look:    return draft.themeID == CustomTheme.id || catalog.theme(id: draft.themeID) != nil
        case .content: return true                  // content is optional
        case .save:    return true
        case .building: return false
        }
    }

    /// Records the site-type choice and re-seeds the type's default theme — unless the owner
    /// already picked custom colors, which survive a type change on purpose (an explicit
    /// aesthetic choice shouldn't be silently discarded by browsing types).
    public func choose(type: SiteType) {
        draft.siteType = type
        if draft.themeID != CustomTheme.id {
            draft.themeID = catalog.defaultThemeID(for: type)
        }
    }

    /// Syntactic hostname check for the domain-transfer field: at least one dot, no whitespace,
    /// and RFC-952/1123-shaped labels (≤63 chars, no leading/trailing hyphen). Deliberately
    /// *not* a registrability or DNS check — the wizard only needs to catch typos before the
    /// deploy flow takes over.
    public static func isValidDomain(_ domain: String) -> Bool {
        let trimmed = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("."),
              trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              trimmed.range(of: #"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"#,
                            options: .regularExpression) != nil
        else { return false }
        return true
    }

    /// Image Playground generation concepts for the current draft (#92).
    public var heroImageConcepts: [String] {
        HeroImage.concepts(name: draft.name, siteType: draft.siteType, tagline: draft.tagline, imageDescription: draft.heroImagePrompt)
    }

    /// Whether a hero image has been generated and staged for scaffolding.
    public var hasHeroImage: Bool { draft.heroImageURL != nil }

    /// Store the URL of an image generated by Image Playground (or clear it).
    public func setHeroImage(_ url: URL?) { draft.heroImageURL = url }

    /// Moves to the next ``Step`` in declaration order; a no-op at the last step (no wrap-around).
    public func advance() { if let next = Step(rawValue: step.rawValue + 1) { step = next } }
    /// Moves to the previous ``Step``; a no-op at the first step.
    public func back() { if let prev = Step(rawValue: step.rawValue - 1) { step = prev } }

    /// Runs the scaffolder, accumulating progress. Returns the new site id on success.
    public func build(using scaffolder: SiteScaffolder) async -> String? {
        step = .building
        if draft.saveFileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft.saveFileName = defaultSaveFileName
        }
        if draft.headline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft.headline = draft.name
        }
        for await s in scaffolder.scaffold(draft) {
            progress.append(s)
            if case .failed = s { fatal = s }
            if case .done(let id) = s { completedSiteID = id }
        }
        return completedSiteID
    }
}
