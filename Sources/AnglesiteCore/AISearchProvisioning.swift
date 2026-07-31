import Foundation

/// A provisioned Cloudflare AI Search instance.
public struct AISearchInstance: Sendable, Equatable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// Provisions Cloudflare AI Search instances. Kept separate from `CloudflareWriting` — that
/// protocol has five conformers across the test suite, and this is the only feature that needs
/// this call.
public protocol AISearchProvisioning: Sendable {
    /// Creates an AI Search instance backed by a website crawler for `domain`, resolving the
    /// caller's Cloudflare account internally (mirrors `attachWorkersCustomDomain`'s pattern).
    func createAISearchInstance(domain: String, instanceID: String, apiToken: String) async throws -> AISearchInstance
}
