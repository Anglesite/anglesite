import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum AvatarLoadError: Error, Equatable, Sendable {
    /// The avatar URL, or the URL a redirect actually landed on, wasn't `https`.
    case insecureURL
    case responseTooLarge(Int)
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
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// 2 MB. Comfortably above a real Fediverse avatar (Mastodon caps uploads well below this)
    /// and far below what a hostile instance would need to hurt the pane.
    public static let maximumResponseBytes = 2 * 1024 * 1024
    /// Idle timeout: the longest the transfer may go without progress.
    public static let timeout: TimeInterval = 10
    /// Wall-clock deadline for the whole transfer — see `CappedHTTPTransport` for why the idle
    /// timeout alone is not a bound a slow-drip server has to respect.
    public static let resourceTimeout: TimeInterval = 20

    private let transport: Transport

    public init(transport: @escaping Transport = AvatarLoader.defaultTransport) {
        self.transport = transport
    }

    public func data(for url: URL) async throws -> Data {
        // The one expression of the HTTPS rule, shared with the actor-document fetch.
        guard ActorProfileFetcher.isHTTPS(url) else { throw AvatarLoadError.insecureURL }

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
