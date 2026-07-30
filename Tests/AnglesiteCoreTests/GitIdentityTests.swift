#if canImport(Darwin)
import Testing
import Foundation
@testable import AnglesiteCore

/// `GitIdentity.appFallback` must stamp a fresh `Date()` on every access — see #1133. A
/// `static let` would evaluate `Signature.init`'s defaulted `time: Date()` once and cache it for
/// the process lifetime, so every sandboxed fallback-identity commit would carry the same frozen
/// timestamp instead of its actual commit time.
@Suite("GitIdentity") struct GitIdentityTests {
    @Test("appFallback stamps a fresh time on each access")
    func appFallbackTimeAdvances() async throws {
        let first = GitIdentity.appFallback
        try await Task.sleep(for: .milliseconds(20))
        let second = GitIdentity.appFallback

        #expect(first.time != second.time)
    }

    @Test("appFallback keeps a stable name and email across accesses")
    func appFallbackIdentityStable() {
        let first = GitIdentity.appFallback
        let second = GitIdentity.appFallback

        #expect(first.name == second.name)
        #expect(first.email == second.email)
        #expect(first.name == "Anglesite")
        #expect(first.email == "noreply@anglesite.app")
    }
}
#endif
