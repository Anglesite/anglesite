import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct EmailSetupPlannerTests {
    // MARK: - Decision tree

    @Test func applePersonalRoutesToICloudPlus() {
        let rec = EmailSetupPlanner.recommend(ecosystem: .apple, appleTier: .personal)
        #expect(rec.provider == .icloudPlus)
        #expect(rec.alternatives.isEmpty)
    }

    @Test func appleBusinessRoutesToAppleBusiness() {
        let rec = EmailSetupPlanner.recommend(ecosystem: .apple, appleTier: .registeredBusiness)
        #expect(rec.provider == .appleBusiness)
    }

    @Test func mixedEcosystemRecommendsFastmailWithAlternatives() {
        let rec = EmailSetupPlanner.recommend(ecosystem: .mixedOrOther)
        #expect(rec.provider == .fastmail)
        #expect(rec.alternatives == [.googleWorkspace, .protonMail, .zohoMail])
    }

    // MARK: - DNS plans

    @Test func appleTiersShareMXAndSPF() {
        let personal = EmailSetupPlanner.dnsPlan(for: .icloudPlus, domain: "example.com", dmarcReportEmail: "me@example.com")
        let business = EmailSetupPlanner.dnsPlan(for: .appleBusiness, domain: "example.com", dmarcReportEmail: "me@example.com")
        // "These are the same for both iCloud+ and Apple Business" (retired skill).
        #expect(personal.records == business.records)
        #expect(personal.records.filter { $0.type == "MX" }.map(\.content)
            == ["mx01.mail.icloud.com", "mx02.mail.icloud.com"])
        #expect(personal.records.contains(
            EmailSetupPlanner.RecordTemplate(type: "TXT", name: "@", content: "v=spf1 include:icloud.com ~all")))
    }

    @Test func appleRequiresDKIMAndVerificationAsManualSteps() {
        let plan = EmailSetupPlanner.dnsPlan(for: .icloudPlus, domain: "example.com", dmarcReportEmail: "me@example.com")
        #expect(plan.manualSteps.count == 2)
        #expect(plan.manualSteps.contains { $0.instructions.contains("apple-domain-verification=") })
    }

    @Test func fastmailPlanIsFullyPrefillable() {
        let plan = EmailSetupPlanner.dnsPlan(for: .fastmail, domain: "example.com", dmarcReportEmail: "owner@example.com")
        // Fastmail's DKIM CNAMEs are derivable from the domain — no manual steps at all.
        #expect(plan.manualSteps.isEmpty)
        let dkim = plan.records.filter { $0.type == "CNAME" }
        #expect(dkim.map(\.name) == ["fm1._domainkey", "fm2._domainkey", "fm3._domainkey"])
        #expect(dkim.first?.content == "fm1.example.com.dkim.fmhosted.com")
        #expect(plan.records.contains(EmailSetupPlanner.RecordTemplate(
            type: "TXT", name: "_dmarc", content: "v=DMARC1; p=none; rua=mailto:owner@example.com")))
    }

    @Test func googlePlanHasFiveMXRecordsWithDocPriorities() {
        let plan = EmailSetupPlanner.dnsPlan(for: .googleWorkspace, domain: "example.com", dmarcReportEmail: "o@example.com")
        let mx = plan.records.filter { $0.type == "MX" }
        #expect(mx.count == 5)
        #expect(mx.map { $0.priority } == [1, 5, 5, 10, 10])
        #expect(plan.manualSteps.count == 1) // DKIM is account-generated.
    }

    @Test func protonUsesQuarantineDMARC() {
        let plan = EmailSetupPlanner.dnsPlan(for: .protonMail, domain: "example.com", dmarcReportEmail: "o@example.com")
        let dmarc = plan.records.first { $0.name == "_dmarc" }
        #expect(dmarc?.content == "v=DMARC1; p=quarantine; rua=mailto:o@example.com")
    }

    @Test func zohoPlanMatchesReferenceTable() {
        let plan = EmailSetupPlanner.dnsPlan(for: .zohoMail, domain: "example.com", dmarcReportEmail: "o@example.com")
        let mx = plan.records.filter { $0.type == "MX" }
        #expect(mx.map(\.content) == ["mx.zoho.com", "mx2.zoho.com", "mx3.zoho.com"])
        #expect(mx.map { $0.priority } == [10, 20, 50])
    }

    @Test func emailRecordsAreNeverProxied() {
        for provider in EmailSetupPlanner.Provider.allCases {
            let plan = EmailSetupPlanner.dnsPlan(for: provider, domain: "example.com", dmarcReportEmail: "o@example.com")
            #expect(plan.records.allSatisfy { !$0.proxied }, "email records must bypass the proxy (\(provider))")
        }
    }

    // MARK: - SPF merge

    @Test func spfMergeCreatesFreshRecordWhenNoneExists() {
        #expect(EmailSetupPlanner.mergedSPF(existing: nil, adding: "include:icloud.com")
            == "v=spf1 include:icloud.com ~all")
        #expect(EmailSetupPlanner.mergedSPF(existing: "  ", adding: "include:icloud.com")
            == "v=spf1 include:icloud.com ~all")
    }

    @Test func spfMergeInsertsIntoExistingRecord() {
        // The skill's own example: merging iCloud into an existing Cloudflare SPF.
        let merged = EmailSetupPlanner.mergedSPF(
            existing: "v=spf1 include:_spf.mx.cloudflare.net ~all",
            adding: "include:icloud.com")
        #expect(merged == "v=spf1 include:icloud.com include:_spf.mx.cloudflare.net ~all")
    }

    @Test func spfMergeIsIdempotent() {
        let existing = "v=spf1 include:icloud.com ~all"
        #expect(EmailSetupPlanner.mergedSPF(existing: existing, adding: "include:icloud.com") == existing)
    }

    @Test func spfMergeIgnoresNonSPFContent() {
        // A non-SPF TXT value must not be corrupted into a hybrid record.
        let merged = EmailSetupPlanner.mergedSPF(existing: "some-verification=abc", adding: "include:zoho.com")
        #expect(merged == "v=spf1 include:zoho.com ~all")
    }

    // MARK: - Existing-SPF reconciliation (wizard-facing)

    @Test func reconcilingExistingSPFLeavesPlanAloneWhenNoExistingRecord() {
        let plan = EmailSetupPlanner.dnsPlan(for: .fastmail, domain: "example.com", dmarcReportEmail: "o@example.com")
        let reconciled = EmailSetupPlanner.reconcilingExistingSPF(in: plan, existingSPFRecordContent: nil)
        #expect(reconciled == plan)
    }

    @Test func reconcilingExistingSPFMergesIntoAnotherProvidersRecord() {
        let plan = EmailSetupPlanner.dnsPlan(for: .icloudPlus, domain: "example.com", dmarcReportEmail: "o@example.com")
        let reconciled = EmailSetupPlanner.reconcilingExistingSPF(
            in: plan, existingSPFRecordContent: "v=spf1 include:_spf.mx.cloudflare.net ~all")
        let spf = reconciled.records.first { $0.type == "TXT" && $0.name == "@" }
        #expect(spf?.content == "v=spf1 include:icloud.com include:_spf.mx.cloudflare.net ~all")
        // Every other record (MX, manual steps) is untouched.
        #expect(reconciled.records.filter { $0.type == "MX" } == plan.records.filter { $0.type == "MX" })
        #expect(reconciled.manualSteps == plan.manualSteps)
    }

    @Test func reconcilingExistingSPFIsIdempotentWhenIncludeAlreadyPresent() {
        let plan = EmailSetupPlanner.dnsPlan(for: .zohoMail, domain: "example.com", dmarcReportEmail: "o@example.com")
        let reconciled = EmailSetupPlanner.reconcilingExistingSPF(
            in: plan, existingSPFRecordContent: "v=spf1 include:zoho.com ~all")
        #expect(reconciled == plan)
    }

    // MARK: - Owner-facing copy

    @Test func explanationsUseSkillLanguage() {
        #expect(EmailSetupPlanner.explanation(forRecordType: "MX")
            == "These tell the internet where to deliver your email.")
        #expect(EmailSetupPlanner.explanation(forRecordType: "TXT")
            == "This prevents scammers from sending fake email from your domain.")
        #expect(EmailSetupPlanner.explanation(forRecordType: "TXT", name: "_dmarc")
            == "This tells email providers what to do with messages that fail security checks.")
        #expect(EmailSetupPlanner.explanation(forRecordType: "CNAME")
            == "This adds a digital signature so email providers trust your messages.")
    }

    @Test func providerMetadataIsComplete() {
        for provider in EmailSetupPlanner.Provider.allCases {
            #expect(!provider.displayName.isEmpty)
            #expect(!provider.costSummary.isEmpty)
            #expect(!provider.spfInclude.isEmpty)
        }
    }
}
