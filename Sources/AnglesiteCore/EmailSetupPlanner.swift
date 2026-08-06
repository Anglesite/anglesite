import Foundation

/// Deterministic business-email provider recommendation and DNS pre-fill — the Bucket 6
/// simplification of the retired `email` Claude skill (#466, spec §5/§8).
///
/// The old skill was already "a flowchart over business type/values, not generative work"
/// (roadmap §5); this type is that flowchart as code. Inputs: does the owner live in the
/// Apple ecosystem, and is this a personal domain or a registered business. Output: a
/// provider recommendation plus the exact DNS records to pre-fill (ported from the skill
/// and its `docs/email-setup.md` reference tables), with provider-issued values (DKIM,
/// domain verification) called out as manual steps instead of guessed.
public enum EmailSetupPlanner {
    // MARK: - Decision-tree inputs

    /// First fork: "Do you use Apple devices (iPhone, Mac) for your business?"
    public enum Ecosystem: Sendable, Equatable {
        /// The owner lives on Apple devices — routes to the Apple-first providers
        /// (iCloud+ / Apple Business) via ``AppleTier``.
        case apple
        /// Mixed or non-Apple devices — routes to the cross-platform recommendation.
        case mixedOrOther
    }

    /// Second fork on the Apple path: "Is this for you personally, or for a registered business?"
    public enum AppleTier: Sendable, Equatable {
        /// A personal domain — iCloud+ custom domain covers it without a business account.
        case personal
        /// A registered business — eligible for Apple Business Essentials (free ≤ 500 seats).
        case registeredBusiness
    }

    // MARK: - Providers

    /// The closed set of email providers the planner knows DNS records for — the providers
    /// from the retired skill's reference doc, no more. Raw values are stable kebab-case
    /// identifiers, safe to persist or put in URLs.
    public enum Provider: String, Sendable, CaseIterable, Equatable, Hashable {
        /// iCloud+ Custom Email Domain — the Apple personal-tier pick.
        case icloudPlus = "icloud-plus"
        /// Apple Business Essentials — the Apple registered-business pick. Same mail
        /// infrastructure as iCloud+, so the two share MX/SPF records.
        case appleBusiness = "apple-business"
        /// Fastmail — the primary cross-platform recommendation.
        case fastmail
        /// Google Workspace — cross-platform alternative.
        case googleWorkspace = "google-workspace"
        /// Proton Mail — cross-platform alternative; the privacy-focused option.
        case protonMail = "proton-mail"
        /// Zoho Mail — cross-platform alternative; the budget option (free tier up to 5 users).
        case zohoMail = "zoho-mail"

        /// Owner-facing product name, spelled the way the provider brands it.
        public var displayName: String {
            switch self {
            case .icloudPlus: return "iCloud+ Custom Email Domain"
            case .appleBusiness: return "Apple Business Essentials"
            case .fastmail: return "Fastmail"
            case .googleWorkspace: return "Google Workspace"
            case .protonMail: return "Proton Mail"
            case .zohoMail: return "Zoho Mail"
            }
        }

        /// Owner-facing cost summary (from the retired skill's reference doc).
        public var costSummary: String {
            switch self {
            case .icloudPlus: return "Included with iCloud+ (from $0.99/month for 50 GB)"
            case .appleBusiness: return "Free for up to 500 employees"
            case .fastmail: return "$5/user/month (Standard) or $3/user/month (Basic)"
            case .googleWorkspace: return "$7/user/month (Business Starter)"
            case .protonMail: return "Free (1 user, 1 GB) or $4/user/month (Mail Plus)"
            case .zohoMail: return "Free (up to 5 users, 5 GB each) or $1/user/month (Mail Lite)"
            }
        }

        /// The provider's own setup flow that the owner completes before/alongside DNS pre-fill.
        public var setupURL: URL {
            switch self {
            case .icloudPlus: return URL(string: "https://www.icloud.com/icloudplus/customdomain")!
            case .appleBusiness: return URL(string: "https://business.apple.com")!
            case .fastmail: return URL(string: "https://www.fastmail.com/help/receive/domains-setup-guide.html")!
            case .googleWorkspace: return URL(string: "https://admin.google.com/ac/domains")!
            case .protonMail: return URL(string: "https://proton.me/support/custom-domain")!
            case .zohoMail: return URL(string: "https://www.zoho.com/mail/help/adminconsole/configure-email-delivery.html")!
            }
        }

        /// The `include:` mechanism this provider contributes to the domain's SPF record.
        public var spfInclude: String {
            switch self {
            case .icloudPlus, .appleBusiness: return "include:icloud.com"
            case .fastmail: return "include:spf.messagingengine.com"
            case .googleWorkspace: return "include:_spf.google.com"
            case .protonMail: return "include:_spf.protonmail.ch"
            case .zohoMail: return "include:zoho.com"
            }
        }
    }

    // MARK: - Recommendation

    /// What ``recommend(ecosystem:appleTier:)`` hands the UI: one primary pick with a
    /// plain-English reason, plus alternatives only where the decision tree genuinely has
    /// peers to offer (the app advises, it doesn't dump a comparison matrix on the owner).
    public struct Recommendation: Sendable, Equatable {
        /// The primary pick the UI should lead with.
        public let provider: Provider
        /// Cross-platform alternatives shown alongside the primary pick (non-Apple path only).
        public let alternatives: [Provider]
        /// One-sentence owner-facing rationale.
        public let reason: String
    }

    /// The decision tree. Apple ecosystem → tier routing (iCloud+ vs Apple Business);
    /// otherwise Fastmail as the simplest cross-platform pick, with the reference doc's
    /// other providers as alternatives. An owner who already has a provider skips this
    /// and goes straight to `dnsPlan(for:domain:dmarcReportEmail:)` for their provider.
    public static func recommend(ecosystem: Ecosystem, appleTier: AppleTier = .personal) -> Recommendation {
        switch ecosystem {
        case .apple:
            switch appleTier {
            case .personal:
                return Recommendation(
                    provider: .icloudPlus,
                    alternatives: [],
                    reason: "iCloud+ includes custom domain email — set it up in your iCloud settings and the DNS records are added here.")
            case .registeredBusiness:
                return Recommendation(
                    provider: .appleBusiness,
                    alternatives: [],
                    reason: "Apple Business gives you email, calendar, and a company directory for free — up to 500 employees.")
            }
        case .mixedOrOther:
            return Recommendation(
                provider: .fastmail,
                alternatives: [.googleWorkspace, .protonMail, .zohoMail],
                reason: "Fastmail is the simplest reliable option that works the same on every device.")
        }
    }

    // MARK: - DNS plan

    /// A DNS record to pre-fill, shaped to match the app's DNS add-record flow
    /// (`DomainOperationsService.addRecord`). Email records are never proxied.
    public struct RecordTemplate: Sendable, Equatable {
        /// DNS record type (`MX`, `TXT`, `CNAME`) — a plain string to match the add-record
        /// flow's wire shape rather than introducing a parallel enum.
        public let type: String
        /// Record name relative to the zone (`@` for the apex, `_dmarc`, `fm1._domainkey`, …).
        public let name: String
        /// The record's value, fully known ahead of time — anything per-account lands in
        /// ``ManualStep`` instead.
        public let content: String
        /// Mail server priority — only meaningful for MX records.
        public let priority: Int?
        /// Always `false` for email records (MX/SPF/DKIM/DMARC must bypass the proxy).
        public var proxied: Bool { false }

        /// Memberwise initializer; `priority` defaults `nil` since only MX records carry one.
        public init(type: String, name: String, content: String, priority: Int? = nil) {
            self.type = type
            self.name = name
            self.content = content
            self.priority = priority
        }
    }

    /// A step the owner must complete in the provider's own interface because the value is
    /// generated per-account (DKIM keys, Apple's domain-verification token).
    public struct ManualStep: Sendable, Equatable {
        /// Short owner-facing label (e.g. "DKIM signature record").
        public let title: String
        /// Click-path instructions telling the owner exactly where in the provider's
        /// dashboard the generated value lives and what record to add here.
        public let instructions: String
    }

    /// Everything the email-setup flow needs to execute for one provider: the records the app
    /// can add on the owner's behalf, and the steps it must hand back to the owner because the
    /// values are provider-issued.
    public struct DNSPlan: Sendable, Equatable {
        /// The provider this plan was generated for.
        public let provider: Provider
        /// Records with fully known values, ready to pre-fill.
        public let records: [RecordTemplate]
        /// Provider-issued values the owner has to copy out of the provider's dashboard.
        public let manualSteps: [ManualStep]
    }

    /// The exact records to pre-fill for a provider, from the retired skill's reference
    /// tables. `dmarcReportEmail` receives aggregate DMARC reports (providers that
    /// prescribe DMARC in the reference doc only).
    public static func dnsPlan(for provider: Provider, domain: String, dmarcReportEmail: String) -> DNSPlan {
        let dmarcNone = RecordTemplate(
            type: "TXT", name: "_dmarc", content: "v=DMARC1; p=none; rua=mailto:\(dmarcReportEmail)")
        switch provider {
        case .icloudPlus, .appleBusiness:
            return DNSPlan(
                provider: provider,
                records: [
                    RecordTemplate(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10),
                    RecordTemplate(type: "MX", name: "@", content: "mx02.mail.icloud.com", priority: 10),
                    RecordTemplate(type: "TXT", name: "@", content: "v=spf1 include:icloud.com ~all"),
                ],
                manualSteps: [
                    ManualStep(
                        title: "DKIM signature record",
                        instructions: provider == .icloudPlus
                            ? "In iCloud.com → Custom Email Domain → your domain, copy the DKIM CNAME hostname and target, then add them as a CNAME record here."
                            : "In business.apple.com → Domains → your domain, copy the DKIM CNAME hostname and target, then add them as a CNAME record here."),
                    ManualStep(
                        title: "Domain verification record",
                        instructions: "Copy the TXT value starting with \"apple-domain-verification=\" from the same DNS settings page and add it as a TXT record on @."),
                ])
        case .fastmail:
            return DNSPlan(
                provider: provider,
                records: [
                    RecordTemplate(type: "MX", name: "@", content: "in1-smtp.messagingengine.com", priority: 10),
                    RecordTemplate(type: "MX", name: "@", content: "in2-smtp.messagingengine.com", priority: 20),
                    RecordTemplate(type: "TXT", name: "@", content: "v=spf1 include:spf.messagingengine.com ~all"),
                    RecordTemplate(type: "CNAME", name: "fm1._domainkey", content: "fm1.\(domain).dkim.fmhosted.com"),
                    RecordTemplate(type: "CNAME", name: "fm2._domainkey", content: "fm2.\(domain).dkim.fmhosted.com"),
                    RecordTemplate(type: "CNAME", name: "fm3._domainkey", content: "fm3.\(domain).dkim.fmhosted.com"),
                    dmarcNone,
                ],
                manualSteps: [])
        case .googleWorkspace:
            return DNSPlan(
                provider: provider,
                records: [
                    RecordTemplate(type: "MX", name: "@", content: "aspmx.l.google.com", priority: 1),
                    RecordTemplate(type: "MX", name: "@", content: "alt1.aspmx.l.google.com", priority: 5),
                    RecordTemplate(type: "MX", name: "@", content: "alt2.aspmx.l.google.com", priority: 5),
                    RecordTemplate(type: "MX", name: "@", content: "alt3.aspmx.l.google.com", priority: 10),
                    RecordTemplate(type: "MX", name: "@", content: "alt4.aspmx.l.google.com", priority: 10),
                    RecordTemplate(type: "TXT", name: "@", content: "v=spf1 include:_spf.google.com ~all"),
                    dmarcNone,
                ],
                manualSteps: [
                    ManualStep(
                        title: "DKIM signature record",
                        instructions: "Google generates a unique TXT record in Admin Console → Apps → Google Workspace → Gmail → Authenticate email. Copy the value from there and add it as a TXT record here."),
                ])
        case .protonMail:
            return DNSPlan(
                provider: provider,
                records: [
                    RecordTemplate(type: "MX", name: "@", content: "mail.protonmail.ch", priority: 10),
                    RecordTemplate(type: "MX", name: "@", content: "mailsec.protonmail.ch", priority: 20),
                    RecordTemplate(type: "TXT", name: "@", content: "v=spf1 include:_spf.protonmail.ch ~all"),
                    RecordTemplate(
                        type: "TXT", name: "_dmarc",
                        content: "v=DMARC1; p=quarantine; rua=mailto:\(dmarcReportEmail)"),
                ],
                manualSteps: [
                    ManualStep(
                        title: "DKIM signature records",
                        instructions: "Proton generates three CNAME records in Settings → Domain → DKIM. Copy the values from there and add them as CNAME records here."),
                ])
        case .zohoMail:
            return DNSPlan(
                provider: provider,
                records: [
                    RecordTemplate(type: "MX", name: "@", content: "mx.zoho.com", priority: 10),
                    RecordTemplate(type: "MX", name: "@", content: "mx2.zoho.com", priority: 20),
                    RecordTemplate(type: "MX", name: "@", content: "mx3.zoho.com", priority: 50),
                    RecordTemplate(type: "TXT", name: "@", content: "v=spf1 include:zoho.com ~all"),
                    dmarcNone,
                ],
                manualSteps: [
                    ManualStep(
                        title: "DKIM signature record",
                        instructions: "Zoho generates a TXT record in Mail Admin → Domains → DKIM. Copy the value from there and add it as a TXT record here."),
                ])
        }
    }

    // MARK: - SPF merge

    /// Merges a provider's `include:` mechanism into an existing SPF record instead of
    /// creating a duplicate — multiple SPF TXT records break email delivery (skill safety
    /// rule). Returns the record to write: a fresh `v=spf1 <include> ~all` when there is
    /// no existing record, the existing record unchanged when the include is already
    /// present, or the existing record with the include inserted after `v=spf1`.
    public static func mergedSPF(existing: String?, adding include: String) -> String {
        guard let existing = existing?.trimmingCharacters(in: .whitespaces), !existing.isEmpty else {
            return "v=spf1 \(include) ~all"
        }
        var mechanisms = existing.split(separator: " ").map(String.init)
        guard mechanisms.first?.lowercased() == "v=spf1" else {
            // Not an SPF record at all — start fresh rather than corrupting it.
            return "v=spf1 \(include) ~all"
        }
        guard !mechanisms.contains(include) else { return existing }
        mechanisms.insert(include, at: 1)
        return mechanisms.joined(separator: " ")
    }

    /// Folds a provider's `include:` mechanism into the domain's *existing* SPF record instead
    /// of adding `plan`'s own SPF TXT record verbatim — the wizard-facing counterpart to
    /// ``mergedSPF(existing:adding:)``, used when the owner already has an SPF record (from a
    /// prior provider, or another service like a marketing tool) that this plan would otherwise
    /// duplicate. Returns `plan` unchanged when it has no SPF record of its own, or when the
    /// merge produces the same content the plan already had (no existing record, or the
    /// existing record already includes this provider's mechanism).
    ///
    /// - Parameters:
    ///   - plan: The plan from ``dnsPlan(for:domain:dmarcReportEmail:)``.
    ///   - existingSPFRecordContent: The domain's current apex SPF TXT record content, or `nil`
    ///     if it has none.
    public static func reconcilingExistingSPF(in plan: DNSPlan, existingSPFRecordContent: String?) -> DNSPlan {
        guard let index = plan.records.firstIndex(where: {
            $0.type == "TXT" && $0.name == "@" && $0.content.lowercased().hasPrefix("v=spf1")
        }) else {
            return plan
        }
        let merged = mergedSPF(existing: existingSPFRecordContent, adding: plan.provider.spfInclude)
        guard merged != plan.records[index].content else { return plan }
        var records = plan.records
        records[index] = RecordTemplate(type: "TXT", name: "@", content: merged)
        return DNSPlan(provider: plan.provider, records: records, manualSteps: plan.manualSteps)
    }

    // MARK: - Owner-facing education

    /// Plain-English record explanations (the skill's `EXPLAIN_STEPS` copy), keyed by the
    /// record's role. Used verbatim so non-technical owners hear consistent language.
    public static func explanation(forRecordType type: String, name: String = "") -> String {
        switch type.uppercased() {
        case "MX":
            return "These tell the internet where to deliver your email."
        case "CNAME":
            return "This adds a digital signature so email providers trust your messages."
        case "TXT" where name == "_dmarc":
            return "This tells email providers what to do with messages that fail security checks."
        case "TXT":
            return "This prevents scammers from sending fake email from your domain."
        default:
            return "This record is part of your email provider's required setup."
        }
    }

    /// Shown before switching providers (skill safety rule): old MX/SPF/DKIM records are
    /// removed first, and delivery is interrupted during the switch.
    public static let providerSwitchWarning =
        "I'll remove the old email records before adding new ones. Your email will be interrupted during the switch."
}
