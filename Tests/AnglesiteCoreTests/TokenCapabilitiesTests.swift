// Tests/AnglesiteCoreTests/TokenCapabilitiesTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct TokenCapabilitiesTests {
    @Test("capabilities round-trip through Codable (persistable alongside the token)")
    func codableRoundTrip() throws {
        let caps: TokenCapabilities = [.workers, .turnstile, .emailRouting]
        let data = try JSONEncoder().encode(caps.sorted { $0.rawValue < $1.rawValue })
        let decoded = TokenCapabilities(try JSONDecoder().decode([TokenCapability].self, from: data))
        #expect(decoded == caps)
    }

    @Test("every capability has a stable raw value")
    func stableRawValues() {
        #expect(TokenCapability.allCases.count == 10)
        #expect(TokenCapability.zoneSettings.rawValue == "zoneSettings")
        #expect(TokenCapability(rawValue: "registrar") == .registrar)
        #expect(TokenCapability.kv.rawValue == "kv")
    }
}
