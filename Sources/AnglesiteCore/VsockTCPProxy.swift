// vsock proxies are the macOS Apple Containerization runtime's seam; off-Darwin runtimes
// (PodmanSiteRuntime, per the cross-platform port design doc §7) use plain port-mapping
// instead, so this file — and its Glibc-vs-Darwin socket-constant differences — compiles out
// elsewhere. Its only consumer, AnglesiteContainer, is already Darwin-only (Package.swift).
#if canImport(Darwin)
import Foundation

/// Dials a guest vsock port and returns a `FileHandle` for the bidirectional byte stream.
/// Production passes `{ port in try container.dialVsock(port: port) }`; tests pass a loopback
/// (socketpair) dialer. This closure is the ONLY framework-bound part of the proxy.
public typealias VsockDialer = @Sendable (_ guestPort: UInt32) async throws -> FileHandle

/// Host-side proxy: listens on `127.0.0.1:0` and, for each accepted TCP connection, dials the
/// guest vsock port and splices the two `FileHandle`s bidirectionally until either side closes.
/// This is the seam that lets `WKWebView` load `http://127.0.0.1:<port>` and `MCPClient` connect
/// over plain HTTP while the actual server runs inside the VM, reachable only over vsock.
public actor VsockTCPProxy {
    private let guestPort: UInt32
    private let dial: VsockDialer
    /// Reports a failed `dial(guestPort)` (e.g. `container.dialVsock` unable to reach the guest).
    /// Without this, `handleAccepted`'s catch silently closed the TCP side with zero diagnostic
    /// trail — indistinguishable, from the client's perspective, from a slow/hung guest process:
    /// both surface as `NSURLErrorNetworkConnectionLost` on the polling `URLSession` (see #69).
    private let onDialError: @Sendable (Error) -> Void
    /// Diagnostic-only lifecycle events (see #69): "accepted" when a host TCP connection lands,
    /// "dial-ok" when `dial(guestPort)` returns without throwing. Together with `onDialError` these
    /// pin down exactly which stage — accept, dial, or the byte-level splice — a silently-broken
    /// connection actually failed at, instead of every failure looking identical from the outside
    /// (`NSURLErrorNetworkConnectionLost` on the polling `URLSession`).
    private let onEvent: @Sendable (String) -> Void
    private var listenFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var connections: [ProxyConnection] = []

    /// Creates a proxy for one guest port. The diagnostic closures default to no-ops so callers
    /// that don't care about the failure-stage breakdown (tests, simple tools) stay one-liners,
    /// while the runtime wires them into the debug pane.
    public init(
        guestPort: UInt32,
        dial: @escaping VsockDialer,
        onDialError: @escaping @Sendable (Error) -> Void = { _ in },
        onEvent: @escaping @Sendable (String) -> Void = { _ in }
    ) {
        self.guestPort = guestPort
        self.dial = dial
        self.onDialError = onDialError
        self.onEvent = onEvent
    }

    /// Bind + listen on 127.0.0.1:0, install the accept handler, and return the loopback URL with
    /// the OS-assigned port. Throws `LocalContainerError.bootFailed` on any socket error.
    public func start() throws -> URL {
        guard listenFD < 0 else { throw LocalContainerError.bootFailed("already started") }
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw LocalContainerError.bootFailed("socket() failed") }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0                                   // OS-assigned
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bindRC = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindRC == 0 else { close(fd); throw LocalContainerError.bootFailed("bind() failed") }
        guard listen(fd, 16) == 0 else { close(fd); throw LocalContainerError.bootFailed("listen() failed") }

        var bound = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &bound) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
        }
        let port = UInt16(bigEndian: bound.sin_port)

        self.listenFD = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd)
        source.setEventHandler { [weak self] in
            let conn = accept(fd, nil, nil)
            guard conn >= 0 else { return }
            Task { [weak self] in
                guard let self else { close(conn); return }
                await self.handleAccepted(conn)
            }
        }
        source.resume()
        self.acceptSource = source

        return URL(string: "http://127.0.0.1:\(port)")!
    }

    /// Tears down the listener and every live spliced connection. Safe to call more than once —
    /// a straggling accept-handler invocation after cancel is absorbed by the fd guards below.
    public func stop() {
        // cancel() is async wrt GCD delivery, so one more handler invocation may fire after this;
        // accept() on the closed fd returns EBADF (<0), which the handler's `guard conn >= 0` catches cleanly.
        acceptSource?.cancel()
        acceptSource = nil
        if listenFD >= 0 { close(listenFD); listenFD = -1 }
        for c in connections { c.close() }
        connections.removeAll()
    }

    private func handleAccepted(_ tcpFD: Int32) async {
        onEvent("accepted")
        let tcp = FileHandle(fileDescriptor: tcpFD, closeOnDealloc: true)
        do {
            let guest = try await dial(guestPort)
            onEvent("dial-ok")
            let conn = ProxyConnection(tcp: tcp, guest: guest, onEvent: onEvent)
            connections.append(conn)
            conn.start(onClose: { [weak self] c in Task { await self?.removeConnection(c) } })
        } catch {
            onDialError(error)
            try? tcp.close()
        }
    }

    private func removeConnection(_ conn: ProxyConnection) {
        connections.removeAll { $0 === conn }
    }

    /// Number of live connections. Exposed for testing only.
    var connectionCount: Int { connections.count }
}

/// One spliced TCP↔vsock pair, driven entirely by **`DispatchIO`** on the raw file descriptors —
/// deliberately NOT by `FileHandle`'s `availableData`/`write(contentsOf:)`.
///
/// Why not `FileHandle`: those accessors raise an Objective-C `NSException` (not a Swift `Error`,
/// so no `do`/`catch` or `try?` can intercept it) on ordinary socket-level failures — ECONNRESET on
/// read, EPIPE on write. For this proxy a peer disconnect is a NORMAL event (every `waitUntilServing`
/// poll and every WKWebView connection close produces one), so an uncatchable exception there aborts
/// the whole process on a completely routine occurrence. Prior fixes (PR #470's raw-POSIX pump, then
/// d6019aea's lock held across read+write) only addressed a concurrent-*close* race; neither can help
/// the error path, where the exception fires on a single-threaded plain error return.
///
/// Why `DispatchIO` and not raw POSIX `read`/`write`: `DispatchIO` reports every error as a plain
/// `errno` value in its completion handler — zero ObjC-exception surface — while staying pure
/// libdispatch. The raw-POSIX/`UnsafeMutableRawBufferPointer` approach also avoided the exception,
/// but pulled in a Swift/Foundation overlay symbol (`libswift_DarwinFoundation1.dylib`) that CI's
/// Xcode 26.2 toolchain doesn't ship, breaking `swift test`'s dlopen entirely (see #69). `DispatchIO`
/// touches none of that overlay.
///
/// Each direction is a streaming `DispatchIO.read` (length `.max`) whose handler forwards received
/// `DispatchData` via `DispatchIO.write`. EOF (empty final chunk, error 0), a read error, or a write
/// error tears the whole pair down exactly once via `closeLocked()`.
///
/// fd ownership: `DispatchIO` takes ownership of the fd it is given and closes it. The incoming
/// `FileHandle`s (the accepted TCP handle; the dialer's guest handle) have their own lifetimes and
/// close their own fds on dealloc, so this type `dup()`s each fd up front and hands the *duplicate*
/// to `DispatchIO`. That way there is no shared fd and no double-close: the FileHandles free their
/// originals whenever they dealloc, and the channels free the dups on teardown.
final class ProxyConnection: @unchecked Sendable {
    private let tcpFD: Int32
    private let guestFD: Int32
    private let queue = DispatchQueue(label: "io.dwk.anglesite.vsock-proxy.conn")
    private var tcpIO: DispatchIO?
    private var guestIO: DispatchIO?
    private let lock = NSLock()
    private var closed = false
    /// Called exactly once, after the connection closes, with `self` as the argument.
    private var onClose: (@Sendable (_ conn: ProxyConnection) -> Void)?
    private let onEvent: @Sendable (String) -> Void

    init(tcp: FileHandle, guest: FileHandle, onEvent: @escaping @Sendable (String) -> Void = { _ in }) {
        // dup() so DispatchIO owns independent fds; the FileHandles keep and close their originals.
        // This is the whole double-close-avoidance story — see the type doc.
        self.tcpFD = dup(tcp.fileDescriptor)
        self.guestFD = dup(guest.fileDescriptor)
        self.onEvent = onEvent
    }

    /// Begin pumping bytes in both directions. `onClose` is provided here (set-once, private) so
    /// there is no mutable public var window between construction and the first read handler firing.
    func start(onClose: @escaping @Sendable (ProxyConnection) -> Void) {
        self.onClose = onClose

        // One DispatchIO channel per fd. The cleanup handler runs when the channel closes; DispatchIO
        // closes the fd for us (ownership transferred from the FileHandle). An errno here (e.g. a
        // channel torn down mid-flight) is not actionable beyond teardown, which closeLocked already
        // performs, so it is intentionally ignored.
        let tcpChannel = DispatchIO(type: .stream, fileDescriptor: tcpFD, queue: queue) { _ in }
        let guestChannel = DispatchIO(type: .stream, fileDescriptor: guestFD, queue: queue) { _ in }
        // Deliver bytes as soon as any arrive rather than buffering to a high-water mark.
        tcpChannel.setLimit(lowWater: 1)
        guestChannel.setLimit(lowWater: 1)
        self.tcpIO = tcpChannel
        self.guestIO = guestChannel

        pump(readFrom: tcpChannel, writeTo: guestChannel, label: "tcp->guest")
        pump(readFrom: guestChannel, writeTo: tcpChannel, label: "guest->tcp")
    }

    /// Streaming read on `readFrom`; every chunk is forwarded to `writeTo`. All errors surface as
    /// `errno` values in the handlers — never as an ObjC `NSException` — so a peer reset (ECONNRESET
    /// on read, EPIPE on write) is handled as a clean teardown instead of a process abort.
    private func pump(readFrom: DispatchIO, writeTo: DispatchIO, label: String) {
        readFrom.read(offset: 0, length: Int.max, queue: queue) { [weak self] done, data, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                writeTo.write(offset: 0, data: data, queue: self.queue) { [weak self] wDone, _, wError in
                    guard let self else { return }
                    if wError != 0 && wDone {
                        self.onEvent("\(label) write error: errno \(wError) (\(String(cString: strerror(wError))))")
                        self.close()
                    }
                }
            }
            if error != 0 {
                // ECONNRESET / EBADF / etc. — the read side of the peer went away abnormally.
                self.onEvent("\(label) read error: errno \(error) (\(String(cString: strerror(error))))")
                self.close()
                return
            }
            if done && (data == nil || data!.isEmpty) {
                // Clean EOF: peer closed with a FIN and no error.
                self.onEvent("\(label) EOF")
                self.close()
            }
        }
    }

    func close() {
        lock.lock()
        closeLocked()
        lock.unlock()
    }

    /// Idempotent teardown. Must be called with `lock` held.
    ///
    /// Close-ordering matters: a bare `close(flags: .stop)` on both channels — the previous shape —
    /// cancels ALL in-flight I/O, including a not-yet-drained final write. On the normal teardown
    /// path (guest finishes its HTTP response → the last chunk is queued as a `write` on the tcp
    /// channel → guest EOF → `close()`), that cancellation truncates the response body the client
    /// receives. Both channels are write *targets* — the tcp channel carries guest→client bytes, the
    /// guest channel carries client→guest bytes — so both can hold an undrained final write.
    ///
    /// A plain `close()` (default flags) would drain queued writes, but each channel also has a
    /// streaming `read(offset:0, length:.max)` enqueued on it; that read never completes on its own,
    /// so the channel — closing only "after all enqueued operations complete" — would stay open
    /// forever and never tear down. The resolution is a per-channel `barrier`: the barrier block runs
    /// on the channel's own queue only AFTER every previously-enqueued operation (crucially, the
    /// queued writes) has finished, and it then `close(flags: .stop)`s to cancel the still-pinned
    /// infinite read. Net effect: queued writes flush first, then the read is cancelled and the fd
    /// closes — no truncation, still prompt.
    ///
    /// Exactly-once / deadlock-free: the `closed` guard makes teardown run once; each `barrier` is
    /// scheduled once. The barrier block captures the channel directly (so nil-ing `tcpIO`/`guestIO`
    /// below does not free it) and takes NO lock — barriers run on `queue`, and re-taking `lock`
    /// there would risk deadlock, so the block does only the lock-free `close`. `onClose` is invoked
    /// here (not after unlocking): it only ever does `Task { await self?.removeConnection(c) }`-shaped
    /// work, which schedules and returns immediately, so calling it while holding this instance's own
    /// lock cannot deadlock or re-enter.
    private func closeLocked() {
        guard !closed else { return }
        closed = true
        if let tcpIO { tcpIO.barrier { tcpIO.close(flags: .stop) } }
        if let guestIO { guestIO.barrier { guestIO.close(flags: .stop) } }
        tcpIO = nil
        guestIO = nil
        onClose?(self)
    }
}
#endif
