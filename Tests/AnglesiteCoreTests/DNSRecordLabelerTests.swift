import Testing
@testable import AnglesiteCore

struct DNSRecordLabelerTests {
    private func record(type: String, name: String, content: String = "x") -> DNSRecord {
        DNSRecord(id: "1", type: type, name: name, content: content, ttl: 1, proxied: false)
    }

    @Test("MX records are labeled Email routing")
    func mx() {
        #expect(DNSRecordLabeler.label(for: record(type: "MX", name: "example.com")) == "Email routing")
    }

    @Test("TXT records at _dmarc are labeled Spam prevention (DMARC)")
    func dmarc() {
        let r = record(type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=reject")
        #expect(DNSRecordLabeler.label(for: r) == "Spam prevention (DMARC)")
    }

    @Test("TXT records starting with v=spf1 are labeled Spam prevention (SPF)")
    func spf() {
        let r = record(type: "TXT", name: "example.com", content: "v=spf1 -all")
        #expect(DNSRecordLabeler.label(for: r) == "Spam prevention (SPF)")
    }

    @Test("TXT records at _atproto are labeled Atmosphere verification")
    func bluesky() {
        let r = record(type: "TXT", name: "_atproto.example.com", content: "did=did:plc:abc")
        #expect(DNSRecordLabeler.label(for: r) == "Atmosphere verification")
    }

    @Test("CNAME records to pages.dev or workers.dev are labeled Website")
    func website() {
        #expect(DNSRecordLabeler.label(for: record(type: "CNAME", name: "www.example.com", content: "foo.pages.dev")) == "Website")
        #expect(DNSRecordLabeler.label(for: record(type: "CNAME", name: "www.example.com", content: "foo.workers.dev")) == "Website")
    }

    @Test("A and AAAA records are labeled Website")
    func aRecords() {
        #expect(DNSRecordLabeler.label(for: record(type: "A", name: "example.com", content: "192.0.2.1")) == "Website")
        #expect(DNSRecordLabeler.label(for: record(type: "AAAA", name: "example.com", content: "::1")) == "Website")
    }

    @Test("unrecognized records fall back to Other")
    func fallback() {
        #expect(DNSRecordLabeler.label(for: record(type: "TXT", name: "random.example.com", content: "hello")) == "Other")
        #expect(DNSRecordLabeler.label(for: record(type: "SRV", name: "_sip._tcp.example.com")) == "Other")
    }

    @Test("label matching is case-insensitive on type and name")
    func caseInsensitive() {
        #expect(DNSRecordLabeler.label(for: record(type: "mx", name: "EXAMPLE.COM")) == "Email routing")
        #expect(DNSRecordLabeler.label(for: record(type: "txt", name: "_ATPROTO.example.com", content: "did=x")) == "Atmosphere verification")
    }
}
