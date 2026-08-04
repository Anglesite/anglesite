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

    @Test func encodedTraversalAttemptsAreRejected() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        // "%2e%2e" decodes to "..": a fully percent-encoded traversal component.
        let (dotDotEncoded, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/%2e%2e/secret", headers: [:]))
        #expect(dotDotEncoded.status == 400)
        // "..%2fsecret" decodes to "../secret": only the separator is encoded.
        let (slashEncoded, _) = try await client.perform(BridgeRequestHead(method: "GET", path: "/..%2fsecret", headers: [:]))
        #expect(slashEncoded.status == 400)
        serverTask.cancel()
    }

    @Test func nonGETMethodIs405AndCompletesCleanly() async throws {
        let pair = InProcessP2PPair.make()
        let server = FetchBridgeServer(connection: pair.b, executor: DirectoryHTTPExecutor(root: try Self.makeSiteRoot()))
        let serverTask = Task { await server.run() }
        let client = FetchBridgeClient(connection: pair.a)
        let (head, body) = try await client.perform(BridgeRequestHead(method: "POST", path: "/", headers: [:]))
        #expect(head.status == 405)
        // Faithfulness: even a rejected request completes the bridged exchange cleanly — the
        // client's body stream must end (responseEnd), not hang.
        var collected = Data()
        for try await chunk in body { collected.append(chunk) }
        #expect(collected.isEmpty)
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

    /// Gates `send(_:on:)` until released, so a test can deterministically land inside the actor-
    /// release window `perform()` opens between its awaited `connection.send` calls and installing
    /// `headContinuation` — the race `stashedHeadResult` fixes (see `FetchBridge.swift`). Once
    /// released, every `send` (past and future) returns immediately.
    private actor SendGate: P2PConnection {
        private var isReleased = false
        private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
        private var hasEntered = false
        private var enterWaiters: [CheckedContinuation<Void, Never>] = []

        func send(_ data: Data, on channel: P2PChannelID) async throws {
            hasEntered = true
            for waiter in enterWaiters { waiter.resume() }
            enterWaiters.removeAll()
            guard !isReleased else { return }
            await withCheckedContinuation { releaseWaiters.append($0) }
        }

        nonisolated func inbound(_ channel: P2PChannelID) -> AsyncStream<Data> {
            // The pump task consumes this, but these tests drive `handle(_:)` directly rather than
            // through the pump, so nothing needs to be yielded here.
            AsyncStream { _ in }
        }

        func close() async {}

        /// Suspends until `send` has been entered at least once (i.e. `perform()` has registered
        /// its `pending[id]` entry and is now blocked on the gate).
        func waitUntilEntered() async {
            guard !hasEntered else { return }
            await withCheckedContinuation { enterWaiters.append($0) }
        }

        /// Releases every current and future blocked `send` call.
        func release() {
            isReleased = true
            for waiter in releaseWaiters { waiter.resume() }
            releaseWaiters.removeAll()
        }
    }

    /// Reproduces the lost-head race directly (self-review concern for Task 5/#1208 fix-wave: a
    /// `.responseHead` frame `handle(_:)`d while `perform()` is still suspended inside its
    /// outbound `send` calls — i.e. before `headContinuation` is installed — must not be silently
    /// dropped. Drives `FetchBridgeClient.handle(_:)` directly (an `internal` seam added for this
    /// purpose) rather than relying on real send/receive timing, since that race is not otherwise
    /// reproducible deterministically.
    @Test func responseHeadArrivingBeforeContinuationInstalledIsNotLost() async throws {
        let gate = SendGate()
        let client = FetchBridgeClient(connection: gate)

        let performTask = Task {
            try await client.perform(BridgeRequestHead(method: "GET", path: "/", headers: [:]))
        }

        await gate.waitUntilEntered() // perform() has registered pending[0] and is now blocked in send()

        let head = BridgeResponseHead(status: 200, headers: ["X-Raced": "yes"])
        let raw = try HTTPBridgeFrame.responseHead(id: 0, head).encoded()
        await client.handle(raw) // races in before headContinuation exists — must be stashed, not dropped

        await gate.release() // let perform()'s remaining sends complete

        let (resolvedHead, body) = try await performTask.value
        #expect(resolvedHead == head)

        // No `responseBody`/`responseEnd` frame was ever sent for this id, so without this the
        // body stream would suspend on `body`'s next element forever — finish it explicitly; this
        // test only cares that the raced head wasn't lost, not about body framing.
        await client.handle(try HTTPBridgeFrame.responseEnd(id: 0).encoded())
        for try await _ in body { Issue.record("expected an empty body stream") }
    }

    /// Same race as above, but terminal: an `.abort` frame that arrives before `headContinuation`
    /// is installed must still fail `perform()`'s caller, not leak the pending entry (removed from
    /// `pending` with nothing left to resume the continuation `perform()` is about to install).
    @Test func abortArrivingBeforeContinuationInstalledFailsRatherThanHangs() async throws {
        let gate = SendGate()
        let client = FetchBridgeClient(connection: gate)

        let performTask = Task {
            try await client.perform(BridgeRequestHead(method: "GET", path: "/", headers: [:]))
        }

        await gate.waitUntilEntered()

        let raw = try HTTPBridgeFrame.abort(id: 0, reason: "raced abort").encoded()
        await client.handle(raw)

        await gate.release()

        await #expect(throws: FetchBridgeError.self) {
            _ = try await performTask.value
        }
    }

    /// A cancelled `perform()` call must not hang, must resume with `CancellationError`, and must
    /// discard (rather than leak) any head/abort result that raced in during cancellation.
    @Test func cancellingPerformDuringSendResumesWithCancellationError() async throws {
        let gate = SendGate()
        let client = FetchBridgeClient(connection: gate)

        let performTask = Task {
            try await client.perform(BridgeRequestHead(method: "GET", path: "/", headers: [:]))
        }

        await gate.waitUntilEntered()
        performTask.cancel()
        await gate.release()

        await #expect(throws: CancellationError.self) {
            _ = try await performTask.value
        }
    }
}
