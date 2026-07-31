import Foundation

/// The fixed progression of the design interview. `Int`-raw so
/// ``DesignInterviewDraft/advance()`` can step to the next stage numerically — declaration
/// order is therefore load-bearing, not cosmetic.
public enum ConversationStage: Int, Sendable, Equatable, CaseIterable {
    /// What the site is for and who it's for — deliberately no visual-style talk yet.
    case intent
    /// The visual mood the owner wants, reflected back to them as axis shifts.
    case mood
    /// Whether an existing brand color or reference look should anchor the design.
    case brandAnchor
    /// Plain-language summary of the resulting axes for the owner to confirm or adjust.
    case axisConfirmation
    /// Interview complete; the design has been applied.
    case done
}

/// A fixed nudge applied to one axis when the user's free text names a direction rather than a
/// slider value (e.g. "make it warmer"). Each hint moves its axis by a flat 0.15, clamped to [0,1].
public enum DesignAdjectiveHint: String, Sendable, CaseIterable {
    /// ``DesignAxes/temperature`` up — toward warm.
    case warmer
    /// ``DesignAxes/temperature`` down — toward cool.
    case cooler
    /// ``DesignAxes/weight`` up — toward dense.
    case denser
    /// ``DesignAxes/weight`` down — toward airy.
    case airier
    /// ``DesignAxes/register`` up — toward authoritative.
    case moreAuthoritative
    /// ``DesignAxes/register`` down — toward playful.
    case morePlayful
    /// ``DesignAxes/time`` down — toward classic.
    case moreClassic
    /// ``DesignAxes/time`` up — toward contemporary.
    case moreContemporary
    /// ``DesignAxes/voice`` up — toward bold.
    case bolder
    /// ``DesignAxes/voice`` down — toward subtle.
    case subtler

    var keyPath: WritableKeyPath<DesignAxes, Double> {
        switch self {
        case .warmer, .cooler: return \.temperature
        case .denser, .airier: return \.weight
        case .moreAuthoritative, .morePlayful: return \.register
        case .moreClassic, .moreContemporary: return \.time
        case .bolder, .subtler: return \.voice
        }
    }

    var delta: Double {
        switch self {
        case .warmer, .denser, .moreAuthoritative, .moreContemporary, .bolder: return 0.15
        case .cooler, .airier, .morePlayful, .moreClassic, .subtler: return -0.15
        }
    }
}

/// The mutable working state of one design interview — a plain value (no model or UI types), so
/// the conversation's state transitions are testable without a live assistant and could be
/// checkpointed cheaply.
public struct DesignInterviewDraft: Sendable, Equatable {
    /// Where the conversation currently is; stepped by ``advance()`` after each turn.
    public var stage: ConversationStage
    /// The owner-declared business type — seeds ``axes`` and grounds every stage's prompt.
    public var businessType: String
    /// Current axis positions: seeded from ``DesignAxesCatalog/defaults(forBusinessType:)``,
    /// then refined by turns and ``applyAdjectiveHint(_:)`` nudges.
    public var axes: DesignAxes
    /// The owner's brand color if one surfaced during the interview; `nil` lets the palette be
    /// derived from the axes alone.
    public var brandColorHex: String?
    /// Owner remarks that didn't map to a structured field — kept so nothing the owner said is
    /// silently dropped when the draft is later reviewed or extended.
    public var freeTextNotes: [String]

    /// Seeds a fresh draft at ``ConversationStage/intent`` with the business type's default
    /// axes, so an owner who bails out early still has a usable design position.
    public init(businessType: String) {
        self.stage = .intent
        self.businessType = businessType
        self.axes = DesignAxesCatalog.defaults(forBusinessType: businessType)
        self.brandColorHex = nil
        self.freeTextNotes = []
    }

    /// Steps to the next ``ConversationStage``. A no-op at ``ConversationStage/done`` rather
    /// than a trap, so the interview loop can advance unconditionally after every turn.
    public mutating func advance() {
        guard let next = ConversationStage(rawValue: stage.rawValue + 1) else { return }
        stage = next
    }

    /// Applies `hint`'s fixed nudge to its axis, clamped via
    /// ``DesignAxesCatalog/adjusted(_:by:)`` (see ``DesignAdjectiveHint`` for the magnitude).
    public mutating func applyAdjectiveHint(_ hint: DesignAdjectiveHint) {
        axes = DesignAxesCatalog.adjusted(axes, by: [hint.keyPath: hint.delta])
    }
}
