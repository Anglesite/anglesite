// Sources/AnglesiteCore/AddStoreRouter.swift

/// What the owner is selling — mirrors the plugin's `add-store` skill intake question.
public enum StoreCategory: String, CaseIterable, Sendable {
    /// A service the owner provides (consulting, sessions, commissions) — a single buy button
    /// suffices, no catalog.
    case service
    /// Tips/donations rather than a sale — routes to the dedicated donations integration, not a
    /// checkout.
    case donations
    /// Downloadable files (ebooks, presets, music) — the one category with a platform follow-up,
    /// ``DigitalPreference``.
    case digitalDownloads
    /// Physical products that ship — the one category with a size follow-up, ``CatalogSize``.
    case physicalGoods
    /// Software licensing/subscriptions — routed to Paddle, the merchant-of-record option built
    /// for that billing model.
    case software
}

/// Digital-download platform preference — only relevant when `category == .digitalDownloads`.
public enum DigitalPreference: String, CaseIterable, Sendable {
    /// Polar via the buy-button integration — the default when the owner doesn't answer the
    /// follow-up (see ``AddStoreRouter/route(category:digitalPreference:catalogSize:)``).
    case polar
    /// The dedicated Lemon Squeezy overlay integration.
    case lemonSqueezy
}

/// Physical-goods catalog size — only relevant when `category == .physicalGoods`.
public enum CatalogSize: String, CaseIterable, Sendable {
    /// A handful of products — Snipcart, which needs no external dashboard. The default when the
    /// owner doesn't answer the follow-up.
    case few
    /// A full catalog — Shopify Buy Button, whose dashboard earns its setup cost at this scale.
    case catalog
}

/// Deterministic routing for the "Add a Store" wizard entry point: given what the owner is
/// selling (and, where relevant, one follow-up answer), decides which existing
/// `IntegrationDescriptor` to open and with which provider preset. Mirrors the plugin's
/// `add-store` skill routing table, minus the revenue-tracking webhook step (deferred — see
/// docs/superpowers/specs/2026-07-05-add-store-wizard-router-design.md).
public enum AddStoreRouter {
    /// The wizard's destination: which integration to open, and which provider it should be
    /// pre-set to when that integration offers a choice.
    public struct Route: Sendable, Equatable {
        /// The integration whose ``IntegrationDescriptor`` sheet the wizard opens.
        public let integrationID: IntegrationID
        /// Raw provider identifier (e.g. `stripe`, `polar`) the opened integration should
        /// pre-select, or `nil` when the integration has no provider choice to make.
        public let presetProvider: String?
        /// Memberwise initializer — public so tests can assert routes without invoking
        /// ``AddStoreRouter/route(category:digitalPreference:catalogSize:)``.
        public init(integrationID: IntegrationID, presetProvider: String?) {
            self.integrationID = integrationID
            self.presetProvider = presetProvider
        }
    }

    /// Resolves the owner's answers to a ``Route``. The follow-up parameters are only consulted
    /// for the category they belong to, and an unanswered follow-up falls back to a sensible
    /// default (Polar for downloads, Snipcart for physical goods) — the wizard must always land
    /// somewhere, never dead-end on a skipped question.
    public static func route(
        category: StoreCategory,
        digitalPreference: DigitalPreference? = nil,
        catalogSize: CatalogSize? = nil
    ) -> Route {
        switch category {
        case .service:
            return Route(integrationID: .buyButton, presetProvider: "stripe")
        case .donations:
            return Route(integrationID: .donations, presetProvider: nil)
        case .digitalDownloads:
            switch digitalPreference {
            case .lemonSqueezy:
                return Route(integrationID: .lemonSqueezy, presetProvider: nil)
            case .polar, .none:
                return Route(integrationID: .buyButton, presetProvider: "polar")
            }
        case .physicalGoods:
            switch catalogSize {
            case .catalog:
                return Route(integrationID: .shopifyBuyButton, presetProvider: nil)
            case .few, .none:
                return Route(integrationID: .snipcart, presetProvider: nil)
            }
        case .software:
            return Route(integrationID: .paddle, presetProvider: nil)
        }
    }
}
