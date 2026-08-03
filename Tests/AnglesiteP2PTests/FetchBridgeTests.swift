import Testing
import Foundation
@testable import AnglesiteP2P

@Suite struct FetchBridgeTests {
    static func makeSiteRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("p2p-bridge-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("<h1>hello</h1>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data(count: 200_000).write(to: root.appendingPathComponent("big.bin"))  // > one 64 KiB frame
        return root
    }

    @Test func pageCrossesTheBridge() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/", headers: [:]))
        #expect(head.status == 200)
        #expect(head.headers["Content-Type"] == "text/html")
        var collected = Data()
        for try await chunk in body { collected.append(chunk) }
        #expect(String(decoding: collected, as: UTF8.self) == "<h1>hello</h1>")
        serverTask.cancel()
    }

    @Test func largeBodyStreamsInMultipleFrames() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/big.bin", headers: [:]))
        #expect(head.status == 200)
        var total = 0
        var chunks = 0
        for try await chunk in body { total += chunk.count; chunks += 1 }
        #expect(total == 200_000)
        #expect(chunks >= 3)
        serverTask.cancel()
    }

    @Test func missingFileIs404AndTraversalIs400() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (missing, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/nope.html", headers: [:]))
        #expect(missing.status == 404)
        let (traversal, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/../etc/passwd", headers: [:]))
        #expect(traversal.status == 400)
        serverTask.cancel()
    }

    @Test func concurrentRequestsInterleaveCorrectly() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        try await withThrowingTaskGroup(of: Int.self) { group in
            for _ in 0..<8 {
                group.addTask {
                    let (_, body) = try await client.perform(BridgeRequestHead(method: "GET", path: "/big.bin", headers: [:]))
                    var total = 0
                    for try await chunk in body { total += chunk.count }
                    return total
                }
            }
            for try await total in group { #expect(total == 200_000) }
        }
        serverTask.cancel()
    }

    @Test func hopByHopHeadersAreStripped() async throws {
        struct FixedExecutor: HTTPExecutor {
            func execute(_ request: BridgeRequestHead, body: Data?) async throws
                -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>) {
                let head = BridgeResponseHead(status: 301, headers: [
                    "Location": "/new", "Connection": "keep-alive", "Transfer-Encoding": "chunked",
                ])
                return (head, AsyncThrowingStream { $0.finish() })
            }
        }
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: FixedExecutor())
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/old", headers: [:]))
        #expect(head.status == 301)                    // redirect passes through, not followed
        #expect(head.headers["Location"] == "/new")
        #expect(head.headers["Connection"] == nil)
        #expect(head.headers["Transfer-Encoding"] == nil)
        serverTask.cancel()
    }

    /// A pending `perform()` call must fail, not hang forever, if the connection closes while the
    /// request is still in flight (self-review concern for Task 5: no continuation leak).
    @Test func connectionCloseMidRequestFailsRatherThanHang() async throws {
        /// Signals once the host side has started executing the request, so the test can close
        /// the connection deterministically while it is genuinely in flight (no arbitrary sleep).
        actor Signal {
            private var fired = false
            private var continuation: CheckedContinuation<Void, Never>?

            func wait() async {
                if fired { return }
                await withCheckedContinuation { continuation = $0 }
            }

            func fire() {
                guard !fired else { return }
                fired = true
                continuation?.resume()
                continuation = nil
            }
        }

        struct HangingExecutor: HTTPExecutor {
            let started: Signal
            func execute(_ request: BridgeRequestHead, body: Data?) async throws
                -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>) {
                await started.fire()
                try await Task.sleep(for: .seconds(60)) // cancelled when serverTask is torn down
                fatalError("unreachable: cancellation always fires first")
            }
        }

        let pair = InProcessP2PPair.make()
        let started = Signal()
        let server = FetchBridgeServer(connection: pair.b, executor: HangingExecutor(started: started))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)

        let performTask = Task {
            try await client.perform(BridgeRequestHead(method: "GET", path: "/", headers: [:]))
        }
        await started.wait() // the host has the request; it just never answers
        await pair.a.close() // drop the connection mid-request

        await #expect(throws: (any Error).self) {
            _ = try await performTask.value
        }
        serverTask.cancel()
    }
}
