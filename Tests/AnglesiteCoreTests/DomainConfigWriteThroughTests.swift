import Testing
@testable import AnglesiteCore

@Suite struct DomainConfigWriteThroughTests {
    @Test func addingManagedDNSRecordAppendsToEmptyConfig() {
        var config = DomainConfig()
        config = config.addingManagedDNSRecord(
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"))
        #expect(config.dns?.managedRecords == [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ])
    }

    @Test func addingManagedDNSRecordAppendsToExisting() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10, purpose: "email:icloud"),
        ]))
        config = config.addingManagedDNSRecord(
            .init(type: "MX", name: "@", content: "mx02.mail.icloud.com", priority: 10, purpose: "email:icloud"))
        #expect(config.dns?.managedRecords?.count == 2)
    }

    @Test func addingManagedDNSRecordDedupesExactRepeat() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ]))
        config = config.addingManagedDNSRecord(
            .init(type: "txt", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"))
        #expect(config.dns?.managedRecords?.count == 1)
    }

    @Test func removingManagedDNSRecordDropsMatchByTypeNameContent() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
            .init(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10),
        ]))
        config = config.removingManagedDNSRecord(type: "txt", name: "_atproto", content: "did=abc")
        #expect(config.dns?.managedRecords?.count == 1)
        #expect(config.dns?.managedRecords?.first?.type == "MX")
    }

    @Test func removingManagedDNSRecordNoMatchIsNoOp() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc"),
        ]))
        config = config.removingManagedDNSRecord(type: "TXT", name: "other", content: "did=xyz")
        #expect(config.dns?.managedRecords?.count == 1)
    }

    @Test func removingManagedDNSRecordFromNilDNSIsNoOp() {
        var config = DomainConfig()
        config = config.removingManagedDNSRecord(type: "TXT", name: "x", content: "y")
        #expect(config.dns == nil)
    }

    @Test func accumulatingWAFRulesAppendsNewOntoExisting() {
        let existing = [DomainConfig.Edge.WAFRule(description: "Block dotfiles", expression: "(x)", action: "block")]
        let new = [DomainConfig.Edge.WAFRule(description: "Block xmlrpc", expression: "(y)", action: "block")]
        let merged = DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules(new, onto: existing)
        #expect(merged.count == 2)
    }

    @Test func accumulatingWAFRulesDedupesExactRepeat() {
        let rule = DomainConfig.Edge.WAFRule(description: "Block dotfiles", expression: "(x)", action: "block")
        let merged = DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules([rule], onto: [rule])
        #expect(merged.count == 1)
    }
}
