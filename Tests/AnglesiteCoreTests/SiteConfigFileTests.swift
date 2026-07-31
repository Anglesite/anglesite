// Tests/AnglesiteCoreTests/SiteConfigFileTests.swift
import Testing
@testable import AnglesiteCore

@Suite struct SiteConfigFileTests {
    @Test func appendsNewKey() {
        let out = SiteConfigFile.upsert([("BOOKING_PROVIDER", "cal")], into: "SITE_NAME=Acme\n")
        #expect(out == "SITE_NAME=Acme\nBOOKING_PROVIDER=cal\n")
    }

    @Test func replacesExistingKeyInPlace() {
        let out = SiteConfigFile.upsert([("BOOKING_PROVIDER", "calendly")],
                                        into: "BOOKING_PROVIDER=cal\nSITE_NAME=Acme\n")
        #expect(out == "BOOKING_PROVIDER=calendly\nSITE_NAME=Acme\n")
    }

    @Test func upsertIsIdempotent() {
        let once = SiteConfigFile.upsert([("K", "v")], into: "")
        let twice = SiteConfigFile.upsert([("K", "v")], into: once)
        #expect(once == twice)
    }

    @Test func unionsCSPDomainsWithoutDuplicates() {
        let out = SiteConfigFile.addCSPDomains(["app.cal.com", "app.cal.com"],
                                               into: "SCRIPT_ALLOW=existing.com\n")
        #expect(out == "SCRIPT_ALLOW=existing.com,app.cal.com\n")
    }

    @Test func cspUnionIsIdempotent() {
        let once = SiteConfigFile.addCSPDomains(["app.cal.com"], into: "")
        let twice = SiteConfigFile.addCSPDomains(["app.cal.com"], into: once)
        #expect(once == twice)
        #expect(twice == "SCRIPT_ALLOW=app.cal.com\n")
    }

    @Test func removesCSPDomainsLeavingOthersInPlace() {
        let out = SiteConfigFile.removeCSPDomains(["static.cloudflareinsights.com", "cloudflareinsights.com"],
                                                  from: "SCRIPT_ALLOW=existing.com,static.cloudflareinsights.com,cloudflareinsights.com\n")
        #expect(out == "SCRIPT_ALLOW=existing.com\n")
    }

    @Test func removingAllCSPDomainsLeavesAnEmptyValue() {
        let out = SiteConfigFile.removeCSPDomains(["app.cal.com"], from: "SCRIPT_ALLOW=app.cal.com\nSITE_NAME=Acme\n")
        #expect(out == "SCRIPT_ALLOW=\nSITE_NAME=Acme\n")
    }

    @Test func removeCSPDomainsWithoutTheKeyIsANoOp() {
        let contents = "SITE_NAME=Acme\n"
        #expect(SiteConfigFile.removeCSPDomains(["app.cal.com"], from: contents) == contents)
    }

    /// CRLF input must be normalized to LF: the output key is replaced and no \r appears.
    @Test func upsertNormalizesCRLF() {
        let crlf = "SITE_NAME=Acme\r\nBOOKING_PROVIDER=cal\r\n"
        let out = SiteConfigFile.upsert([("BOOKING_PROVIDER", "calendly")], into: crlf)
        #expect(!out.contains("\r"), "Output must not contain \\r after CRLF normalization")
        #expect(out.contains("BOOKING_PROVIDER=calendly"))
        #expect(out.contains("SITE_NAME=Acme"))
    }

    @Test func readsAnExistingKeysValue() {
        let value = SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: "ANGLESITE_VERSION=1.0.0\nSITE_NAME=Acme\n")
        #expect(value == "1.0.0")
    }

    @Test func returnsNilForAMissingKey() {
        #expect(SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: "SITE_NAME=Acme\n") == nil)
    }

    @Test func ignoresCommentLinesWhenReadingAValue() {
        let contents = "# ANGLESITE_VERSION=commented-out\nANGLESITE_VERSION=1.2.0\n"
        #expect(SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: contents) == "1.2.0")
    }
}
