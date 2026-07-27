import Foundation
#if canImport(Security)
import Security
#endif

/// Generates and persists the per-site secret material `@dwk/activitypub` needs: an RSA signing
/// keypair (PKCS#8 private / SPKI public PEM — the WebCrypto-importable formats the package
/// requires) and a random publish-fan-out token. Generated exactly once per site, lazily, the
/// first time a caller asks — never regenerated, since rotating the signing key breaks
/// federation trust with existing followers (#363 design doc, "Keypair generation & storage").
public enum ActivityPubKeyProvisioning {
    public struct Secrets: Sendable, Equatable {
        public let privateKeyPem: String
        public let publicKeyPem: String
        public let publishToken: String
    }

    public enum Error: Swift.Error {
        case keyGenerationFailed(String)
        case exportFailed(String)
        case unsupportedPlatform
    }

    /// Returns this site's ActivityPub secrets, generating and persisting them into `secretStore`
    /// on first call. Every subsequent call for the same `siteID` returns the same values.
    ///
    /// **Concurrency note:** This function is not safe to call concurrently for the same `siteID`.
    /// A race between two concurrent calls' read-then-write pairs could cause two independent keypairs
    /// to be generated, with the last write silently overwriting the first — violating the "never
    /// regenerate" invariant. Its current sole caller (`SocialWorkerProvisionCommand.provision()`)
    /// invokes this from a single user-initiated deploy action per site, never concurrently. Future
    /// callers must not violate this serial-access guarantee.
    public static func secrets(siteID: String, secretStore: any SecretStore) throws -> Secrets {
        let privateKeyAccount = SecretAccounts.activityPubPrivateKeyPem(siteID: siteID)
        let publishTokenAccount = SecretAccounts.activityPubPublishToken(siteID: siteID)

        let privateKeyPem: String
        if let existing = try secretStore.read(account: privateKeyAccount) {
            privateKeyPem = existing
        } else {
            privateKeyPem = try generatePrivateKeyPem()
            try secretStore.write(privateKeyPem, account: privateKeyAccount)
        }

        let publishToken: String
        if let existing = try secretStore.read(account: publishTokenAccount) {
            publishToken = existing
        } else {
            publishToken = try generatePublishToken()
            try secretStore.write(publishToken, account: publishTokenAccount)
        }

        let publicKeyPem = try derivePublicKeyPem(fromPrivateKeyPem: privateKeyPem)
        return Secrets(privateKeyPem: privateKeyPem, publicKeyPem: publicKeyPem, publishToken: publishToken)
    }

    static func generatePublishToken() throws -> String {
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

    // Declared unconditionally (unlike the ASN.1 helpers below, which are pure data
    // transformations with no platform dependency) so `secrets(siteID:secretStore:)` — itself
    // unconditional — always has something to call. On platforms without Security framework,
    // the body throws `.unsupportedPlatform` rather than the type failing to compile at all;
    // mirrors `generatePublishToken`'s existing platform split.
    static func generatePrivateKeyPem() throws -> String {
        #if canImport(Security)
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048,
        ]
        var cfError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &cfError) else {
            let message = (cfError?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
            throw Error.keyGenerationFailed(message)
        }
        let pkcs1DER = try externalRepresentation(of: privateKey)
        let pkcs8DER = wrapRSAPrivateKeyAsPKCS8(pkcs1DER)
        return pem(der: pkcs8DER, label: "PRIVATE KEY")
        #else
        throw Error.unsupportedPlatform
        #endif
    }

    static func derivePublicKeyPem(fromPrivateKeyPem privateKeyPem: String) throws -> String {
        #if canImport(Security)
        let pkcs8DER = try derData(fromPEM: privateKeyPem)
        let pkcs1DER = try unwrapPKCS8ToRSAPrivateKey(pkcs8DER)
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
        var cfError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateWithData(pkcs1DER as CFData, attributes as CFDictionary, &cfError) else {
            let message = (cfError?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
            throw Error.exportFailed(message)
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw Error.exportFailed("SecKeyCopyPublicKey returned nil")
        }
        let publicPKCS1DER = try externalRepresentation(of: publicKey)
        let spkiDER = wrapRSAPublicKeyAsSPKI(publicPKCS1DER)
        return pem(der: spkiDER, label: "PUBLIC KEY")
        #else
        throw Error.unsupportedPlatform
        #endif
    }

    #if canImport(Security)
    private static func externalRepresentation(of key: SecKey) throws -> Data {
        var cfError: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(key, &cfError) as Data? else {
            let message = (cfError?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
            throw Error.exportFailed(message)
        }
        return data
    }
    #endif

    // MARK: - ASN.1 wrapping (RSA PKCS#1 <-> PKCS#8/SPKI)
    //
    // Security framework exports/imports RSA keys as raw PKCS#1 DER. WebCrypto (and therefore
    // @dwk/activitypub, which imports keys via crypto.subtle.importKey) requires PKCS#8
    // (private) and SPKI (public) instead. For RSA, both are the PKCS#1 DER wrapped in a fixed
    // ASN.1 envelope naming the rsaEncryption algorithm (OID 1.2.840.113549.1.1.1) — the envelope
    // bytes are constant regardless of key size, only the embedded PKCS#1 body's length varies,
    // so this is a deterministic prefix/suffix wrap, not a real ASN.1 encoder.

    /// PKCS#8 `PrivateKeyInfo` wrapper: `SEQUENCE { version INTEGER 0, algorithm AlgorithmIdentifier, privateKey OCTET STRING }`.
    static func wrapRSAPrivateKeyAsPKCS8(_ pkcs1DER: Data) -> Data {
        let algorithmIdentifier: [UInt8] = [
            0x30, 0x0D, // SEQUENCE (13 bytes)
            0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, // OID rsaEncryption
            0x05, 0x00, // NULL
        ]
        let version: [UInt8] = [0x02, 0x01, 0x00] // INTEGER 0
        let octetStringHeader = derLength(tag: 0x04, contentLength: pkcs1DER.count)
        let body = version + algorithmIdentifier + octetStringHeader + [UInt8](pkcs1DER)
        let sequenceHeader = derLength(tag: 0x30, contentLength: body.count)
        return Data(sequenceHeader + body)
    }

    /// Inverse of `wrapRSAPrivateKeyAsPKCS8` — strips the PKCS#8 envelope back to bare PKCS#1 DER
    /// so Security framework's `SecKeyCreateWithData` (which expects PKCS#1 for RSA) can import
    /// it. Only needs to handle DER this module itself produced (2048-bit RSA, short-form or
    /// single-byte long-form lengths), not arbitrary third-party PKCS#8.
    static func unwrapPKCS8ToRSAPrivateKey(_ pkcs8DER: Data) throws -> Data {
        var scanner = DERScanner(pkcs8DER)
        try scanner.expectSequence()
        try scanner.expectInteger(value: 0)
        try scanner.skipSequence() // AlgorithmIdentifier
        return try scanner.readOctetStringContents()
    }

    /// SPKI `SubjectPublicKeyInfo` wrapper: `SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }`.
    static func wrapRSAPublicKeyAsSPKI(_ pkcs1DER: Data) -> Data {
        let algorithmIdentifier: [UInt8] = [
            0x30, 0x0D,
            0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01,
            0x05, 0x00,
        ]
        // BIT STRING: a leading 0x00 "no unused bits" byte, then the DER contents.
        let bitStringContentLength = pkcs1DER.count + 1
        let bitStringHeader = derLength(tag: 0x03, contentLength: bitStringContentLength)
        let body = algorithmIdentifier + bitStringHeader + [0x00] + [UInt8](pkcs1DER)
        let sequenceHeader = derLength(tag: 0x30, contentLength: body.count)
        return Data(sequenceHeader + body)
    }

    /// Encodes a DER tag + length header for `contentLength` bytes of content (short-form for
    /// <128 bytes, single-byte long-form length for 128..<256 — sufficient for every length this
    /// module ever wraps: RSA-2048 PKCS#1 bodies are a few hundred bytes).
    private static func derLength(tag: UInt8, contentLength: Int) -> [UInt8] {
        if contentLength < 0x80 {
            return [tag, UInt8(contentLength)]
        }
        var length = contentLength
        var lengthBytes: [UInt8] = []
        while length > 0 {
            lengthBytes.insert(UInt8(length & 0xFF), at: 0)
            length >>= 8
        }
        return [tag, 0x80 | UInt8(lengthBytes.count)] + lengthBytes
    }

    private static func derData(fromPEM pem: String) throws -> Data {
        let lines = pem.split(separator: "\n").filter { !$0.hasPrefix("-----") }
        guard let data = Data(base64Encoded: lines.joined()) else {
            throw Error.exportFailed("malformed PEM: not valid base64")
        }
        return data
    }

    private static func pem(der: Data, label: String) -> String {
        let base64 = der.base64EncodedString()
        var lines: [String] = []
        var index = base64.startIndex
        while index < base64.endIndex {
            let end = base64.index(index, offsetBy: 64, limitedBy: base64.endIndex) ?? base64.endIndex
            lines.append(String(base64[index..<end]))
            index = end
        }
        return "-----BEGIN \(label)-----\n\(lines.joined(separator: "\n"))\n-----END \(label)-----\n"
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Minimal DER reader — just enough to unwrap the fixed PKCS#8 shape `wrapRSAPrivateKeyAsPKCS8`
/// itself produces (sequence, integer, nested sequence to skip, octet string). Not a general ASN.1
/// parser.
private struct DERScanner {
    private let data: Data
    private var offset: Int

    init(_ data: Data) {
        self.data = data
        self.offset = data.startIndex
    }

    private mutating func readTagAndLength(expectedTag: UInt8) throws -> Int {
        guard offset < data.endIndex, data[offset] == expectedTag else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: expected tag 0x\(String(expectedTag, radix: 16))")
        }
        offset += 1
        guard offset < data.endIndex else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: truncated length")
        }
        let first = data[offset]
        offset += 1
        if first & 0x80 == 0 {
            return Int(first)
        }
        let byteCount = Int(first & 0x7F)
        guard byteCount > 0, offset + byteCount <= data.endIndex else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: truncated long-form length")
        }
        var length = 0
        for _ in 0..<byteCount {
            length = (length << 8) | Int(data[offset])
            offset += 1
        }
        return length
    }

    mutating func expectSequence() throws {
        _ = try readTagAndLength(expectedTag: 0x30)
    }

    mutating func expectInteger(value: Int) throws {
        let length = try readTagAndLength(expectedTag: 0x02)
        guard length == 1, offset < data.endIndex, Int(data[offset]) == value else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: unexpected INTEGER value")
        }
        offset += length
    }

    mutating func skipSequence() throws {
        let length = try readTagAndLength(expectedTag: 0x30)
        offset += length
    }

    mutating func readOctetStringContents() throws -> Data {
        let length = try readTagAndLength(expectedTag: 0x04)
        guard offset + length <= data.endIndex else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: truncated OCTET STRING")
        }
        let contents = data[offset..<(offset + length)]
        offset += length
        return Data(contents)
    }
}
