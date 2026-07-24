import Testing
import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif
@testable import AnglesiteCore

/// Tests `DPoPKeyPair`'s proof construction (RFC 9449 §4.2) and persistence round-trip — the
/// piece `SiteIndieAuthClient`/`MicrosubClient` lean on for every DPoP-bound request.
@Suite
struct DPoPKeyPairTests {
    private func base64urlDecode(_ segment: String) -> Data {
        var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        return Data(base64Encoded: base64) ?? Data()
    }

    private func jsonSegment(_ segment: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: base64urlDecode(segment))) as? [String: Any] ?? [:]
    }

    @Test("persistedRepresentation round-trips through init?(persistedRepresentation:)")
    func persistenceRoundTrips() throws {
        let original = DPoPKeyPair()
        let restored = DPoPKeyPair(persistedRepresentation: original.persistedRepresentation)
        #expect(restored != nil)
        #expect(restored?.persistedRepresentation == original.persistedRepresentation)
    }

    @Test("init?(persistedRepresentation:) rejects malformed bytes")
    func rejectsMalformedBytes() {
        #expect(DPoPKeyPair(persistedRepresentation: Data([0x01, 0x02, 0x03])) == nil)
    }

    #if canImport(CryptoKit)
    @Test("proof carries a well-formed header and htm/htu/jti/iat payload, no ath by default")
    func proofClaims() throws {
        let keyPair = DPoPKeyPair()
        let proof = try keyPair.proof(htm: "POST", htu: "https://owner.example/microsub")
        let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
        #expect(segments.count == 3)

        let header = jsonSegment(String(segments[0]))
        #expect(header["typ"] as? String == "dpop+jwt")
        #expect(header["alg"] as? String == "ES256")
        let jwk = header["jwk"] as? [String: String]
        #expect(jwk?["kty"] == "EC")
        #expect(jwk?["crv"] == "P-256")
        #expect(jwk?["x"]?.isEmpty == false)
        #expect(jwk?["y"]?.isEmpty == false)

        let payload = jsonSegment(String(segments[1]))
        #expect(payload["htm"] as? String == "POST")
        #expect(payload["htu"] as? String == "https://owner.example/microsub")
        #expect((payload["jti"] as? String)?.isEmpty == false)
        #expect(payload["iat"] as? Int != nil)
        #expect(payload["ath"] == nil)
    }

    @Test("proof(accessToken:) carries the base64url(SHA-256(token)) ath claim")
    func proofAccessTokenHash() throws {
        let keyPair = DPoPKeyPair()
        let token = "example-access-token"
        let proof = try keyPair.proof(htm: "GET", htu: "https://owner.example/microsub", accessToken: token)
        let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
        let payload = jsonSegment(String(segments[1]))

        let expectedAth = Data(SHA256.hash(data: Data(token.utf8)))
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        #expect(payload["ath"] as? String == expectedAth)
    }

    @Test("two proofs for the same request use distinct jti values")
    func jtiIsUnique() throws {
        let keyPair = DPoPKeyPair()
        let first = jsonSegment(String(try keyPair.proof(htm: "GET", htu: "https://owner.example/x").split(separator: ".")[1]))
        let second = jsonSegment(String(try keyPair.proof(htm: "GET", htu: "https://owner.example/x").split(separator: ".")[1]))
        #expect(first["jti"] as? String != second["jti"] as? String)
    }

    @Test("the proof's signature verifies against its own embedded public key")
    func signatureVerifiesAgainstEmbeddedKey() throws {
        let keyPair = DPoPKeyPair()
        let proof = try keyPair.proof(htm: "POST", htu: "https://owner.example/microsub")
        let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
        let header = jsonSegment(String(segments[0]))
        let jwk = header["jwk"] as! [String: String]

        let x = base64urlDecode(jwk["x"]!)
        let y = base64urlDecode(jwk["y"]!)
        // Matches DPoPKeyPair.publicJWK's own extraction: X9.63 uncompressed point format.
        let publicKey = try P256.Signing.PublicKey(x963Representation: Data([0x04]) + x + y)

        let signingInput = Data("\(segments[0]).\(segments[1])".utf8)
        let signatureBytes = base64urlDecode(String(segments[2]))
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureBytes)
        #expect(publicKey.isValidSignature(signature, for: signingInput))
    }

    @Test("proof(nonce:) carries the nonce claim when passed")
    func proofNonceClaim() throws {
        let keyPair = DPoPKeyPair()
        let proof = try keyPair.proof(htm: "POST", htu: "https://owner.example/token", nonce: "server-nonce-1")
        let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
        let payload = jsonSegment(String(segments[1]))
        #expect(payload["nonce"] as? String == "server-nonce-1")
    }

    @Test("proof omits the nonce claim by default")
    func proofNoNonceByDefault() throws {
        let keyPair = DPoPKeyPair()
        let proof = try keyPair.proof(htm: "POST", htu: "https://owner.example/token")
        let segments = proof.split(separator: ".", omittingEmptySubsequences: false)
        let payload = jsonSegment(String(segments[1]))
        #expect(payload["nonce"] == nil)
    }
    #endif
}

/// Tests `DPoPNonceChallenge`'s RFC 9449 §8 detection: it must require all three of status
/// 400/401, a `use_dpop_nonce` error body, and a non-empty `DPoP-Nonce` header before treating a
/// response as a challenge — anything less is an ordinary failure the caller handles as today.
@Suite
struct DPoPNonceChallengeTests {
    private let url = URL(string: "https://owner.example/token")!

    private func response(_ code: Int, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: headers)!
    }

    @Test("matches a 400 with use_dpop_nonce error and a DPoP-Nonce header")
    func matchesChallenge() {
        let data = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = response(400, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == "nonce-abc")
    }

    @Test("matches a 401 with use_dpop_nonce error and a DPoP-Nonce header")
    func matchesChallengeOn401() {
        let data = Data(#"{"error":"use_dpop_nonce","error_description":"nonce required"}"#.utf8)
        let http = response(401, headers: ["DPoP-Nonce": "nonce-xyz"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == "nonce-xyz")
    }

    @Test("does not match a 400 with a different error, even with a DPoP-Nonce header")
    func ignoresOtherErrors() {
        let data = Data(#"{"error":"invalid_dpop_proof"}"#.utf8)
        let http = response(400, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }

    @Test("does not match use_dpop_nonce without a DPoP-Nonce header")
    func ignoresMissingHeader() {
        let data = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = response(400)
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }

    @Test("does not match on a 403 even with the right body and header")
    func ignoresWrongStatus() {
        let data = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
        let http = response(403, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }

    @Test("does not match a 200 success response")
    func ignoresSuccess() {
        let data = Data(#"{"access_token":"tok"}"#.utf8)
        let http = response(200, headers: ["DPoP-Nonce": "nonce-abc"])
        #expect(DPoPNonceChallenge.nonce(in: data, response: http) == nil)
    }
}
