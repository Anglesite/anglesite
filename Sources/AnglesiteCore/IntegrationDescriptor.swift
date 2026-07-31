/// Stable identity for each integration the wizard can install. `String`-backed so the id can
/// be persisted and serialized; renaming a case is therefore a breaking change to anything that
/// stored one. Every case must have a matching entry in ``IntegrationCatalog/all`` —
/// ``IntegrationCatalog/descriptor(for:)`` traps otherwise.
public enum IntegrationID: String, Sendable, CaseIterable {
    /// Time-booking widget (Cal.com or Calendly).
    case booking
    /// Contact form (Formspree) or plain mailto link.
    case contact
    /// Donation button (Stripe, Liberapay, or GitHub Sponsors).
    case donations
    /// GitHub-Discussions-backed blog comments.
    case giscus
    /// Email-subscribe form, proxied through a Worker that keeps the API key off the client.
    case newsletter
    /// Category-based cookie consent banner gating analytics/embeds/ads.
    case consent
    /// Progressive Web App: manifest, service worker, offline page, install prompt.
    case pwa
    /// A `public/_redirects` entry so an old URL keeps working after a page moves.
    case redirects
    /// Privacy-friendly visitor analytics (Plausible, Fathom, or GA4).
    case tracking
    /// Share-to-social buttons on blog posts.
    case share
    /// Podcast episode-player embed (Spotify or Transistor.fm).
    case podcast
    /// IndieWeb identity: `rel=me` links plus webmention/pingback endpoint discovery.
    case indieweb
    /// Configurable top navigation menu.
    case menu
    /// Single-product checkout link (Stripe or Polar).
    case buyButton
    /// Lemon Squeezy overlay checkout for digital products.
    case lemonSqueezy
    /// Paddle checkout for software licensing / SaaS billing.
    case paddle
    /// Snipcart cart for a small physical-product catalog.
    case snipcart
    /// Shopify Buy Button for a full product catalog with dashboard.
    case shopifyBuyButton
    /// Keystatic-curated inbox for visitor messages.
    case inbox
    /// Keystatic-curated public member directory.
    case membership
    /// Machine-readable sustainability disclosure at `/carbon.txt`.
    case carbonTxt
    /// Green Web Foundation hosting check, with a badge when the host is green.
    case greenHostCheck
    /// Build-time per-page CO2-estimate badge (CO2.js).
    case co2Badge
}

/// A string carrying `{{token}}` placeholders resolved at plan time from the wizard's answers
/// (plus derived tokens like `brandColor`/`siteName`). `ExpressibleByStringLiteral` so
/// descriptor literals stay readable — a plain path with no tokens is a valid `Template` too.
public struct Template: Sendable, Equatable, ExpressibleByStringLiteral {
    /// The unresolved source text, tokens intact.
    public let raw: String
    /// Wraps token-bearing (or plain) text. No validation happens here — an unknown token is
    /// only visible once ``resolve(_:)`` leaves it in the output.
    public init(_ raw: String) { self.raw = raw }
    /// String-literal form of `init(_:)`, so descriptors can write `"src/pages/book.astro"`
    /// where a `Template` is expected.
    public init(stringLiteral raw: String) { self.raw = raw }
    /// Substitutes `tokens` into the template. `{{#key}}…{{/key}}` sections are kept only when
    /// `key` resolves to a non-empty value — letting a staged text asset conditionally include a
    /// complete optional line or TOML entry without a bespoke operation (sections are
    /// deliberately non-nesting) — then plain `{{key}}` placeholders are replaced. A placeholder
    /// with no matching token survives verbatim, so a typo shows up in the output instead of
    /// silently vanishing.
    public func resolve(_ tokens: [String: String]) -> String {
        var out = raw
        // A staged text asset can conditionally include a complete optional line or TOML entry
        // without needing a bespoke operation. Sections are deliberately non-nesting.
        while let opening = out.range(of: "{{#"),
              let keyEnd = out[opening.upperBound...].range(of: "}}") {
            let key = String(out[opening.upperBound..<keyEnd.lowerBound])
            let closingMarker = "{{/\(key)}}"
            guard let closing = out[keyEnd.upperBound...].range(of: closingMarker) else { break }
            let content = String(out[keyEnd.upperBound..<closing.lowerBound])
            out.replaceSubrange(opening.lowerBound..<closing.upperBound,
                                with: tokens[key]?.isEmpty == false ? content : "")
        }
        for (key, value) in tokens {
            out = out.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return out
    }
}

/// One selectable option of a ``FieldKind/choice(_:)`` field.
public struct Choice: Sendable, Equatable {
    /// The machine value stored as the answer (and matched by ``Condition/fieldEquals(key:value:)``).
    public let value: String
    /// The human-readable label the wizard displays for this option.
    public let label: String
    /// Pairs a stored value with its display label.
    public init(value: String, label: String) { self.value = value; self.label = label } }

/// How a ``Field`` renders in the wizard and validates at plan time (`IntegrationPlanner`
/// rejects a non-conforming answer with ``IntegrationError/invalidValue(key:reason:)``).
public enum FieldKind: Sendable, Equatable {
    /// Free text; no validation.
    case text
    /// An email address (checked loosely — must contain `@`).
    case email
    /// An absolute URL. Validation requires a *host*, not just a parseable scheme, so a value
    /// like `https:` can't silently produce no CSP entry for a descriptor using
    /// `addCSPDomains(fromFieldHost:)`.
    case url
    /// A site-relative path (e.g. `/old-page`) or an absolute URL, with no interior whitespace —
    /// for fields whose value ends up on a space-delimited line (e.g. `public/_redirects`), where
    /// an unvalidated `.text` value containing a space would silently corrupt the line format.
    case path
    /// One of a fixed set of ``Choice`` options, rendered as a picker; an answer outside the
    /// options is rejected at plan time.
    case choice([Choice])
    /// A toggle. Stored as the strings `"true"`/`"false"` — ``Answers`` is string-typed
    /// end-to-end so values flow into ``Template`` tokens and `.site-config` unchanged.
    case bool
}

/// A declarative predicate over the wizard's ``Answers``, gating both field visibility
/// (``Field/visibleWhen``) and whether an ``Operation`` runs at all. Evaluated at plan time by
/// `IntegrationPlanner` — keeping conditions as data (no closures) is what lets descriptors stay
/// `Equatable`, diffable in tests, and structurally checkable by
/// ``IntegrationDescriptor/validate()``.
public enum Condition: Sendable, Equatable {
    /// Unconditional: the field is always visible / the operation always runs.
    case always
    /// True when the chosen provider (the reserved `"provider"` answer) matches this id.
    case providerIs(String)
    /// True when the answer for `key` equals `value` exactly.
    case fieldEquals(key: String, value: String)
    /// True when the answer for `key` is any of `values`. An empty list is always false —
    /// ``IntegrationDescriptor/validate()`` flags that as a descriptor bug.
    case fieldIn(key: String, values: [String])
}

/// One wizard input: what to ask, how to render and validate it (``FieldKind``), and when to
/// show it (``visibleWhen``).
public struct Field: Sendable, Equatable, Identifiable {
    /// The answer key — also the `{{key}}` token name the field's value resolves under in
    /// ``Template`` placeholders. Unique within a descriptor.
    public let key: String
    /// The label shown next to the control.
    public let label: String
    /// Rendering and plan-time validation behavior.
    public let kind: FieldKind
    /// Whether the field may be left empty. A *visible* non-optional field with no answer (and
    /// no default) fails planning with ``IntegrationError/missingRequiredField(key:)``; hidden
    /// fields are never required regardless.
    public let isOptional: Bool
    /// Value used when the answer is missing or empty — filled in before visibility and
    /// validation run, so a default can also satisfy a required field.
    public let defaultValue: String?
    /// Optional explanatory text rendered under the control.
    public let help: String?
    /// Visibility condition, letting one descriptor adapt its questions to the chosen provider
    /// or an earlier answer instead of splitting into near-duplicate descriptors.
    public let visibleWhen: Condition
    /// `Identifiable` for SwiftUI lists — the key is the natural unique id.
    public var id: String { key }
    /// Creates a field. The defaults make the common case — a required, always-visible field
    /// with no help text — terse in descriptor literals.
    public init(key: String, label: String, kind: FieldKind, isOptional: Bool = false,
                defaultValue: String? = nil, help: String? = nil, visibleWhen: Condition = .always) {
        self.key = key; self.label = label; self.kind = kind; self.isOptional = isOptional
        self.defaultValue = defaultValue; self.help = help; self.visibleWhen = visibleWhen
    }
}

/// A third-party service choice within one integration (e.g. Cal.com vs. Calendly). Carrying
/// each service's CSP domains here is what lets `addCSPDomains(fromProvider: true)` allow
/// exactly the selected service's hosts — the feature would otherwise be silently blocked by
/// the site's generated Content-Security-Policy.
public struct Provider: Sendable, Equatable, Identifiable {
    /// Stable id stored under the reserved `"provider"` answer and matched by
    /// ``Condition/providerIs(_:)``.
    public let id: String
    /// The name shown in the wizard's provider picker.
    public let displayName: String
    /// Hosts this provider's scripts/embeds load from, folded into the site's CSP when the
    /// provider is chosen. Empty for providers that load nothing external (e.g. a mailto link).
    public let cspDomains: [String]
    /// One-line disclosure shown under the provider's row in the picker — for caveats the
    /// owner should know at the decision point (e.g. GA4's visitor-consent obligations).
    public let note: String?
    /// Creates a provider entry for a descriptor literal.
    public init(id: String, displayName: String, cspDomains: [String], note: String? = nil) {
        self.id = id; self.displayName = displayName; self.cspDomains = cspDomains; self.note = note
    }
}

/// One `.site-config` key written by ``Operation/writeConfig(_:when:)``. The value is a
/// ``Template`` so it can carry a wizard answer (`{{token}}`) — this is the channel that moves
/// answers from the wizard to the Astro build's `readConfig`.
public struct ConfigEntry: Sendable, Equatable {
    /// The `.site-config` key, conventionally `SCREAMING_SNAKE` namespaced by integration.
    public let key: String
    /// The value template, resolved against the answers at plan time.
    public let value: Template
    /// Pairs a config key with its value template.
    public init(key: String, value: Template) { self.key = key; self.value = value }
}

/// A relative path under the website template root (Resources/Template/).
public struct TemplateRef: Sendable, Equatable {
    /// The template-root-relative path of the staged asset.
    public let path: String
    /// Wraps a template-relative path. Existence isn't checked here — a missing asset surfaces
    /// at plan time as ``IntegrationError/missingTemplateAsset(path:)``, before anything is
    /// written to the site.
    public init(_ path: String) { self.path = path } }

/// One declarative setup step in a descriptor. Each operation is gated by its ``Condition`` and
/// lowered by `IntegrationPlanner` into concrete `PlannedStep`s — descriptors never touch the
/// filesystem themselves, so every failure surfaces at plan time, before anything is written.
public enum Operation: Sendable, Equatable {
    /// Copies a staged template asset byte-for-byte to `to` inside the site. Idempotent by
    /// content: re-applying writes the same bytes, so reruns can't accumulate duplicates
    /// (contrast ``appendLine(file:line:when:)``).
    case copyFile(from: TemplateRef, to: Template, when: Condition)
    /// Copies a staged text asset after resolving its `Template` tokens. This opt-in operation
    /// keeps ordinary staged assets byte-for-byte intact.
    case copyTemplatedFile(from: TemplateRef, to: Template, when: Condition)
    /// Upserts the given entries into the site's `.site-config`, with each value's ``Template``
    /// resolved against the answers first.
    case writeConfig([ConfigEntry], when: Condition)
    /// `fromFieldHost` names a `.url`-kind field whose value's host (e.g. a per-site
    /// Cloudflare Worker subdomain) is extracted at plan time and added alongside
    /// `extra`/provider domains — for endpoints that aren't a fixed per-provider domain.
    case addCSPDomains(fromProvider: Bool, extra: [String], fromFieldHost: String?, when: Condition)
    /// Inserts `snippet` at a named anchor comment in `file`, wrapped in
    /// ``MarkerInjector``-style delimiters so re-applying replaces the existing block in place
    /// instead of stacking duplicates. `style` picks the delimiter syntax for the injection
    /// site (HTML comment vs. `//` line).
    case injectAtAnchor(file: Template, anchor: String, snippet: Template, when: Condition, style: MarkerInjector.CommentStyle)
    /// Appends `line` to `file`, creating the file if it doesn't exist. Unlike `copyFile`, this
    /// is not idempotent-by-content-match — each call appends again. Use for accumulating files
    /// (`public/_redirects`, `public/_headers`) rather than one-shot feature toggles.
    case appendLine(file: Template, line: Template, when: Condition)
}

/// The complete declarative definition of one installable integration: identity, wizard copy,
/// provider choices, input fields, and the operations that install it. Deliberately pure data
/// (`Equatable`, no closures) so ``validate()`` can structurally check a descriptor and tests
/// can compare whole plans — all behavior lives in the planner/scaffolder, not here.
public struct IntegrationDescriptor: Sendable, Equatable, Identifiable {
    /// The catalog identity; also the `Identifiable` id.
    public let id: IntegrationID
    /// The name shown in menus and as the wizard title.
    public let displayName: String
    /// One-sentence pitch shown in the integration picker.
    public let summary: String
    /// Selectable service backends. Empty when the integration has a single fixed
    /// implementation — planning then skips the provider-choice requirement entirely.
    public let providers: [Provider]
    /// The wizard's inputs, in presentation order. May be empty (e.g. greenHostCheck, whose
    /// answers are computed by the app, not asked of the owner).
    public let fields: [Field]
    /// The setup steps, applied in order once planned.
    public let operations: [Operation]
    /// Memberwise initializer used by ``IntegrationCatalog``'s descriptor literals.
    public init(id: IntegrationID, displayName: String, summary: String,
                providers: [Provider], fields: [Field], operations: [Operation]) {
        self.id = id; self.displayName = displayName; self.summary = summary
        self.providers = providers; self.fields = fields; self.operations = operations
    }
}
