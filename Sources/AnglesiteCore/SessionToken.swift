import Foundation

/// A per-session bearer secret minted by the app and validated in-container (auth-proxy + MCP
/// sidecar). Opaque; symmetric compare. The value is a secret — never log it (see `KeychainStore`).
public struct SessionToken: Sendable, Equatable, CustomStringConvertible {
    /// The raw secret, for symmetric compare and for handing to the container side. Never log
    /// or interpolate it — ``description`` is redacted for exactly that reason.
    public let value: String

    /// Wraps an existing secret (e.g. one read back from the environment on the container
    /// side); use ``mint()`` to create a fresh one.
    public init(value: String) { self.value = value }

    /// 32 cryptographically-random bytes, hex-encoded (64 chars).
    public static func mint() -> SessionToken {
        // SystemRandomNumberGenerator is cryptographically secure on every supported platform
        // (arc4random_buf on Darwin, getrandom(2) on Linux), so minting needs no CryptoKit /
        // swift-crypto dependency — this file is part of the portable core.
        var rng = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
        return SessionToken(value: bytes.map { String(format: "%02x", $0) }.joined())
    }

    /// Redacted — keeps the secret out of logs and crash dumps.
    public var description: String { "SessionToken(redacted)" }
}
