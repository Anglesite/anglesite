import Testing
import Foundation
@testable import AnglesiteCore

struct CloudflareCapabilityProberTests {
    private let accountsOK = (200, #"{"success":true,"result":[{"id":"acc1","name":"Acme"}]}"#)

    @Test("2xx and non-auth errors mark a capability present; 403 marks it absent")
    func classifiesStatuses() async {
        let prober = CloudflareCapabilityProber(transport: fakeTransport([
            "/accounts?": accountsOK,
            "accounts/acc1/workers/scripts": (200, #"{"success":true,"result":[]}"#),
            "accounts/acc1/challenges/widgets": (403, #"{"success":false}"#),
            "accounts/acc1/registrar/domains": (200, #"{"success":true,"result":[]}"#),
            "accounts/acc1/storage/kv/namespaces": (403, #"{"success":false}"#),
            "zones/z1/settings/ssl": (200, #"{"success":true,"result":{"value":"strict"}}"#),
            "zones/z1/dns_records": (403, #"{"success":false}"#),
            "zones/z1/rulesets": (200, #"{"success":true,"result":[]}"#),
            "zones/z1/email/routing": (404, #"{"success":false}"#),
            "zones/z1/settings/zaraz/config": (403, #"{"success":false}"#),
            "zones/z1/page_shield": (200, #"{"success":true,"result":{"enabled":false}}"#),
        ]))
        let caps = await prober.probe(token: "t", zoneID: "z1")
        #expect(caps.contains(.workers))
        #expect(!caps.contains(.turnstile))
        #expect(caps.contains(.registrar))
        #expect(!caps.contains(.kv))
        #expect(caps.contains(.zoneSettings))
        #expect(!caps.contains(.dns))
        #expect(caps.contains(.rulesets))
        #expect(caps.contains(.emailRouting))  // 404 = enabled-state miss, permission present
        #expect(!caps.contains(.zaraz))
        #expect(caps.contains(.pageShield))
    }

    @Test("nil zoneID skips zone probes; unresolvable account skips account probes")
    func skipsUnscopedProbes() async {
        let prober = CloudflareCapabilityProber(transport: fakeTransport([
            "/accounts?": (403, #"{"success":false}"#),
        ]))
        let caps = await prober.probe(token: "t", zoneID: nil)
        #expect(caps.isEmpty)
    }

    @Test("probe requests carry the bearer token")
    func sendsBearer() async {
        let spy = TransportSpy()
        let inner = fakeTransport(["/accounts?": accountsOK])
        let prober = CloudflareCapabilityProber(transport: { request in
            spy.record(request)
            return try await inner(request)
        })
        _ = await prober.probe(token: "sekret", zoneID: nil)
        #expect(spy.requests.allSatisfy {
            $0.value(forHTTPHeaderField: "Authorization") == "Bearer sekret"
        })
    }
}
