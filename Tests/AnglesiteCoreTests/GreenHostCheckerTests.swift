import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for the TGWF Greencheck API client used by the greenHostCheck integration (#684).
/// The HTTP step is injected, so classification is exercised without real network — mirrors
/// GitHubAPITokenVerifierTests.
struct GreenHostCheckerTests {
    private static func transport(status: Int, json: String) -> GreenHostChecker.Transport {
        { request in
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(json.utf8), http)
        }
    }

    @Test("a green host maps to .green")
    func greenHost() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 200, json: #"{"url":"example.com","green":true}"#))
        let result = await checker.check(hostname: "example.com")
        #expect(result == .success(.green))
    }

    @Test("a non-green host maps to .notGreen, not an error")
    func notGreenHost() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 200, json: #"{"url":"example.com","green":false}"#))
        let result = await checker.check(hostname: "example.com")
        #expect(result == .success(.notGreen))
    }

    @Test("a connection failure maps to .network, not .notGreen")
    func networkFailure() async {
        let checker = GreenHostChecker(transport: { _ in throw URLError(.notConnectedToInternet) })
        let result = await checker.check(hostname: "example.com")
        #expect(result == .failure(.network))
    }

    @Test("a transient server error (5xx/429) maps to .unavailable, not .notGreen")
    func transientServerError() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 503, json: #"{}"#))
        let result = await checker.check(hostname: "example.com")
        guard case .failure(.unavailable) = result else {
            Issue.record("expected .unavailable, got \(result)"); return
        }
    }

    @Test("an unparseable body maps to .unavailable")
    func unparseableBody() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 200, json: "not json"))
        let result = await checker.check(hostname: "example.com")
        guard case .failure(.unavailable) = result else {
            Issue.record("expected .unavailable, got \(result)"); return
        }
    }
}
