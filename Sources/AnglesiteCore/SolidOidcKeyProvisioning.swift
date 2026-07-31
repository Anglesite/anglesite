import Foundation
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Generates and persists the per-site secret material `@dwk/solid-oidc` and `@dwk/webdav` need:
/// an ES256 signing key (as a private JWK, RFC 7518 §6.2.2 — the shape `@dwk/solid-oidc`'s
/// `generateSigningJwk()` produces, generated app-side instead since this is exactly a standard
/// P-256 JWK and CryptoKit already builds one for `DPoPKeyPair`'s public-key case) and a random
/// pepper for WebDAV's app-password hashing. Generated exactly once per site, lazily, the first
/// time a caller asks — the signing key is never regenerated, since rotating it invalidates every
/// access token `@dwk/solid-pod` has already accepted the corresponding JWKS entry for (mirrors
/// `ActivityPubKeyProvisioning`'s "never regenerate" rationale for its own signing key).
public enum SolidOidcKeyProvisioning {
    /// Failures generating secret material. Both cases mean *no* secret was persisted — a caller
    /// can safely retry, since nothing partial is ever written to the `SecretStore`.
    public enum Error: Swift.Error {
        /// The platform's secure random source refused to produce bytes (the associated string
        /// carries the underlying `SecRandomCopyBytes` status for the log).
        case keyGenerationFailed(String)
        /// Built without CryptoKit/Security (non-Darwin) — this provisioning path requires the
        /// platform crypto stack, and there is deliberately no weaker fallback for key material.
        case unsupportedPlatform
    }

    /// Returns this site's Solid-OIDC signing key as a JSON-serialized private EC P-256 JWK,
    /// generating and persisting it into `secretStore` on first call. Every subsequent call for
    /// the same `siteID` returns the same value.
    ///
    /// **Concurrency note:** not safe to call concurrently for the same `siteID` — same caveat as
    /// `ActivityPubKeyProvisioning.secrets(siteID:secretStore:)`, whose sole caller
    /// (`SocialWorkerProvisionCommand.provision()`) already serializes on this.
    public static func signingKeyJWK(siteID: String, secretStore: any SecretStore) throws -> String {
        let account = SecretAccounts.solidOidcSigningKeyJWK(siteID: siteID)
        if let existing = try secretStore.read(account: account) {
            return existing
        }
        let jwk = try generateSigningKeyJWK()
        try secretStore.write(jwk, account: account)
        return jwk
    }

    /// Returns this site's WebDAV app-password pepper, generating and persisting it into
    /// `secretStore` on first call. Every subsequent call for the same `siteID` returns the same
    /// value. Unlike the signing key above, rotating this only invalidates existing app
    /// passwords — but it's still generated once, not regenerated per deploy, so a redeploy
    /// doesn't silently lock out every existing WebDAV client.
    public static func webdavPepper(siteID: String, secretStore: any SecretStore) throws -> String {
        let account = SecretAccounts.webdavPepper(siteID: siteID)
        if let existing = try secretStore.read(account: account) {
            return existing
        }
        let pepper = try randomToken()
        try secretStore.write(pepper, account: account)
        return pepper
    }

    static func generateSigningKeyJWK() throws -> String {
        #if canImport(CryptoKit)
        let privateKey = P256.Signing.PrivateKey()
        // ANSI X9.63 uncompressed point: a leading 0x04 format byte, then X (32 bytes), then Y
        // (32 bytes) — same decomposition `DPoPKeyPair.publicJWK` uses for the public-key case.
        let raw = privateKey.publicKey.x963Representation
        let start = raw.index(after: raw.startIndex)
        let x = raw.subdata(in: start..<(start + 32))
        let y = raw.subdata(in: (start + 32)..<(start + 64))
        let d = privateKey.rawRepresentation
        let jwk: [String: String] = [
            "kty": "EC", "crv": "P-256",
            "x": base64url(x), "y": base64url(y), "d": base64url(d),
        ]
        let data = try JSONSerialization.data(withJSONObject: jwk, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
        #else
        throw Error.unsupportedPlatform
        #endif
    }

    static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        #if canImport(Security)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw Error.keyGenerationFailed("SecRandomCopyBytes failed with status \(status)")
        }
        #else
        throw Error.unsupportedPlatform
        #endif
        return base64url(Data(bytes))
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
