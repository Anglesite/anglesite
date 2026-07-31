import AppIntents
import AnglesiteCore
import Foundation

/// Opens (or focuses) `site`'s window and requests its design-interview sheet
/// (`SiteWindowModel.presentDesignInterview()`, consumed via
/// `WindowRouter.consumeDesignInterviewRequest(for:)`) — the same request/consume shape
/// `PreviewSiteIntent` uses for its page-route navigation. The interview itself runs in the GUI
/// panel, not as a multi-turn App Intent — Siri's role is only the entry point.
public struct StartDesignInterviewIntent: AppIntent {
    /// The verb phrase Shortcuts/Siri/Spotlight show for this action.
    public static let title: LocalizedStringResource = "Start Design Interview"
    /// One-line explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription("Start a conversation to design your site's look and feel.")
    /// The interview is a GUI conversation — the app must come forward for the sheet to appear,
    /// so this can't run as a background intent.
    public static let openAppWhenRun = true

    /// The site whose look and feel the interview will redesign, resolved by ``SiteEntityQuery``.
    @Parameter(title: "Site") public var site: SiteEntity

    /// Required by `AppIntent`; the AppIntents runtime fills the `@Parameter` value after
    /// construction.
    public init() {}

    /// The sentence the Shortcuts editor renders: "Start a design interview for *site*".
    public static var parameterSummary: some ParameterSummary {
        Summary("Start a design interview for \(\.$site)")
    }

    /// Posts the interview request to ``WindowRouter`` (main-actor — the router is UI state) and
    /// hands off; the sheet is presented asynchronously once the site window exists.
    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        WindowRouter.shared.requestDesignInterview(siteID: site.id)
        return .result(dialog: IntentDialog(stringLiteral: "Let's design \(site.displayName). Opening chat…"))
    }
}
