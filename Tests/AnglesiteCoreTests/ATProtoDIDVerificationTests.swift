import Foundation
import Testing
@testable import AnglesiteCore

/// `ATProtoDIDVerification` (#1235): on-demand check that `/.well-known/atproto-did` serves the
/// account's DID. Transport is a closure (the `WebSubPublishPing` pattern), so these run without
/// any network.
@Suite("ATProtoDIDVerification")
struct ATProtoDIDVerificationTests {

    private static let did = "did:plc:z72i7hdynmk6r22z27h6tvur"

    /// Mirrors `WebSubPublishPingTests.RequestRecorder`: a `@Sendable` transport closure can't
    /// mutate a captured `var` directly under strict concurrency, so recording the request needs
    /// its own lock-protected box.
    private final class RequestRecorder: @unchecked Sendable {
        private(set) var requests: [URLRequest] = []
        private let lock = NSLock()
        func record(_ request: URLRequest) {
            lock.lock()
            defer { lock.unlock() }
            requests.append(request)
        }
    }

    private static func transport(status: Int = 200, body: String?) -> POSSEHTTPTransport {
        { request in
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data((body ?? "").utf8), http)
        }
    }

    @Test("matching content at the exact well-known URL verifies")
    func matchingContentVerifies() async {
        let outcome = await ATProtoDIDVerification.verify(
            domain: "example.com", expectedDID: Self.did,
            transport: Self.transport(body: Self.did)
        )
        #expect(outcome == .verified)
    }

    @Test("surrounding whitespace on the served body doesn't break verification")
    func trimsWhitespace() async {
        let outcome = await ATProtoDIDVerification.verify(
            domain: "example.com", expectedDID: Self.did,
            transport: Self.transport(body: "\(Self.did)\n")
        )
        #expect(outcome == .verified)
    }

    @Test("fetches the exact HTTPS well-known path for the given domain")
    func fetchesExactURL() async {
        let recorder = RequestRecorder()
        let transport: POSSEHTTPTransport = { request in
            recorder.record(request)
            let http = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(Self.did.utf8), http)
        }
        _ = await ATProtoDIDVerification.verify(domain: "example.com", expectedDID: Self.did, transport: transport)
        #expect(recorder.requests.map { $0.url?.absoluteString } == ["https://example.com/.well-known/atproto-did"])
    }

    @Test("a different DID is reported as a mismatch, not verified")
    func mismatchIsReported() async {
        let outcome = await ATProtoDIDVerification.verify(
            domain: "example.com", expectedDID: Self.did,
            transport: Self.transport(body: "did:plc:someoneelse")
        )
        #expect(outcome == .mismatch(actual: "did:plc:someoneelse"))
    }

    @Test("a non-2xx status is unreachable, not a mismatch")
    func non2xxIsUnreachable() async {
        let outcome = await ATProtoDIDVerification.verify(
            domain: "example.com", expectedDID: Self.did,
            transport: Self.transport(status: 404, body: nil)
        )
        guard case .unreachable(let detail) = outcome else {
            Issue.record("expected .unreachable, got \(outcome)")
            return
        }
        #expect(detail.contains("404"))
    }

    @Test("a transport error is reported as unreachable, not thrown")
    func transportErrorIsUnreachable() async {
        let outcome = await ATProtoDIDVerification.verify(
            domain: "example.com", expectedDID: Self.did,
            transport: { _ in throw URLError(.notConnectedToInternet) }
        )
        guard case .unreachable = outcome else {
            Issue.record("expected .unreachable, got \(outcome)")
            return
        }
    }

    @Test("the default transport's session enforces a bounded per-request timeout, not URLSession.shared's ~60s default")
    func defaultTransportHasABoundedTimeout() {
        #expect(ATProtoDIDVerification.requestTimeoutSeconds > 0)
        #expect(ATProtoDIDVerification.requestTimeoutSeconds < 60)
        #expect(
            ATProtoDIDVerification.defaultSession.configuration.timeoutIntervalForRequest
                == ATProtoDIDVerification.requestTimeoutSeconds)
    }
}
