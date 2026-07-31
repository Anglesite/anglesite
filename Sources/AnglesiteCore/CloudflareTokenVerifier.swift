import Foundation

/// A Cloudflare account surfaced after a token verifies. Both fields are best-effort: `name` is
/// `nil` when the account lookup can't run or returns nothing (the token is still valid — the caller
/// falls back to a generic "verified" message), and `email` is `nil` for token auth that isn't
/// associated with a user email.
public struct CloudflareAccount: Sendable, Equatable {
    /// Account display name from the best-effort `GET /accounts` lookup; `nil` never means the
    /// token is bad, only that the nicety wasn't available.
    public let name: String?
    /// Email tied to the credential, when Cloudflare exposes one. API tokens usually have none —
    /// this exists for auth shapes that do.
    public let email: String?

    /// Memberwise initializer; verifiers assemble this from whatever the lookups yielded.
    public init(name: String?, email: String?) {
        self.name = name
        self.email = email
    }
}

/// Why verifying a pasted Cloudflare token failed, with the user-facing copy the prompt shows.
public enum TokenVerifyError: Error, Equatable, Sendable {
    /// The token was rejected by Cloudflare (bad/expired/insufficient scope).
    case invalidToken
    /// We couldn't reach Cloudflare (DNS/connection failure).
    case network
    /// We couldn't check the token at all (unexpected response, etc.).
    case unavailable(String)

    /// The exact copy the token prompt shows for this failure. Kept on the error itself so every
    /// entry point renders the same wording instead of re-translating cases ad hoc.
    public var userMessage: String {
        switch self {
        case .invalidToken:
            return "That token didn’t work. Use the “Create token” link (it pre-fills the “Anglesite” token) and copy the whole token."
        case .network:
            return "Couldn’t reach Cloudflare. Check your connection and try again."
        case .unavailable(let reason):
            return reason
        }
    }
}

/// Verifies a Cloudflare API token before it's persisted, so a bad token is caught at the point of
/// entry instead of failing later inside a deploy. The production conformer is
/// `CloudflareAPITokenVerifier` (a native REST call — no Node/wrangler).
public protocol TokenVerifying: Sendable {
    /// Checks `token` against Cloudflare and classifies the outcome. Returns a `Result` instead of
    /// throwing so every failure arrives pre-classified as a ``TokenVerifyError`` with its
    /// user-facing copy attached. `siteDirectory` is part of the seam for historical reasons —
    /// the production conformer's verification is a pure API call and ignores it (kept so callers
    /// and the MAS sandbox-grant path didn't have to change when the wrangler-based verifier went
    /// away).
    func verify(token: String, siteDirectory: URL) async -> Result<CloudflareAccount, TokenVerifyError>
}
