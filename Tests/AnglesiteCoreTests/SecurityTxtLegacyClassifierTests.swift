import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct SecurityTxtLegacyClassifierTests {
    @Test func exactLegacyShapeMatches() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: "https://example.org"
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func siteURLFallsBackToExampleDotComWhenUnset() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: nil
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func differentContactDoesNotMatch() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "someone-else@example.com", siteURL: "https://example.org"
        )
        #expect(result == .doesNotMatch)
    }

    @Test func handAuthoredContentWithExtraLinesDoesNotMatch() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\nPreferred-Languages: en\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: "https://example.org"
        )
        #expect(result == .doesNotMatch)
    }

    @Test func noCurrentContactNeverMatches() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: nil, siteURL: "https://example.org"
        )
        #expect(result == .doesNotMatch)
    }

    @Test func bareEmailContactIsNormalizedToMailto() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: nil
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func httpsContactURIIsUsedAsIs() {
        let content = "Contact: https://example.org/security-report\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "https://example.org/security-report", siteURL: nil
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func unparseableExpiresDoesNotMatch() {
        let content = "Contact: mailto:security@example.com\nExpires: not-a-date\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: nil
        )
        #expect(result == .doesNotMatch)
    }
}
