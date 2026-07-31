import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Why an avatar fetch was refused. Every case is a *guard* firing, not a bug — avatar URLs are
/// attacker-chosen (see ``AvatarLoader``), so callers treat any of these as "show the placeholder"
/// rather than something to surface or retry.
public enum AvatarLoadError: Error, Equatable, Sendable {
    /// The avatar URL, or the URL a redirect actually landed on, wasn't `https`.
    case insecureURL
    /// The transfer exceeded ``AvatarLoader/maximumResponseBytes`` — aborted mid-stream by the
    /// default transport, so a hostile instance can't even make the app finish the download.
    case responseTooLarge(Int)
    /// A non-2xx response.
    case requestFailed(status: Int)
}

/// Fetches one follower's avatar image bytes, under the same guards as their actor document.
///
/// `ActorProfileFetcher` enforces HTTPS, a byte cap, and a wall-clock deadline on the actor
/// document — but the `iconURL` it extracts is just as attacker-chosen, and handing that URL
/// straight to SwiftUI's `AsyncImage` would download and decode it with no byte cap, no deadline,
/// and no pixel-dimension limit, on `URLSession.shared` (so an oversize response also lands in the
/// process-wide `URLCache`). A follower can serve a 200 MB file, or a decompression-bomb PNG, as
/// their avatar — and several visible rows can do it at once. That is a *larger* attack surface
/// than the document the guards were built for, which is why avatars go through here instead.
///
/// Returns raw `Data`, deliberately: decoding is the caller's job, so it can happen off the
/// MainActor and against a pixel-dimension bound. There is no cache here — the profile cache
/// stores only the URL by design, and an in-memory per-row load is the intended cost.
public struct AvatarLoader: Sendable {
    /// Fetch seam so tests can serve canned bytes without a network. Note the injected transport
    /// is still held to the byte cap after the fact — only the default transport can abort
    /// mid-stream.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// 2 MB. Comfortably above a real Fediverse avatar (Mastodon caps uploads well below this)
    /// and far below what a hostile instance would need to hurt the pane.
    public static let maximumResponseBytes = 2 * 1024 * 1024
    /// Idle timeout: the longest the transfer may go without progress.
    public static let timeout: TimeInterval = 10
    /// Wall-clock deadline for the whole transfer — see `CappedHTTPTransport` for why the idle
    /// timeout alone is not a bound a slow-drip server has to respect.
    public static let resourceTimeout: TimeInterval = 20
    /// Mirrors `FollowersModel.maxConcurrentEnrichments`: a `List` can realize dozens of rows at
    /// once, and every realized row starts its own avatar `.task` independently of the enrichment
    /// gate (avatars aren't routed through it — an `AvatarLoader` is shared per pane instead, so
    /// this bound applies across every row in that pane). Without a cap here, dozens of concurrent
    /// 2 MB transfers plus that many detached ImageIO decodes would follow from one scroll.
    public static let maxConcurrentLoads = 4

    private let transport: Transport
    private let gate: ConcurrencyGate

    /// Each `init` creates its own concurrency gate, so the ``maxConcurrentLoads`` bound is
    /// per-instance: share one loader per pane (as `FollowersModel` does) rather than
    /// constructing one per row, or the bound stops bounding anything.
    public init(transport: @escaping Transport = AvatarLoader.defaultTransport) {
        self.transport = transport
        self.gate = ConcurrencyGate(limit: Self.maxConcurrentLoads)
    }

    /// Fetches the avatar bytes under the full guard set — HTTPS (including post-redirect),
    /// byte cap, deadlines, and the shared concurrency gate (so a fast scroll queues loads
    /// instead of fanning them all out at once). Throws ``AvatarLoadError`` for guard
    /// violations; transport errors propagate as-is.
    public func data(for url: URL) async throws -> Data {
        // The one expression of the HTTPS rule, shared with the actor-document fetch.
        guard ActorProfileFetcher.isHTTPS(url) else { throw AvatarLoadError.insecureURL }

        await gate.acquire()
        do {
            let data = try await fetch(url)
            await gate.release()
            return data
        } catch {
            await gate.release()
            throw error
        }
    }

    private func fetch(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        request.timeoutInterval = Self.timeout

        let (data, http) = try await transport(request)

        // URLSession follows redirects transparently, so re-check where the bytes actually came
        // from before trusting them — an HTTPS avatar URL that redirects to plaintext is not one.
        if let finalURL = http.url, !ActorProfileFetcher.isHTTPS(finalURL) {
            throw AvatarLoadError.insecureURL
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AvatarLoadError.requestFailed(status: http.statusCode)
        }
        // The default transport already aborts mid-stream past the cap; this re-check holds an
        // injected transport to the same limit.
        guard data.count <= Self.maximumResponseBytes else {
            throw AvatarLoadError.responseTooLarge(data.count)
        }
        return data
    }

    static let session = CappedHTTPTransport.session(
        requestTimeout: timeout, resourceTimeout: resourceTimeout)

    /// Production transport: streams so the cap is enforced *during* transfer, on a session whose
    /// configuration carries the wall-clock deadline.
    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request,
            session: AvatarLoader.session,
            cap: AvatarLoader.maximumResponseBytes,
            tooLarge: AvatarLoadError.responseTooLarge)
    }
}

/// A simple counting semaphore for bounding concurrent `async` work, FIFO over waiters. An `actor`
/// rather than `Synchronization.Mutex`: the test binary's deployment target is macOS 14, and
/// `Mutex` needs 15+.
///
/// `AvatarLoader` is a `struct`, but every copy of one instance shares the same gate — the actor
/// is a reference type, so copying the struct copies the reference, not the semaphore state. That
/// is what lets a single `AvatarLoader` instance (one per `FollowersModel`, per `FollowersView`'s
/// doc comment) bound every row's avatar load in that pane, the same way one `FollowersModel`
/// instance bounds its own enrichment fan-out.
actor ConcurrencyGate {
    private let limit: Int
    private var available: Int
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(limit: Int) {
        self.limit = limit
        self.available = limit
    }

    /// Suspends until a slot is free. Always pair with ``release()`` — including on the throwing
    /// path, since a leaked slot permanently shrinks the pool for the life of the loader.
    func acquire() async {
        if available > 0 {
            available -= 1
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    /// Hands the freed slot straight to the oldest waiter rather than incrementing `available`,
    /// so waiters are served in arrival order.
    func release() {
        if !waiters.isEmpty {
            waiters.removeFirst().resume()
        } else {
            available += 1
        }
    }
}
