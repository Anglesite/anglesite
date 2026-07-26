import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A follower picks their own avatar URL, and nothing in `@dwk/activitypub` lets the owner remove
/// or block that follower — so the avatar path needs the same guards as the actor document it was
/// extracted from, not fewer.
///
/// `.timeLimit`: the only wall-clock bound in this file, and deliberately so — `releasesSlotOnFailure`
/// below would hang forever rather than fail cleanly if a concurrency-gate slot ever leaked.
@Suite("AvatarLoader", .timeLimit(.minutes(1)))
struct AvatarLoaderTests {
    private static let avatar = URL(string: "https://files.example.social/avatars/alice.png")!

    /// Mirrors `ActorProfileFetcherTests.transport`: canned bytes, and optionally a *different*
    /// final URL than the one requested, which is how a redirect presents itself to the loader.
    private static func transport(
        bytes: Int, status: Int = 200, finalURL: String? = nil
    ) -> AvatarLoader.Transport {
        { request in
            let url = finalURL.flatMap(URL.init(string:)) ?? request.url!
            let http = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(repeating: 0x41, count: bytes), http)
        }
    }

    @Test("returns the bytes of a normal response")
    func loadsNormalResponse() async throws {
        let loader = AvatarLoader(transport: Self.transport(bytes: 4_096))
        let data = try await loader.data(for: Self.avatar)
        #expect(data.count == 4_096)
    }

    /// A hostile instance serving a 200 MB file — or several visible rows doing it at once —
    /// must not be able to make the pane pay for it.
    @Test("refuses a response over the size cap")
    func refusesOversizeResponse() async throws {
        let oversize = AvatarLoader.maximumResponseBytes + 1
        let loader = AvatarLoader(transport: Self.transport(bytes: oversize))
        await #expect(throws: AvatarLoadError.responseTooLarge(oversize)) {
            _ = try await loader.data(for: Self.avatar)
        }
    }

    @Test("refuses a non-HTTPS avatar URL without issuing a request")
    func refusesInsecureURL() async throws {
        let loader = AvatarLoader(transport: { _ in
            Issue.record("transport must not be called for an insecure avatar URL")
            throw AvatarLoadError.insecureURL
        })
        let insecure = try #require(URL(string: "http://files.example.social/avatars/alice.png"))
        await #expect(throws: AvatarLoadError.insecureURL) {
            _ = try await loader.data(for: insecure)
        }
    }

    /// URLSession follows redirects transparently, so an HTTPS avatar URL that lands on plaintext
    /// would otherwise slip past the scheme check entirely.
    @Test("refuses a response that redirected to a non-HTTPS URL")
    func refusesInsecureRedirect() async throws {
        let loader = AvatarLoader(transport: Self.transport(
            bytes: 16, finalURL: "http://evil.example.com/avatars/alice.png"))
        await #expect(throws: AvatarLoadError.insecureURL) {
            _ = try await loader.data(for: Self.avatar)
        }
    }

    @Test("maps a non-2xx status to requestFailed")
    func mapsNon2xx() async throws {
        let loader = AvatarLoader(transport: Self.transport(bytes: 8, status: 404))
        await #expect(throws: AvatarLoadError.requestFailed(status: 404)) {
            _ = try await loader.data(for: Self.avatar)
        }
    }

    /// Same reasoning as `ActorProfileFetcherTests.configuresAWallClockDeadline`: the idle
    /// timeout alone is not a bound a slow-drip server has to respect.
    @Test("bounds the whole transfer, not just idle time")
    func configuresAWallClockDeadline() throws {
        let configuration = CappedHTTPTransport.configuration(
            requestTimeout: AvatarLoader.timeout,
            resourceTimeout: AvatarLoader.resourceTimeout)

        #expect(configuration.timeoutIntervalForRequest == AvatarLoader.timeout)
        #expect(configuration.timeoutIntervalForResource == AvatarLoader.resourceTimeout)
        #expect(configuration.timeoutIntervalForResource < 60)
    }

    /// Tracks how many transport invocations are executing at once, so a test can assert an upper
    /// bound without racing on a plain `var`.
    private actor ConcurrencyTracker {
        private(set) var current = 0
        private(set) var maxObserved = 0

        func enter() {
            current += 1
            maxObserved = max(maxObserved, current)
        }

        func exit() { current -= 1 }
    }

    /// A `List` can realize dozens of rows at once, each starting its own avatar `.task`
    /// independently — without a cap, that fans out into dozens of concurrent 2 MB transfers. The
    /// transport here holds every call open until they've all had a chance to start, so the test
    /// would see more than `maxConcurrentLoads` overlapping if the gate didn't hold them back.
    @Test("bounds concurrent avatar loads to maxConcurrentLoads")
    func boundsConcurrentLoads() async throws {
        let tracker = ConcurrencyTracker()
        let loader = AvatarLoader(transport: { request in
            await tracker.enter()
            try? await Task.sleep(for: .milliseconds(100))
            await tracker.exit()
            let http = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(repeating: 0x41, count: 16), http)
        })

        await withTaskGroup(of: Void.self) { group in
            for index in 0..<(AvatarLoader.maxConcurrentLoads * 3) {
                let url = URL(string: "https://files.example.social/avatars/\(index).png")!
                group.addTask { _ = try? await loader.data(for: url) }
            }
        }

        let observed = await tracker.maxObserved
        #expect(observed <= AvatarLoader.maxConcurrentLoads)
        // Confirms the gate is actually saturating the pool rather than trivially passing because
        // the fan-out never overlapped in the first place.
        #expect(observed == AvatarLoader.maxConcurrentLoads)
    }

    /// If a failing transport ever left a concurrency-gate slot un-released, every call past
    /// `maxConcurrentLoads` would hang forever waiting for a slot that never comes back — this
    /// test would time out (via the suite's `.timeLimit`) rather than fail cleanly if that
    /// regressed.
    @Test("releases the concurrency slot even when the transport throws")
    func releasesSlotOnFailure() async throws {
        let loader = AvatarLoader(transport: Self.transport(bytes: 8, status: 500))
        for _ in 0..<(AvatarLoader.maxConcurrentLoads + 1) {
            await #expect(throws: AvatarLoadError.requestFailed(status: 500)) {
                _ = try await loader.data(for: Self.avatar)
            }
        }
    }
}
