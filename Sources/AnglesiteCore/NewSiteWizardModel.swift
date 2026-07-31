import Foundation
import Observation

/// Observable state behind the New Site template chooser (#1071): theme selection, Untitled
/// naming, and scaffold progress. All rules (when Create is enabled, what the site is named,
/// when the finished site may open) live here rather than in the views, so they can be
/// unit-tested without SwiftUI.
///
/// The chooser deliberately asks exactly one question — which template — the iWork model.
/// Name ("Untitled"), save location (the sites root), domain (deferred to publish), and
/// homepage content (the template's placeholder copy) are all defaulted, not asked.
@MainActor
@Observable
public final class NewSiteWizardModel {
    /// The chooser's two states; ``NewSiteWizardModel/build(using:)`` is the only transition.
    public enum Step: Int, CaseIterable {
        /// The template grid — the only step with user input.
        case chooser
        /// Terminal step while ``NewSiteWizardModel/build(using:)`` runs; ``canCreate`` is
        /// always `false` here.
        case building
    }

    /// The step currently shown. Mutated only by ``build(using:)``.
    public private(set) var step: Step = .chooser
    /// The answers handed to the scaffolder at build time. Only ``NewSiteDraft/themeID`` is
    /// user-set (via the grid); everything else keeps the Untitled defaults from init.
    public var draft: NewSiteDraft
    /// Every ``SiteScaffolder/ScaffoldStep`` emitted so far, in order — the Building step's
    /// live checklist. Append-only; never trimmed, so warnings stay visible after completion.
    public private(set) var progress: [SiteScaffolder.ScaffoldStep] = []
    /// The `.failed` step, if any — kept separately from ``progress`` so the UI can branch on
    /// "the build died" without re-scanning the whole stream.
    public private(set) var fatal: SiteScaffolder.ScaffoldStep?
    /// The new site's registered id once scaffolding reaches `.done`; `nil` until then (or on
    /// failure). Gate opening the site on ``didCompleteCleanly``, not just this being non-nil.
    public private(set) var completedSiteID: String?

    /// Themes shown in the grid; the first entry is pre-selected (no site type exists to drive
    /// the per-type default table).
    public let catalog: ThemeCatalog

    /// Creates the model with a fully-defaulted Untitled draft.
    ///
    /// - Parameters:
    ///   - catalog: Themes for the grid; its first entry seeds ``NewSiteDraft/themeID``.
    ///   - isNameTaken: Availability check for a candidate display name (e.g. "Untitled 2").
    ///     The caller decides what "taken" means — the launcher checks both the recents
    ///     registry and the sites root on disk. Non-escaping: consulted only here, at init.
    public init(catalog: ThemeCatalog, isNameTaken: (String) -> Bool) {
        self.catalog = catalog
        let name = Self.untitledName(isTaken: isNameTaken)
        // headline "" on purpose (overriding NewSiteDraft's default of `name`): the scaffolder
        // skips the homepage write for a contentless draft, leaving the template's placeholder
        // copy for the owner to edit in the preview (#1071).
        var draft = NewSiteDraft(siteType: .blank, name: name,
                                 saveFileName: "\(name).anglesite", headline: "")
        draft.themeID = catalog.themes.first?.id ?? ""
        self.draft = draft
    }

    /// First free name in "Untitled", "Untitled 2", "Untitled 3", … — the Mac document
    /// convention. Not localized: AnglesiteCore has no string catalog (app-target only).
    static func untitledName(isTaken: (String) -> Bool) -> String {
        for n in 1...9999 {
            let candidate = n == 1 ? "Untitled" : "Untitled \(n)"
            if !isTaken(candidate) { return candidate }
        }
        // 9999 collisions means something is systematically wrong; fall back to a unique name
        // rather than looping forever.
        return "Untitled \(UUID().uuidString.prefix(8))"
    }

    /// Gate for the chooser's Create button (and double-click): a real catalog theme is
    /// selected and no build is running.
    public var canCreate: Bool {
        step == .chooser && catalog.theme(id: draft.themeID) != nil
    }

    /// Non-fatal build warnings (e.g. a failed install), surfaced so a failure isn't hidden behind a dead-end preview (#229).
    public var warnings: [String] {
        progress.compactMap { if case .warning(_, let message) = $0 { return message } else { return nil } }
    }

    /// Convenience over ``warnings`` for the chooser's "finished with warnings" branch.
    public var hasWarnings: Bool { !warnings.isEmpty }

    /// Site registered with no warnings — only then may the chooser open it immediately (else it stays put so warnings are read) (#229).
    public var didCompleteCleanly: Bool { completedSiteID != nil && !hasWarnings }

    /// Runs the scaffolder, accumulating progress. Returns the new site id on success.
    public func build(using scaffolder: SiteScaffolder) async -> String? {
        step = .building
        for await s in scaffolder.scaffold(draft) {
            progress.append(s)
            if case .failed = s { fatal = s }
            if case .done(let id) = s { completedSiteID = id }
        }
        return completedSiteID
    }
}
