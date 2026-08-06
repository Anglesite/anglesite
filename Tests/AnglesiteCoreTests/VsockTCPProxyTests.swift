import Testing
import Foundation
@testable import AnglesiteCore

/// `.serialized`: this suite drives real sockets and per-connection `DispatchIO`/`DispatchQueue`
/// pumps. Under CI's full parallel test run (1087 tests across 163 suites on a resource-constrained
/// runner — originally observed on macos-15, and reproduced again after `build-test` moved to
/// macos-26 (see AGENTS.md's "Swift lanes" note and PR #1264's CI history) — the contention tracks
/// parallel test load, not a specific runner tier, so don't read this as macos-15-specific when
/// investigating a future recurrence. The global GCD thread pool gets so oversubscribed that some
/// of these tests' read/write handlers went unscheduled for 10+ seconds — the same 3 of 9 tests
/// failed identically, with 0 bytes ever received, on two consecutive CI runs of an unmodified
/// commit, while a local `swift test --filter VsockTCPProxyTests` run passes every test in under
/// 200ms. Serializing this
/// suite's own tests removes its largest source of internal GCD contention so it isn't competing
/// with itself on top of the rest of the parallel test binary.
///
/// `.timeLimit`: the ONLY wall-clock bound in this file, and deliberately so. The wait helpers
/// below (`readExactly`, `readUntilEOF`, `waitUntilConnectionCount`) carry NO per-call deadlines:
/// they wait for the event they assert on (byte count reached, peer EOF, connection count) and
/// exit on cancellation, which is exactly what the time limit triggers if a splice is genuinely
/// stuck. The per-helper deadlines this replaces were really encoding "worst-case CI scheduler
/// latency" — an unknowable — and got bumped every time a busier runner disproved the current
/// guess (a fixed sleep, then a 10s poll that flaked at 10.7s, then 20s; see #556 and PR #558's
/// CI failure). A stuck splice now fails as an unambiguous time-limit violation, not a
/// data-assertion mirage.
///
/// Scope note: a suite-level `TimeLimitTrait` is inherited by each test INDIVIDUALLY, not pooled
/// into one shared budget — so every test here gets its own 1-minute cap, and the worst case for
/// a fully wedged `.serialized` run of this suite is ~1 minute per test (currently 9 tests ≈ 9
/// minutes), still inside build-test's 15-minute job timeout. The healthy suite runs in seconds.
@Suite(.serialized, .timeLimit(.minutes(1)))
struct VsockTCPProxyTests {
    /// Make a connected pair of FileHandles via socketpair(2). One end is handed to the proxy as
    /// the "guest"; the test holds the other to act as the guest peer.
    private func socketPair() -> (FileHandle, FileHandle) {
        var fds: [Int32] = [0, 0]
        let rc = socketpair(AF_UNIX, SOCK_STREAM, 0, &fds)
        #expect(rc == 0)
        return (FileHandle(fileDescriptor: fds[0], closeOnDealloc: true),
                FileHandle(fileDescriptor: fds[1], closeOnDealloc: true))
    }

    /// Connect a TCP client to the proxy's bound URL and return a FileHandle. Named to avoid
    /// shadowing POSIX `connect(2)`.
    private func connectTCPToProxy(to url: URL) throws -> FileHandle {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        #expect(fd >= 0)
        // Per-read backstop so each read tick returns (EAGAIN) and the wait helpers can observe
        // cancellation; not a deadline.
        var tv = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(url.port!)).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        #expect(rc == 0)
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    /// Set SO_RCVTIMEO on an existing file descriptor (e.g. the guest socketpair peer) so each
    /// `read` syscall returns (with EAGAIN) rather than blocking forever — this is what lets the
    /// wait helpers loop and observe cancellation. It is a per-read backstop, NOT a deadline.
    private func setRecvTimeout(_ fh: FileHandle, seconds: Int = 1) {
        var tv = timeval(tv_sec: seconds, tv_usec: 0)
        setsockopt(fh.fileDescriptor, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    }

    /// One `read(2)` tick against `fh`. Raw POSIX (not `FileHandle.read(upToCount:)`) because the
    /// wait loops must distinguish "nothing yet, keep waiting" (EAGAIN from SO_RCVTIMEO) from the
    /// terminal peer-gone conditions (EOF, ECONNRESET) — `FileHandle` collapses all three into
    /// nil/empty, which is why the old helpers could only give up by deadline.
    private enum ReadTick {
        case bytes(Data)    // n > 0
        case eof            // n == 0: peer closed cleanly
        case wouldBlock     // EAGAIN/EINTR: nothing available this tick, keep waiting
        case failed(Int32)  // any other errno: peer gone abnormally (e.g. ECONNRESET)
    }

    private func readTick(_ fh: FileHandle, max: Int) -> ReadTick {
        var buf = [UInt8](repeating: 0, count: max)
        let n = read(fh.fileDescriptor, &buf, max)
        if n > 0 { return .bytes(Data(buf[..<n])) }
        if n == 0 { return .eof }
        // __error().pointee, NOT `errno`: Swift's `errno` accessor is an overlay symbol that lives
        // in libswift_DarwinFoundation1.dylib on current SDKs, which CI's Xcode 26.2 runner image
        // does not ship — referencing it makes the whole test bundle fail to dlopen (same class of
        // breakage as #69's raw-POSIX pump). __error() is the plain C call behind the macro.
        let err = __error().pointee
        switch err {
        case EAGAIN, EWOULDBLOCK, EINTR: return .wouldBlock
        default: return .failed(err)
        }
    }

    /// Read exactly `count` bytes from `fh`, waiting as long as it takes for the event-driven
    /// splice (DispatchSource accept → actor hop → DispatchIO handlers) to deliver them. The
    /// proxy's pipeline can lag tens of seconds under heavy parallel test load on a small CI
    /// runner, so no per-call deadline: correctness is asserted on events (bytes arrived, or the
    /// terminal EOF/reset that returns short and fails the content assertion immediately), and
    /// liveness is bounded once, by the suite `.timeLimit`, whose cancellation exits the loop.
    /// Requires SO_RCVTIMEO on `fh` so each read tick returns and cancellation is observed.
    private func readExactly(_ count: Int, from fh: FileHandle) async -> Data {
        var acc = Data()
        while acc.count < count && !Task.isCancelled {
            switch readTick(fh, max: count - acc.count) {
            case .bytes(let chunk):
                acc.append(chunk)
            case .eof, .failed:
                return acc      // terminal: the caller's #expect reports the shortfall
            case .wouldBlock:
                await Task.yield()
                try? await Task.sleep(for: .milliseconds(5))
            }
        }
        return acc
    }

    /// Accumulate bytes from `fh` until the peer closes (EOF or reset). The event-driven
    /// replacement for "expect no bytes within N seconds": the proxy closing the connection IS the
    /// observable outcome, so this returns the moment it happens instead of burning a fixed wait on
    /// every run. Same liveness story as `readExactly`: suite `.timeLimit` + cancellation.
    private func readUntilEOF(from fh: FileHandle) async -> Data {
        var acc = Data()
        while !Task.isCancelled {
            switch readTick(fh, max: 4096) {
            case .bytes(let chunk):
                acc.append(chunk)
            case .eof, .failed:
                return acc
            case .wouldBlock:
                await Task.yield()
                try? await Task.sleep(for: .milliseconds(5))
            }
        }
        return acc
    }

    /// Poll `proxy.connectionCount` until it equals `n`, then return it. No per-call deadline
    /// (see `readExactly`): cancellation from the suite `.timeLimit` exits the loop, returning the
    /// current count so the caller's assertion reports the actual value.
    private func waitUntilConnectionCount(_ proxy: VsockTCPProxy, _ n: Int) async -> Int {
        while !Task.isCancelled {
            let count = await proxy.connectionCount
            if count == n { return count }
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(5))
        }
        return await proxy.connectionCount
    }

    @Test("client→guest: bytes written to the TCP client appear on the guest handle")
    func clientToGuest() async throws {
        let (guestForProxy, guestPeer) = socketPair()
        setRecvTimeout(guestPeer)
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)
        try client.write(contentsOf: Data("hello".utf8))
        // Read 5 bytes from the guest peer (poll the event-driven splice; see readExactly).
        let got = await readExactly(5, from: guestPeer)
        #expect(got == Data("hello".utf8))
        await proxy.stop()
    }

    @Test("guest→client: bytes written to the guest handle appear at the TCP client")
    func guestToClient() async throws {
        let (guestForProxy, guestPeer) = socketPair()
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)
        setRecvTimeout(client)
        try guestPeer.write(contentsOf: Data("world".utf8))
        let got = await readExactly(5, from: client)
        #expect(got == Data("world".utf8))
        await proxy.stop()
    }

    @Test("start returns a loopback URL with a nonzero OS-assigned port")
    func assignsPort() async throws {
        let (guestForProxy, _) = socketPair()
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        #expect(url.host == "127.0.0.1")
        #expect((url.port ?? 0) > 0)
        await proxy.stop()
    }

    /// Regression test for #69: `waitUntilServing` polls the proxy's URL with a fresh short-lived
    /// TCP connection roughly every 500ms until the guest answers. Each poll dials a fresh guest
    /// pair and is abruptly abandoned client-side (mirroring `URLSession` giving up on a slow/no
    /// response and opening a new connection next tick) — the proxy must keep serving unrelated,
    /// later connections cleanly rather than getting wedged after the churn. This does not
    /// reproduce the exact `FileHandle`-accessor race the raw-POSIX rewrite fixes (that race is
    /// timing-dependent and only surfaced on a real device — see #69/#470), but it does guard the
    /// observable symptom: repeated connect/abandon cycles must not corrupt state for later, real
    /// connections.
    @Test("proxy keeps serving new connections after many abrupt client-side disconnects")
    func survivesRepeatedAbruptDisconnects() async throws {
        for _ in 0..<20 {
            let (guestForProxy, guestPeer) = socketPair()
            let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
            let url = try await proxy.start()
            let client = try connectTCPToProxy(to: url)
            // Abandon immediately — no write, no read — the same shape as a client that opens a
            // socket, gets no prompt response, and gives up before the next poll tick.
            try client.close()
            await proxy.stop()
            try? guestPeer.close()
        }

        // One more, real, iteration: the proxy must still relay correctly after the churn above.
        let (guestForProxy, guestPeer) = socketPair()
        setRecvTimeout(guestPeer)
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)
        try client.write(contentsOf: Data("hello".utf8))
        let got = await readExactly(5, from: guestPeer)
        #expect(got == Data("hello".utf8))
        await proxy.stop()
    }

    /// Regression test for #69: a failing `dial(guestPort)` (e.g. `container.dialVsock` unable to
    /// reach the guest) was previously swallowed by `handleAccepted`'s `catch { try? tcp.close() }`
    /// with zero diagnostic trail — indistinguishable from a slow/hung guest process. The client
    /// just saw its TCP connection close with no data, which is exactly `NSURLErrorNetworkConnection
    /// Lost` on the `URLSession` side. `onDialError` surfaces the real underlying error instead.
    @Test("a failing dial() reports the error via onDialError instead of failing silently")
    func dialFailureReportsError() async throws {
        struct DialError: Error, Equatable { let message: String }
        let collector = LineCollector()
        let proxy = VsockTCPProxy(
            guestPort: 4321,
            dial: { _ in throw DialError(message: "boom") },
            onDialError: { error in collector.append("\(error)", .stderr) })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)
        setRecvTimeout(client)

        // The failed dial closes the client's connection with no bytes ever sent. EOF is the event
        // to wait for — not "no bytes within N seconds", which burned the full N on every green run
        // and still guessed at CI latency. `handleAccepted` invokes `onDialError` synchronously
        // BEFORE closing the TCP side, so observing EOF also guarantees the report has landed.
        let got = await readUntilEOF(from: client)
        #expect(got.isEmpty)

        // The dial failure must have been reported, not swallowed.
        #expect(collector.lines.contains { $0.contains("boom") })
        await proxy.stop()
    }

    /// Make a connected pair of TCP loopback FileHandles (a listen/accept/connect handshake on
    /// 127.0.0.1:0). Unlike an AF_UNIX `socketpair`, a *TCP* peer that closes with SO_LINGER 0
    /// delivers a real RST, so the other end's read fails with ECONNRESET and its write with EPIPE
    /// — the exact conditions that make `FileHandle.availableData`/`.write(contentsOf:)` raise an
    /// ObjC `NSException`. `socketpair` (AF_UNIX) instead returns a clean EOF on peer close and can
    /// never reproduce the production crash.
    private func tcpPair() throws -> (FileHandle, FileHandle) {
        let listenFD = socket(AF_INET, SOCK_STREAM, 0)
        #expect(listenFD >= 0)
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        _ = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(listenFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        #expect(listen(listenFD, 1) == 0)
        var bound = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &bound) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(listenFD, $0, &len) }
        }
        let clientFD = socket(AF_INET, SOCK_STREAM, 0)
        #expect(clientFD >= 0)
        var connAddr = sockaddr_in()
        connAddr.sin_family = sa_family_t(AF_INET)
        connAddr.sin_port = bound.sin_port
        connAddr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let crc = withUnsafePointer(to: &connAddr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(clientFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        #expect(crc == 0)
        let acceptedFD = accept(listenFD, nil, nil)
        #expect(acceptedFD >= 0)
        close(listenFD)
        return (FileHandle(fileDescriptor: acceptedFD, closeOnDealloc: true),
                FileHandle(fileDescriptor: clientFD, closeOnDealloc: true))
    }

    /// Force a TCP RST on `fh` when it closes: SO_LINGER {onoff:1, linger:0} makes close(2) send an
    /// RST instead of a graceful FIN. A subsequent read on the peer then fails with ECONNRESET and a
    /// write with EPIPE — the two socket-level errors that make `FileHandle.availableData` /
    /// `.write(contentsOf:)` raise an *Objective-C* `NSException` (not a Swift error), which no
    /// `try?`/`do-catch` in the pump can intercept.
    private func forceResetOnClose(_ fh: FileHandle) {
        var l = linger(l_onoff: 1, l_linger: 0)
        setsockopt(fh.fileDescriptor, SOL_SOCKET, SO_LINGER, &l, socklen_t(MemoryLayout<linger>.size))
    }

    /// Regression test for #69: when a proxied peer disconnects with a TCP RST (ECONNRESET),
    /// `ProxyConnection.pump`'s read of `availableData` must NOT crash the process. Every
    /// `waitUntilServing` poll and every WKWebView connection close produces exactly this event, so
    /// a peer reset is a NORMAL occurrence and must tear the connection down cleanly, never abort.
    ///
    /// Pre-fix this test does not "fail" — it CRASHES THE TEST RUNNER: `FileHandle.availableData`
    /// raises an uncatchable ObjC `NSFileHandleOperationException` ("Connection reset by peer") on
    /// the dispatch-source thread, and `libc++abi` aborts the whole process. Run it isolated
    /// (`swift test --filter resetOnGuest...`) to capture that crash as RED evidence. Post-fix it
    /// tears the connection down and removes it (connectionCount → 0), like the EOF path.
    @Test("guest peer RST (ECONNRESET) during read tears down cleanly, never aborts")
    func resetOnGuestReadDoesNotCrash() async throws {
        // TCP pair (not socketpair): only a TCP peer closing with SO_LINGER 0 delivers a real RST,
        // producing ECONNRESET on the proxy's read. An AF_UNIX socketpair returns a clean EOF and
        // cannot reproduce the crash.
        let (guestForProxy, guestPeer) = try tcpPair()
        setRecvTimeout(guestPeer)
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)

        // Drive a byte through so accept + dial + both pump directions are live and the proxy is
        // actively reading the guest handle.
        try client.write(contentsOf: Data("ping".utf8))
        _ = await readExactly(4, from: guestPeer)
        #expect(await waitUntilConnectionCount(proxy, 1) == 1)

        // RST the guest peer. The proxy's guest->tcp readabilityHandler wakes and reads
        // `availableData`, which — pre-fix — raises NSFileHandleOperationException and aborts.
        // Post-fix it must be handled like EOF: close the connection, remove it.
        forceResetOnClose(guestPeer)
        try guestPeer.close()

        let countAfterReset = await waitUntilConnectionCount(proxy, 0)
        #expect(countAfterReset == 0)
        await proxy.stop()
    }

    /// Regression test for #69, write side: when the *client* (TCP) peer resets, a pending
    /// guest->client forward hits EPIPE on write. Like the read side, `FileHandle.write(contentsOf:)`
    /// raises an ObjC `NSException` on EPIPE that no Swift `catch` can intercept, so pre-fix this
    /// also aborts the runner. Post-fix the write failure tears the connection down cleanly.
    @Test("client peer RST (EPIPE) during write tears down cleanly, never aborts")
    func resetOnClientWriteDoesNotCrash() async throws {
        let (guestForProxy, guestPeer) = try tcpPair()
        setRecvTimeout(guestPeer)
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)

        // Establish the connection (accept + dial) with a byte in the client->guest direction.
        try client.write(contentsOf: Data("ping".utf8))
        _ = await readExactly(4, from: guestPeer)
        #expect(await waitUntilConnectionCount(proxy, 1) == 1)

        // RST the client so the socket's peer is gone, then push a large payload from the guest.
        // The proxy's guest->tcp handler wakes, reads the payload, and writes it into the
        // now-reset client fd → EPIPE → (pre-fix) NSException → abort. A large payload makes the
        // write actually reach the broken fd rather than being absorbed by kernel buffering.
        forceResetOnClose(client)
        try client.close()
        try guestPeer.write(contentsOf: Data(repeating: 0x41, count: 256 * 1024))

        let countAfterReset = await waitUntilConnectionCount(proxy, 0)
        #expect(countAfterReset == 0)
        await proxy.stop()
    }

    /// Regression test for #69, truncation on clean teardown: on the normal path the guest finishes
    /// its HTTP response (a final chunk queued as a `write` on the tcp channel) and then closes with a
    /// clean FIN. If teardown `close(flags: .stop)`s the tcp channel, that queued write is CANCELLED
    /// and the client receives a truncated body. The barrier-then-`.stop` teardown must instead drain
    /// the queued write before cancelling the (infinite) read, so the client sees the WHOLE payload.
    ///
    /// A large payload (2 MiB) is deliberate: it exceeds the socket/DispatchIO buffer, so the tail of
    /// the write is genuinely still enqueued when the guest FIN arrives and teardown begins — that is
    /// the window a `.stop`-only close truncates. Pre-fix (`close(flags: .stop)` on both channels)
    /// this read comes up short (received.count < payload.count); post-fix it is exact.
    @Test("guest writes a full payload then FINs: client receives the COMPLETE payload, not truncated")
    func fullPayloadDrainsBeforeTeardown() async throws {
        let payloadSize = 2 * 1024 * 1024   // 2 MiB — larger than any socket/DispatchIO buffer
        let payload = Data((0..<payloadSize).map { UInt8($0 & 0xff) })

        let (guestForProxy, guestPeer) = socketPair()
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)
        setRecvTimeout(client)

        // Guest writes the whole response, then immediately closes with a clean FIN. The final bytes
        // are still queued for the guest->tcp forward when the proxy tears the pair down.
        try guestPeer.write(contentsOf: payload)
        try guestPeer.close()

        // The client must receive every byte before its side of the proxy closes. A truncated
        // forward ends in EOF, so readExactly returns short immediately and the count assertion
        // fails with the actual byte count — no deadline to wait out in either direction.
        let got = await readExactly(payloadSize, from: client)
        #expect(got.count == payloadSize)
        #expect(got == payload)
        await proxy.stop()
    }

    @Test("closed connection is removed from connections (no unbounded growth)")
    func closedConnectionRemovedFromConnections() async throws {
        let (guestForProxy, guestPeer) = socketPair()
        setRecvTimeout(guestPeer)
        let proxy = VsockTCPProxy(guestPort: 4321, dial: { _ in guestForProxy })
        let url = try await proxy.start()
        let client = try connectTCPToProxy(to: url)

        // Write a byte so the accept + dial path completes before we check the count.
        try client.write(contentsOf: Data("ping".utf8))
        _ = await readExactly(4, from: guestPeer)

        // The connection should have been accepted and added.
        let countAfterConnect = await waitUntilConnectionCount(proxy, 1)
        #expect(countAfterConnect == 1)

        // Close the guest peer — the proxy's readabilityHandler sees EOF and calls close(),
        // which fires onClose → removeConnection via an async Task.
        try guestPeer.close()

        // Poll with timeout instead of a fixed sleep: waits up to the deadline for the actor to
        // process the onClose Task, then asserts.
        let countAfterClose = await waitUntilConnectionCount(proxy, 0)
        #expect(countAfterClose == 0)

        await proxy.stop()
    }
}
