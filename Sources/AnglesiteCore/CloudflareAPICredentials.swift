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
    /// - Parameters:
    ///   - secretStore: Where the OAuth credential and legacy token live. Defaults to the
    ///     platform Keychain; call sites with their own injected store (e.g. a sync job's
    ///     `secretStore` parameter) pass it through so tests never touch the real Keychain.
    ///   - diagnosticSource: When non-nil, logs a breadcrumb to ``LogCenter`` (under this source
    ///     tag) whenever resolution takes a fallback path — the env var overriding stored
    ///     credentials, or falling through to the legacy pasted token because no OAuth credential
    ///     resolved — mirroring the caller-specific diagnostics call sites used to log for
    ///     themselves before sharing this resolver. `nil` (the default) logs nothing, matching the
    ///     silent behavior every call site except `PlistEditorModel`'s analytics token had before.
    /// - Returns: A usable token, or `nil` if nothing is configured anywhere in the resolution
    ///   order.
    /// - Throws: Whatever `secretStore`'s *legacy-token* read throws (e.g. a Keychain error) —
    ///   surfaced to the caller rather than silently swallowed to `nil`, so a real store failure
    ///   reads as "couldn't read token" instead of prompting for a re-sign-in when a token is
    ///   actually stored fine. A failure reading the *OAuth* slot is swallowed instead: it must
    ///   fall through to the legacy token below, not skip that fallback the way a thrown error
    ///   otherwise would (a transient/genuine Keychain error on the OAuth slot must not cost a
    ///   user their perfectly good pasted token).
    public static func resolve(
        secretStore: any SecretStore = PlatformSecretStore.make(),
        diagnosticSource: String? = nil
    ) async throws -> String? {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            if let diagnosticSource {
                await LogCenter.shared.append(
                    source: diagnosticSource, stream: .stderr,
                    text: "Using the CLOUDFLARE_API_TOKEN environment variable.")
            }
            return env
        }
        let oauthSource = CloudflareOAuthTokenSource(secretStore: secretStore, refresh: { refreshToken, tokenEndpoint in
            try await CloudflareOAuthClient(scope: AnglesiteTokenTemplate.oauthScope)
                .refresh(refreshToken: refreshToken, tokenEndpoint: tokenEndpoint)
        })
        if let oauthToken = try? await oauthSource.resolve() {
            return oauthToken
        }
        let legacyToken = try secretStore.readCloudflareToken()
        if legacyToken != nil, let diagnosticSource {
            await LogCenter.shared.append(
                source: diagnosticSource, stream: .stderr,
                text: "No usable Cloudflare OAuth credential found; using the legacy pasted token.")
        }
        return legacyToken
    }
}
