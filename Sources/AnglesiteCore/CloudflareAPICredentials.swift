import Foundation

/// Shared Cloudflare API bearer-token resolution (#1211), so every call site that needs one —
/// not just the deploy path — sees an OAuth credential the same way ``DeployCommand/keychainTokenSource``
/// already does. Order: the `CLOUDFLARE_API_TOKEN` env var (a developer's shell still wins), then a
/// stored OAuth credential (refreshed first via ``CloudflareOAuthTokenSource`` if expired), then the
/// legacy pasted-token slot — read-only now that `CloudflareTokenPromptView` has been replaced by
/// OAuth sign-in (#1204), kept so a token a user already pasted keeps working.
public enum CloudflareAPICredentials {
    /// Resolves a usable Cloudflare API bearer token.
    ///
    /// - Parameter secretStore: Where the OAuth credential and legacy token live. Defaults to the
    ///   platform Keychain; call sites with their own injected store (e.g. a sync job's
    ///   `secretStore` parameter) pass it through so tests never touch the real Keychain.
    /// - Returns: A usable token, or `nil` if nothing is configured anywhere in the resolution
    ///   order.
    /// - Throws: Whatever `secretStore`'s read throws (e.g. a Keychain error) — surfaced to the
    ///   caller rather than silently swallowed to `nil`, so a real store failure reads as "couldn't
    ///   read token" instead of prompting for a re-sign-in when a token is actually stored fine.
    public static func resolve(secretStore: any SecretStore = PlatformSecretStore.make()) async throws -> String? {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return env
        }
        let oauthSource = CloudflareOAuthTokenSource(secretStore: secretStore, refresh: { refreshToken, tokenEndpoint in
            try await CloudflareOAuthClient(scope: AnglesiteTokenTemplate.oauthScope)
                .refresh(refreshToken: refreshToken, tokenEndpoint: tokenEndpoint)
        })
        if let oauthToken = try await oauthSource.resolve() {
            return oauthToken
        }
        return try secretStore.readCloudflareToken()
    }
}
