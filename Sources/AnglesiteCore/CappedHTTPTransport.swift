import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Shared plumbing for the two follower-facing fetches — `ActorProfileFetcher` (actor document)
/// and `AvatarLoader` (avatar image). Both pull bytes from a URL a *follower* chose, so both need
/// the same two properties, and neither can be built on `URLSession.shared`:
///
/// 1. **A wall-clock deadline.** `URLRequest.timeoutInterval` maps to
///    `timeoutIntervalForRequest`, which is an *idle* timeout — the longest a transfer may go
///    without progress. A hostile instance that dribbles one byte every few seconds never trips
///    it, and can hold a slot open indefinitely (`FollowersModel`'s enrichment gate is shared, so
///    a handful of such followers would starve every other row). `timeoutIntervalForResource`
///    bounds the whole transfer instead, and can only be set on a session's configuration —
///    which is precisely what `URLSession.shared` doesn't let a caller do.
/// 2. **No shared-cache pollution.** An ephemeral configuration keeps a large, attacker-chosen
///    response out of the process-wide `URLCache`.
enum CappedHTTPTransport {
    static func configuration(
        requestTimeout: TimeInterval, resourceTimeout: TimeInterval
    ) -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeout
        configuration.timeoutIntervalForResource = resourceTimeout
        return configuration
    }

    static func session(requestTimeout: TimeInterval, resourceTimeout: TimeInterval) -> URLSession {
        URLSession(
            configuration: configuration(
                requestTimeout: requestTimeout, resourceTimeout: resourceTimeout))
    }

    /// Batched before each flush into `Data`: `URLSession.AsyncBytes` still hands bytes over one
    /// at a time, but appending each one straight into `Data` pays a mutation/capacity check per
    /// byte. That was tolerable at the 256 KB actor-document cap; at a 2 MB avatar cap times
    /// several concurrent rows it is materially more expensive. Small relative to either cap, so
    /// the early-abort-past-cap check below still fires within one buffer's worth of the limit,
    /// not after the whole body has arrived.
    private static let readBufferSize = 16 * 1024

    #if !canImport(FoundationNetworking)
    /// Streams the body so the size cap is enforced *during* transfer — `URLSession.data(for:)`
    /// buffers the whole response before returning, which would make a post-hoc `data.count`
    /// check purely decorative.
    ///
    /// Darwin-only: `URLSession.bytes(for:)` / `AsyncBytes` aren't part of swift-corelibs-foundation.
    /// See the `#else` branch below for the Linux fallback and what it gives up.
    static func fetch(
        _ request: URLRequest,
        session: URLSession,
        cap: Int,
        tooLarge: @Sendable (Int) -> Error
    ) async throws -> (Data, HTTPURLResponse) {
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }

        // A declared length over the cap fails before a single body byte is read.
        if http.expectedContentLength > Int64(cap) {
            throw tooLarge(Int(http.expectedContentLength))
        }
        var data = Data()
        if http.expectedContentLength > 0 {
            data.reserveCapacity(min(cap, Int(http.expectedContentLength)))
        }
        var buffer = [UInt8]()
        buffer.reserveCapacity(readBufferSize)
        for try await byte in bytes {
            buffer.append(byte)
            if buffer.count >= readBufferSize {
                data.append(contentsOf: buffer)
                buffer.removeAll(keepingCapacity: true)
                if data.count > cap { throw tooLarge(data.count) }
            }
        }
        if !buffer.isEmpty {
            data.append(contentsOf: buffer)
        }
        if data.count > cap { throw tooLarge(data.count) }
        return (data, http)
    }
    #else
    /// Linux fallback: swift-corelibs-foundation has no `URLSession.bytes(for:)` /
    /// `AsyncBytes`, so this cannot stream. `URLSession.data(for:)` buffers the *entire* body
    /// before returning, which means an oversized response from a hostile follower's server is
    /// fully read into memory before the `data.count` check below ever runs — the byte cap
    /// still holds (nothing over `cap` is handed back to the caller), but it is enforced
    /// post-hoc, not during transfer, so the memory spend the streaming path exists to avoid is
    /// paid here. This is a real capability gap versus the Darwin path above, not an equivalent
    /// substitute — a future Linux port that takes this seriously needs a streaming HTTP client
    /// (e.g. via `AsyncHTTPClient`) to close it for real.
    static func fetch(
        _ request: URLRequest,
        session: URLSession,
        cap: Int,
        tooLarge: @Sendable (Int) -> Error
    ) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }

        // A declared length over the cap fails before trusting the (already fully-buffered) body.
        if http.expectedContentLength > Int64(cap) {
            throw tooLarge(Int(http.expectedContentLength))
        }
        if data.count > cap { throw tooLarge(data.count) }
        return (data, http)
    }
    #endif
}
