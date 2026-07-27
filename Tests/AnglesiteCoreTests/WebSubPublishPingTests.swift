import Foundation
import Testing
@testable import AnglesiteCore

/// `WebSubPublishPing` (V-3.3, #361): the post-deploy publish pings that tell the site's own
/// WebSub hub its feeds changed. Transport is a closure (the `GreenHostChecker` pattern), so
/// these run without any network.
@Suite("WebSubPublishPing")
struct WebSubPublishPingTests {

    private final class RequestRecorder: @unchecked Sendable {
        private(set) var requests: [URLRequest] = []
        private let lock = NSLock()
        func record(_ request: URLRequest) {
            lock.lock()
            defer { lock.unlock() }
            requests.append(request)
        }
    }

    private static func transport(
        recording recorder: RequestRecorder, status: Int = 202
    ) -> WebSubPublishPing.Transport {
        { request in
            recorder.record(request)
            let http = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil
            )!
            return (Data(), http)
        }
    }

    @Test("POSTs one form-encoded publish ping per feed topic to the site's hub")
    func pingsEveryFeedTopic() async {
        let recorder = RequestRecorder()
        let ping = WebSubPublishPing(transport: Self.transport(recording: recorder))

        let outcomes = await ping.notify(siteURL: "https://example.com")

        #expect(outcomes.count == 3)
        #expect(outcomes.allSatisfy { $0.accepted })
        #expect(recorder.requests.count == 3)
        for request in recorder.requests {
            #expect(request.url?.absoluteString == "https://example.com/websub")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
        }
        let bodies = recorder.requests.compactMap { $0.httpBody.flatMap { String(data: $0, encoding: .utf8) } }
        #expect(bodies == [
            "hub.mode=publish&hub.url=https%3A%2F%2Fexample.com%2Frss.xml",
            "hub.mode=publish&hub.url=https%3A%2F%2Fexample.com%2Fatom.xml",
            "hub.mode=publish&hub.url=https%3A%2F%2Fexample.com%2Ffeed.json",
        ])
    }

    @Test("a non-2xx hub response is reported as a failed outcome, not thrown")
    func non2xxReportsFailure() async {
        let recorder = RequestRecorder()
        let ping = WebSubPublishPing(transport: Self.transport(recording: recorder, status: 503))

        let outcomes = await ping.notify(siteURL: "https://example.com")

        #expect(outcomes.count == 3)
        #expect(outcomes.allSatisfy { !$0.accepted })
        #expect(outcomes.allSatisfy { $0.detail?.contains("HTTP 503") == true })
    }

    @Test("a transport error is reported as a failed outcome, not thrown")
    func transportErrorReportsFailure() async {
        let ping = WebSubPublishPing(transport: { _ in throw URLError(.notConnectedToInternet) })

        let outcomes = await ping.notify(siteURL: "https://example.com")

        #expect(outcomes.count == 3)
        #expect(outcomes.allSatisfy { !$0.accepted })
    }

    @Test("an unparseable site URL yields no pings")
    func unparseableSiteURLSkips() async {
        let recorder = RequestRecorder()
        let ping = WebSubPublishPing(transport: Self.transport(recording: recorder))

        #expect(await ping.notify(siteURL: "not a url").isEmpty)
        #expect(await ping.notify(siteURL: "ftp://example.com").isEmpty)
        #expect(recorder.requests.isEmpty)
    }

    @Test("origin folds a path or trailing slash away but keeps an explicit port")
    func originDerivation() {
        #expect(WebSubPublishPing.origin(from: "https://example.com") == "https://example.com")
        #expect(WebSubPublishPing.origin(from: "https://example.com/") == "https://example.com")
        #expect(WebSubPublishPing.origin(from: "https://example.com/some/page") == "https://example.com")
        #expect(WebSubPublishPing.origin(from: "http://localhost:4321") == "http://localhost:4321")
        #expect(WebSubPublishPing.origin(from: " https://example.com ") == "https://example.com")
        #expect(WebSubPublishPing.origin(from: "example.com") == nil)
        #expect(WebSubPublishPing.origin(from: "") == nil)
    }

    @Test("topic paths mirror the template's WebSub topic list")
    func topicPathsMatchTemplate() {
        #expect(WebSubPublishPing.topicPaths == ["/rss.xml", "/atom.xml", "/feed.json"])
    }

    @Test("the default transport's session enforces a bounded per-request timeout, not URLSession.shared's ~60s default")
    func defaultTransportHasABoundedTimeout() {
        #expect(WebSubPublishPing.requestTimeoutSeconds > 0)
        #expect(WebSubPublishPing.requestTimeoutSeconds < 60)
        #expect(WebSubPublishPing.defaultSession.configuration.timeoutIntervalForRequest == WebSubPublishPing.requestTimeoutSeconds)
    }
}
