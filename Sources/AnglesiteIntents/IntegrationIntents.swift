import AppIntents
import AnglesiteCore
import Foundation

// MARK: - Dialog formatting (pure, unit-testable)

/// Pure dialog strings for the three integration intents. No AppIntents types, so these are
/// fully unit-testable without the AppIntents runtime.
public enum IntegrationDialogs {
    /// Success dialog once `IntegrationOperationsService.apply` reports `.done`.
    public static func applied(integration: String, siteName: String) -> String {
        "Set up \(integration) on \(siteName)."
    }
    /// Failure dialog for both a plan-stage error and an apply-stage `.failed` terminal state;
    /// `reason` carries whichever message the service surfaced.
    public static func failed(reason: String, siteName: String) -> String {
        "Couldn't finish that on \(siteName): \(reason)."
    }
    /// Frames a plan summary as a review prompt, for flows that read the plan back before
    /// applying (the shipped intents confirm with a shorter fixed sentence instead).
    public static func planPrompt(summary: String) -> String {
        "Here's the plan:\n\(summary)"
    }
}

// MARK: - Shared non-opaque helper

/// Executes plan→apply without the AppIntents confirmation gate. Returns the dialog string.
/// Used by `confirmAndApplyForTesting` (test seam) and by `perform()` after the production
/// confirmation is already handled by `requestConfirmation`.
private func applyIntegration(
    ops: any IntegrationOperationsService,
    id: IntegrationID,
    answers: Answers,
    site: SiteEntity
) async -> String {
    switch await ops.plan(integrationID: id, answers: answers, siteID: site.id) {
    case .failure(let e):
        return IntegrationDialogs.failed(reason: "\(e)", siteName: site.displayName)
    case .success(let plan):
        let terminal = await ops.apply(plan, siteID: site.id)
        switch terminal {
        case .done(let integrationID):
            return IntegrationDialogs.applied(integration: integrationID, siteName: site.displayName)
        case .failed(_, let message):
            return IntegrationDialogs.failed(reason: message, siteName: site.displayName)
        default:
            return IntegrationDialogs.failed(reason: "incomplete", siteName: site.displayName)
        }
    }
}

// MARK: - Add Booking

/// Siri/Shortcuts entry point for the booking integration (`IntegrationID.booking`). Thin
/// shim: parameters become an `Answers` dict and the shared plan→apply path does the rest,
/// so Siri and the GUI wizard exercise the exact same integration machinery.
public struct AddBookingIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "Add Booking"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Add a Cal.com or Calendly booking widget to a site."
    )

    /// The target site, resolved from the recents registry via ``SiteEntity``'s query.
    @Parameter(title: "Site") public var site: SiteEntity
    /// Booking provider key (`cal` or `calendly`) — validated by the integration's plan step,
    /// not here, so the accepted set stays owned by the descriptor.
    @Parameter(title: "Provider", description: "cal or calendly.") public var provider: String
    /// The owner's username/handle on the chosen provider — what the embedded widget points at.
    @Parameter(title: "Username") public var username: String
    /// Widget placement (`inline`, `floating`, or `button`); optional, defaulting to `inline`
    /// so a spoken invocation doesn't have to know placements exist.
    @Parameter(title: "Placement", description: "inline, floating, or button.") public var style: String?
    @Dependency private var ops: any IntegrationOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Add booking to (site)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Add booking to \(\.$site)")
    }

    /// Confirms (booking wires an external widget into the site), then runs plan→apply and
    /// reports the outcome as dialog. The confirmation is skipped when
    /// ``IntegrationOperationsOverride`` is bound — `requestConfirmation` needs the live
    /// Siri/Shortcuts runtime, which unit tests don't have.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = IntegrationOperationsOverride.scoped ?? ops
        let answers: Answers = [
            "provider": provider,
            "username": username,
            "style": style ?? "inline",
        ]
        // Confirm before writing: booking wires external widgets into the site.
        if IntegrationOperationsOverride.scoped == nil {
            try await requestConfirmation(
                dialog: "Add \(provider) booking to \(site.displayName)?"
            )
        }
        let dialog = await applyIntegration(ops: svc, id: .booking, answers: answers, site: site)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

// MARK: - Add Donations

/// Siri/Shortcuts entry point for the donations integration (`IntegrationID.donations`).
/// Same thin plan→apply shim shape as ``AddBookingIntent``.
public struct AddDonationsIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "Add Donations"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Add a donation button (Stripe, Liberapay, or GitHub Sponsors) to a site."
    )

    /// The target site, resolved from the recents registry via ``SiteEntity``'s query.
    @Parameter(title: "Site") public var site: SiteEntity
    /// Donation provider key (`stripe`, `liberapay`, or `githubSponsors`) — validated by the
    /// integration's plan step, not here.
    @Parameter(title: "Provider", description: "stripe, liberapay, or githubSponsors.") public var provider: String
    /// The provider-hosted donation URL the button links to — the owner pastes it rather than
    /// the app holding any payment credentials.
    @Parameter(title: "Donation link") public var link: String
    @Dependency private var ops: any IntegrationOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Add donations to (site)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Add donations to \(\.$site)")
    }

    /// Confirms, then runs plan→apply and reports the outcome as dialog. The confirmation is
    /// skipped when ``IntegrationOperationsOverride`` is bound — `requestConfirmation` needs
    /// the live Siri/Shortcuts runtime, which unit tests don't have.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = IntegrationOperationsOverride.scoped ?? ops
        let answers: Answers = [
            "provider": provider,
            "link": link,
        ]
        if IntegrationOperationsOverride.scoped == nil {
            try await requestConfirmation(
                dialog: "Add \(provider) donation button to \(site.displayName)?"
            )
        }
        let dialog = await applyIntegration(ops: svc, id: .donations, answers: answers, site: site)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

// MARK: - Add Comments (giscus)

/// Siri/Shortcuts entry point for giscus comments (`IntegrationID.giscus`). Deliberately a
/// reduced surface relative to the GUI wizard — see the hardcoded-answers note in `perform()`.
public struct AddGiscusIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation. "Add Comments"
    /// (not "Add giscus") — users ask for the capability, not the vendor.
    public static let title: LocalizedStringResource = "Add Comments"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Add giscus GitHub-Discussions-backed comments to a site's blog posts."
    )

    /// The target site, resolved from the recents registry via ``SiteEntity``'s query.
    @Parameter(title: "Site") public var site: SiteEntity
    /// GitHub repository in `owner/repo` form whose Discussions back the comments.
    @Parameter(title: "Repository", description: "owner/repo.") public var repo: String
    /// giscus's opaque repository ID (from giscus.app setup) — required alongside `repo`
    /// because the embed script can't look it up itself.
    @Parameter(title: "Repository ID") public var repoId: String
    /// giscus's opaque Discussions-category ID (from giscus.app setup).
    @Parameter(title: "Category ID") public var categoryId: String
    @Dependency private var ops: any IntegrationOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Add comments to (site)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Add comments to \(\.$site)")
    }

    /// Confirms, then runs plan→apply with category ("Announcements") and mapping ("pathname")
    /// hardcoded — a deliberate v1 reduction to keep the Siri surface minimal (see inline
    /// note). The confirmation is skipped when ``IntegrationOperationsOverride`` is bound —
    /// `requestConfirmation` needs the live Siri/Shortcuts runtime, which unit tests don't have.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = IntegrationOperationsOverride.scoped ?? ops
        // Deliberate API reduction (v1): category and mapping are hardcoded below rather than
        // exposed as @Parameters, to keep the Siri surface minimal. The descriptor's defaultValues
        // ("Announcements" / "pathname") drive the GUI/FM wizard paths, not Siri. Add @Parameters
        // for category/mapping if a later iteration needs Siri control over them.
        let answers: Answers = [
            "repo": repo,
            "repoId": repoId,
            "category": "Announcements",
            "categoryId": categoryId,
            "mapping": "pathname",
        ]
        if IntegrationOperationsOverride.scoped == nil {
            try await requestConfirmation(
                dialog: "Add giscus comments to \(site.displayName)?"
            )
        }
        let dialog = await applyIntegration(ops: svc, id: .giscus, answers: answers, site: site)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

// MARK: - Add Store (router)

/// Siri-facing mirror of `StoreCategory` (AnglesiteCore) for ``AddStoreIntent``'s "what are
/// you selling?" question. Raw values match the core enum case-for-case so the internal
/// `core` bridge can convert by rawValue; keep the two in lockstep when adding cases.
public enum StoreCategoryAppEnum: String, AppEnum, Sendable, CaseIterable {
    /// A service or one-off — routes to a Stripe-preset buy button.
    case service
    /// Donations or fundraising — routes to the donations integration.
    case donations
    /// Digital downloads — routes via ``DigitalPreferenceAppEnum`` (Polar by default).
    case digitalDownloads
    /// Physical goods — routes via ``CatalogSizeAppEnum`` (Snipcart or Shopify Buy Button).
    case physicalGoods
    /// Software or SaaS licensing — routes to Paddle.
    case software

    /// Kind name Siri/Shortcuts shows for this choice list.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Store Category" }
    /// Owner-language phrasing for each choice — what the user is selling, never the
    /// integration vendor that answering will route to.
    public static let caseDisplayRepresentations: [StoreCategoryAppEnum: DisplayRepresentation] = [
        .service: "A service or one-off",
        .donations: "Donations or fundraising",
        .digitalDownloads: "Digital downloads",
        .physicalGoods: "Physical goods",
        .software: "Software or SaaS",
    ]

    var core: StoreCategory { StoreCategory(rawValue: rawValue)! }
}

/// Siri-facing mirror of `DigitalPreference` (AnglesiteCore) — the digital-downloads
/// follow-up question. Raw values match the core enum so the internal `core` bridge can
/// convert by rawValue.
public enum DigitalPreferenceAppEnum: String, AppEnum, Sendable, CaseIterable {
    /// Polar — the default route (a Polar-preset buy button) when no preference is given.
    case polar
    /// Lemon Squeezy — routes to the dedicated Lemon Squeezy integration.
    case lemonSqueezy

    /// Kind name Siri/Shortcuts shows for this choice list.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Digital Platform" }
    /// Display phrasing for each platform choice.
    public static let caseDisplayRepresentations: [DigitalPreferenceAppEnum: DisplayRepresentation] = [
        .polar: "Polar", .lemonSqueezy: "Lemon Squeezy",
    ]

    var core: DigitalPreference { DigitalPreference(rawValue: rawValue)! }
}

/// Siri-facing mirror of `CatalogSize` (AnglesiteCore) — the physical-goods follow-up
/// question. Raw values match the core enum so the internal `core` bridge can convert by
/// rawValue.
public enum CatalogSizeAppEnum: String, AppEnum, Sendable, CaseIterable {
    /// Just a few products — the default route (Snipcart) when no answer is given.
    case few
    /// A full, growing catalog — routes to the Shopify Buy Button integration.
    case catalog

    /// Kind name Siri/Shortcuts shows for this choice list.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Catalog Size" }
    /// Display phrasing for each size choice.
    public static let caseDisplayRepresentations: [CatalogSizeAppEnum: DisplayRepresentation] = [
        .few: "Just a few", .catalog: "A full, growing catalog",
    ]

    var core: CatalogSize { CatalogSize(rawValue: rawValue)! }
}

/// Siri/Shortcuts entry point for the "Add a Store" wizard. Unlike the single-integration
/// intents above, this one routes: `AddStoreRouter` picks the right commerce integration
/// from what the owner is selling (plus at most one follow-up answer), mirroring the GUI
/// wizard, so the owner never has to know vendor names to get the right setup.
public struct AddStoreIntent: AppIntent {
    /// Display name in the Shortcuts action library and Siri disambiguation.
    public static let title: LocalizedStringResource = "Add a Store"
    /// Longer explanation shown under the action in the Shortcuts editor.
    public static let description = IntentDescription(
        "Answer a couple of questions and Anglesite sets up the right commerce integration."
    )

    /// The target site, resolved from the recents registry via ``SiteEntity``'s query.
    @Parameter(title: "Site") public var site: SiteEntity
    /// The routing question — determines which integration gets set up.
    @Parameter(title: "What are you selling?") public var category: StoreCategoryAppEnum
    /// Follow-up for ``StoreCategoryAppEnum/digitalDownloads`` only; other categories ignore
    /// it. Optional so the router's Polar default applies when unanswered.
    @Parameter(title: "Digital platform", description: "polar or lemonSqueezy — only used for digital downloads.")
    public var digitalPreference: DigitalPreferenceAppEnum?
    /// Follow-up for ``StoreCategoryAppEnum/physicalGoods`` only; other categories ignore it.
    /// Optional so the router's Snipcart default applies when unanswered.
    @Parameter(title: "Catalog size", description: "few or catalog — only used for physical goods.")
    public var catalogSize: CatalogSizeAppEnum?
    /// Escape hatch for the routed integration's remaining fields, as `key=value` pairs
    /// parsed by `SetupIntegrationArguments.parseConfig` — the routed target isn't known until
    /// runtime, so its fields can't be typed `@Parameter`s here. Missing required fields
    /// surface as a plan-stage reprompt rather than a hard failure.
    @Parameter(title: "Details", description: "Remaining field values as key=value pairs, e.g. checkoutUrl=https://buy.stripe.com/xyz.")
    public var config: String?
    @Dependency private var ops: any IntegrationOperationsService

    /// AppIntents requires a parameterless initializer; the framework populates `@Parameter`s
    /// after construction.
    public init() {}

    /// Shortcuts-editor sentence: "Add a store to (site)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Add a store to \(\.$site)")
    }

    /// Routes, plans, confirms, applies. Planning happens *before* the confirmation so a
    /// missing-field reprompt reaches the user without them confirming an apply that could
    /// never run; only a plan that succeeded gets confirmed and applied. The confirmation is
    /// skipped when ``IntegrationOperationsOverride`` is bound — `requestConfirmation` needs
    /// the live Siri/Shortcuts runtime, which unit tests don't have.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let svc = IntegrationOperationsOverride.scoped ?? ops
        let (route, descriptor, answers) = resolvedRoute()
        let planResult = await svc.plan(integrationID: route.integrationID, answers: answers, siteID: site.id)
        if case .failure = planResult {
            let reply = SetupIntegrationArguments.reply(for: planResult, descriptor: descriptor)
            return .result(dialog: IntentDialog(stringLiteral: reply))
        }
        if IntegrationOperationsOverride.scoped == nil {
            try await requestConfirmation(
                dialog: "Set up \(descriptor.displayName) on \(site.displayName)?"
            )
        }
        let dialog = await applyIntegration(ops: svc, id: route.integrationID, answers: answers, site: site)
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }

    /// Pure: computes the route, its descriptor, and the merged answers dict. Shared by
    /// `perform()` and `confirmAndApplyForTesting()` so the two stay in lockstep.
    private func resolvedRoute() -> (AddStoreRouter.Route, IntegrationDescriptor, Answers) {
        let route = AddStoreRouter.route(
            category: category.core,
            digitalPreference: digitalPreference?.core,
            catalogSize: catalogSize?.core
        )
        var answers = SetupIntegrationArguments.parseConfig(config)
        if let preset = route.presetProvider {
            answers["provider"] = preset
        }
        let descriptor = IntegrationCatalog.descriptor(for: route.integrationID)
        return (route, descriptor, answers)
    }
}

// MARK: - Test-only helpers

extension AddBookingIntent {
    /// Drives plan→apply directly, bypassing the AppIntents `requestConfirmation` gate.
    /// Only callable when `IntegrationOperationsOverride.scoped` is bound.
    func confirmAndApplyForTesting() async throws -> String {
        guard let svc = IntegrationOperationsOverride.scoped else {
            fatalError("confirmAndApplyForTesting requires a bound IntegrationOperationsOverride.scoped")
        }
        let answers: Answers = [
            "provider": provider,
            "username": username,
            "style": style ?? "inline",
        ]
        return await applyIntegration(ops: svc, id: .booking, answers: answers, site: site)
    }
}

extension AddDonationsIntent {
    /// Drives plan→apply directly, bypassing the AppIntents `requestConfirmation` gate.
    /// Only callable when `IntegrationOperationsOverride.scoped` is bound.
    func confirmAndApplyForTesting() async throws -> String {
        guard let svc = IntegrationOperationsOverride.scoped else {
            fatalError("confirmAndApplyForTesting requires a bound IntegrationOperationsOverride.scoped")
        }
        let answers: Answers = [
            "provider": provider,
            "link": link,
        ]
        return await applyIntegration(ops: svc, id: .donations, answers: answers, site: site)
    }
}

extension AddGiscusIntent {
    /// Drives plan→apply directly, bypassing the AppIntents `requestConfirmation` gate.
    /// Only callable when `IntegrationOperationsOverride.scoped` is bound.
    func confirmAndApplyForTesting() async throws -> String {
        guard let svc = IntegrationOperationsOverride.scoped else {
            fatalError("confirmAndApplyForTesting requires a bound IntegrationOperationsOverride.scoped")
        }
        let answers: Answers = [
            "repo": repo,
            "repoId": repoId,
            "category": "Announcements",
            "categoryId": categoryId,
            "mapping": "pathname",
        ]
        return await applyIntegration(ops: svc, id: .giscus, answers: answers, site: site)
    }
}

extension AddStoreIntent {
    /// Drives plan→(reprompt|apply) without the AppIntents confirmation gate. Only callable when
    /// `IntegrationOperationsOverride.scoped` is bound.
    func confirmAndApplyForTesting() async throws -> String {
        guard let svc = IntegrationOperationsOverride.scoped else {
            fatalError("confirmAndApplyForTesting requires a bound IntegrationOperationsOverride.scoped")
        }
        let (route, descriptor, answers) = resolvedRoute()
        let planResult = await svc.plan(integrationID: route.integrationID, answers: answers, siteID: site.id)
        if case .failure = planResult {
            return SetupIntegrationArguments.reply(for: planResult, descriptor: descriptor)
        }
        return await applyIntegration(ops: svc, id: route.integrationID, answers: answers, site: site)
    }
}
