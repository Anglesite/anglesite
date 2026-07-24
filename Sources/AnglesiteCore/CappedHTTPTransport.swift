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

    /// Streams the body so the size cap is enforced *during* transfer — `URLSession.data(for:)`
    /// buffers the whole response before returning, which would make a post-hoc `data.count`
    /// check purely decorative.
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
        for try await byte in bytes {
            data.append(byte)
            if data.count > cap { throw tooLarge(data.count) }
        }
        return (data, http)
    }
}
