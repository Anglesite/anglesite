import Foundation
// URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin platforms
// (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// A DPoP (RFC 9449) proof-of-possession key pair. `@dwk/indieauth` mints access tokens bound to
/// the public key's thumbprint (`cnf.jkt`); every subsequent resource request (`@dwk/microsub`,
/// `@dwk/micropub`, …) must present a proof signed by the *same* key pair the token endpoint saw,
/// so this value is generated once per site sign-in and persisted (see `SecretAccounts`) rather
/// than regenerated per request.
public struct DPoPKeyPair: Sendable {
    #if canImport(CryptoKit)
    private let privateKey: P256.Signing.PrivateKey
    #endif

    /// Generates a fresh P-256 key pair.
    public init() {
        #if canImport(CryptoKit)
        self.privateKey = P256.Signing.PrivateKey()
        #endif
    }

    /// Reconstructs a previously persisted key pair from its raw 32-byte private scalar
    /// (`persistedRepresentation`). `nil` if `data` isn't a valid P-256 private key.
    public init?(persistedRepresentation data: Data) {
        #if canImport(CryptoKit)
        guard let key = try? P256.Signing.PrivateKey(rawRepresentation: data) else { return nil }
        self.privateKey = key
        #else
        return nil
        #endif
    }

    /// The raw private-key bytes to persist (Keychain via `SecretStore`), so the same key pair
    /// can be reconstructed for later resource requests within the sign-in's lifetime.
    public var persistedRepresentation: Data {
        #if canImport(CryptoKit)
        privateKey.rawRepresentation
        #else
        Data()
        #endif
    }

    #if canImport(CryptoKit)
    /// The public key as a JWK (RFC 7518 §6.2), embedded in every proof's header so a verifier
    /// can check the signature and compute the RFC 7638 thumbprint. Field order doesn't matter
    /// for parsing — the verifier canonicalizes its own copy before hashing.
    private var publicJWK: [String: String] {
        // ANSI X9.63 uncompressed point: a leading 0x04 format byte, then X (32 bytes), then Y
        // (32 bytes) — `.x963Representation` (not `.rawRepresentation`, whose exact byte layout
        // isn't part of its name) is the unambiguous, explicitly-documented format for this.
        let raw = privateKey.publicKey.x963Representation
        let start = raw.index(after: raw.startIndex)
        let x = raw.subdata(in: start..<(start + 32))
        let y = raw.subdata(in: (start + 32)..<(start + 64))
        return ["kty": "EC", "crv": "P-256", "x": Self.base64URL(x), "y": Self.base64URL(y)]
    }
    #endif

    /// Builds and signs a DPoP proof JWT (RFC 9449 §4.2) for one HTTP request: a fresh `jti`/
    /// `iat`, `htm`/`htu` binding it to this request, and — when `accessToken` is supplied — the
    /// `ath` claim binding it to that specific bearer token (required on every resource request;
    /// omit for the token-endpoint exchange, which has no token yet). `nonce` echoes a
    /// server-issued `DPoP-Nonce` (RFC 9449 §8) on a retried proof; omit on the first attempt.
    public func proof(htm: String, htu: String, accessToken: String? = nil, nonce: String? = nil) throws -> String {
        #if canImport(CryptoKit)
        let header: [String: Any] = ["typ": "dpop+jwt", "alg": "ES256", "jwk": publicJWK]
        var payload: [String: Any] = [
            "jti": UUID().uuidString,
            "htm": htm,
            "htu": htu,
            "iat": Int(Date().timeIntervalSince1970),
        ]
        if let accessToken {
            payload["ath"] = Self.base64URL(Data(SHA256.hash(data: Data(accessToken.utf8))))
        }
        if let nonce {
            payload["nonce"] = nonce
        }
        let headerSegment = try Self.base64URLJSON(header)
        let payloadSegment = try Self.base64URLJSON(payload)
        let signingInput = Data("\(headerSegment).\(payloadSegment)".utf8)
        let signature = try privateKey.signature(for: signingInput)
        return "\(headerSegment).\(payloadSegment).\(Self.base64URL(signature.rawRepresentation))"
        #else
        // DPoP signing needs CryptoKit (Apple platforms only) — there's no sign-in UI on a
        // platform without it either (matches CloudflareOAuthClient.codeChallenge(for:)'s posture).
        throw DPoPError.unavailable
        #endif
    }

    private static func base64URLJSON(_ object: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return base64URL(data)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Why a ``DPoPKeyPair`` operation couldn't run at all — distinct from a server-side proof
/// rejection, which surfaces through the HTTP response instead.
public enum DPoPError: Error, Sendable {
    /// CryptoKit isn't available on this platform, so proofs can't be signed. This is a
    /// deliberate dead end rather than a fallback: a platform without CryptoKit has no sign-in
    /// UI either, so no code path should ever reach signing there (matches
    /// `CloudflareOAuthClient.codeChallenge(for:)`'s posture).
    case unavailable
}

/// Detects an RFC 9449 §8 DPoP-nonce challenge: a 400/401 response carrying `error:
/// "use_dpop_nonce"` and a `DPoP-Nonce` response header with the nonce the retried proof's
/// `nonce` claim must echo. Shared by `SiteIndieAuthClient` and `MicrosubClient` so both clients
/// agree on what counts as a challenge — any other 4xx/5xx (including a bare `invalid_dpop_proof`
/// with no nonce header) falls through to the caller's ordinary failure handling.
enum DPoPNonceChallenge {
    static func nonce(in data: Data, response http: HTTPURLResponse) -> String? {
        guard http.statusCode == 400 || http.statusCode == 401 else { return nil }
        guard let nonce = http.value(forHTTPHeaderField: "DPoP-Nonce"), !nonce.isEmpty else { return nil }
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object["error"] as? String == "use_dpop_nonce"
        else { return nil }
        return nonce
    }
}
