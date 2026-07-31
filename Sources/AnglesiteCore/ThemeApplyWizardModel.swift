// Sources/AnglesiteCore/ThemeApplyWizardModel.swift
import Foundation
import Observation
// URLSession lives in FoundationNetworking on non-Darwin platforms (swift-corelibs-foundation);
// this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Drives the "apply a design" wizard: pick a source (built-in theme vs. a freedesignmd.com
/// system), pick within that source, review, then apply via `DesignApplyService`. Shared by both
/// the built-in theme gallery and the freedesignmd browsing flow so there is exactly one
/// wizard-state machine rather than one per source.
@MainActor @Observable
public final class ThemeApplyWizardModel: Identifiable {
    /// The wizard's pages. `Int`-raw so step order is explicit; only one of
    /// `pickBuiltIn`/`browseFreedesignmd` is ever visited in a given run, per the chosen source.
    public enum Step: Int, CaseIterable {
        /// Choose between the built-in gallery and freedesignmd.com.
        case pickSource
        /// Built-in path: pick a theme from the catalog.
        case pickBuiltIn
        /// freedesignmd path: pick a design system from the ranked candidates.
        case browseFreedesignmd
        /// Confirm the selection before writing anything.
        case review
        /// The apply is running (or finished — check ``ThemeApplyWizardModel/applyResult``); no
        /// further navigation.
        case applying
    }
    /// Which design source the owner chose on the first step.
    public enum Source: Equatable {
        /// A theme bundled with the app's template (`ThemeCatalog`).
        case builtIn
        /// A design system fetched from freedesignmd.com.
        case freedesignmd
    }

    /// Stable identity for SwiftUI sheet/window presentation of one wizard run.
    public let id = UUID()
    /// The page currently shown; mutate via ``advance()``/``back()`` so the source-dependent
    /// branching stays in one place.
    public var step: Step = .pickSource
    /// The chosen source; `nil` until the first step is answered (which is what gates Continue).
    public var source: Source?
    /// The chosen built-in theme's id, when `source == .builtIn`.
    public var selectedBuiltInID: String?
    /// The ranked freedesignmd systems to offer (top 10 by business-type keyword match), loaded
    /// when the owner picks the freedesignmd source. Empty until then — or on fetch failure, in
    /// which case ``fetchError`` says why.
    public var freedesignmdCandidates: [FreedesignmdSystem] = []
    /// The chosen freedesignmd system's slug, when `source == .freedesignmd`.
    public var selectedFreedesignmdSlug: String?
    /// The site's business type, used to rank freedesignmd candidates by keyword relevance.
    public var businessType: String
    /// Terminal outcome of ``apply()`` — `nil` while the wizard is still in progress. Setter is
    /// internal: only the wizard's own apply flow may decide the outcome.
    public internal(set) var applyResult: Result<AppliedDesign, DesignApplyError>?
    /// Owner-readable message when fetching the freedesignmd catalog failed — kept separate from
    /// ``applyResult`` because a fetch failure is recoverable (go back, retry, or pick a
    /// built-in theme), not a terminal outcome.
    public internal(set) var fetchError: String?

    /// The built-in theme catalog to offer — held by the model so the gallery view and
    /// ``selectedBuiltInTheme`` resolve against the same catalog instance.
    public let catalog: ThemeCatalog
    private let package: AnglesitePackage
    private let session: URLSession

    /// Creates one wizard run for `package`. `session` is injectable so tests can stub the
    /// freedesignmd fetches without network access.
    public init(
        catalog: ThemeCatalog, businessType: String, package: AnglesitePackage, session: URLSession = .shared
    ) {
        self.catalog = catalog
        self.businessType = businessType
        self.package = package
        self.session = session
    }

    /// The full ``Theme`` for ``selectedBuiltInID``, resolved against ``catalog`` — `nil` when
    /// nothing is selected or the id isn't in the catalog.
    public var selectedBuiltInTheme: Theme? {
        selectedBuiltInID.flatMap(catalog.theme(id:))
    }

    /// Whether the current step has what it needs to advance — drives the Continue button's
    /// enablement so the view never encodes per-step validation itself.
    public var canContinue: Bool {
        switch step {
        case .pickSource: return source != nil
        case .pickBuiltIn: return selectedBuiltInID != nil
        case .browseFreedesignmd: return selectedFreedesignmdSlug != nil
        case .review: return true
        case .applying: return false
        }
    }

    /// Moves to the next step for the chosen source (a no-op when ``canContinue`` is false or
    /// the wizard is already at review/applying). `async` because entering the freedesignmd
    /// branch kicks off the candidate fetch as part of the same transition.
    public func advance() async {
        guard canContinue else { return }
        switch step {
        case .pickSource:
            step = source == .builtIn ? .pickBuiltIn : .browseFreedesignmd
            if source == .freedesignmd { await loadFreedesignmdCandidates() }
        case .pickBuiltIn, .browseFreedesignmd:
            step = .review
        case .review, .applying:
            break
        }
    }

    /// Moves to the previous step, retracing the source-dependent branch. Deliberately inert on
    /// the first step and while applying — an in-flight apply can't be backed out of.
    public func back() {
        switch step {
        case .pickBuiltIn, .browseFreedesignmd: step = .pickSource
        case .review: step = source == .builtIn ? .pickBuiltIn : .browseFreedesignmd
        case .pickSource, .applying: break
        }
    }

    private func loadFreedesignmdCandidates() async {
        do {
            let all = try await FreedesignmdCatalog.fetchSystemList(session: session)
            freedesignmdCandidates = Array(FreedesignmdCatalog.rank(all, byKeywordsIn: businessType).prefix(10))
        } catch {
            fetchError = "Couldn't reach freedesignmd.com — \((error as NSError).localizedDescription)"
        }
    }

    /// Runs the terminal apply for whichever source/selection the wizard holds, landing the
    /// outcome in ``applyResult``. A built-in theme writes its CSS vars via `DesignApplyService`;
    /// the freedesignmd path currently records only the system's description as brand rationale
    /// (its CSS-token translation is deliberately stubbed — see the inline note). A missing
    /// selection becomes a failure result rather than a trap, since the UI's enablement guards
    /// could be bypassed programmatically.
    public func apply() async {
        step = .applying
        switch source {
        case .builtIn:
            guard let theme = selectedBuiltInTheme else {
                applyResult = .failure(.writeFailed(message: "No theme selected to apply.", partiallyWritten: []))
                return
            }
            let input = DesignApplyInput(
                cssVars: DesignTokenWriter.templateCSSVars(for: theme),
                rationaleMarkdown: nil,
                brandSummary: theme.blurb,
                sourceLabel: "Built-in theme: \(theme.name)"
            )
            applyResult = DesignApplyService.apply(input, to: package)
        case .freedesignmd:
            guard let slug = selectedFreedesignmdSlug else {
                applyResult = .failure(.writeFailed(message: "No design system selected to apply.", partiallyWritten: []))
                return
            }
            // `try?` already flattens to `String??` -> `String?` (SE-0230); a fetch failure and a
            // page with no `<meta description>` both land here as `nil` and get the same fallback
            // brand summary below — that's an acceptable, intentional merge of the two cases.
            let description = try? await FreedesignmdCatalog.fetchDescription(slug: slug, session: session)
            // freedesignmd's per-system CSS-token translation (mapping a fetched DESIGN.md's
            // described tokens onto the template's 12 vars) is deliberately stubbed to `[:]` —
            // see the plan's Task 8/9 note. This flow currently only records the description as
            // brand rationale; it does not yet write new CSS vars.
            let input = DesignApplyInput(
                cssVars: [:],
                rationaleMarkdown: nil,
                brandSummary: description ?? "Applied from freedesignmd.com/system/\(slug).",
                sourceLabel: "freedesignmd: \(slug)"
            )
            applyResult = DesignApplyService.apply(input, to: package)
        case nil:
            applyResult = .failure(.writeFailed(message: "No design source selected to apply.", partiallyWritten: []))
        }
    }
}
