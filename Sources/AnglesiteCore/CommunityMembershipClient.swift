import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum CommunityMembershipError: Error, Equatable, Sendable {
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Joins/leaves a fediverse `Group` (V-5.1a, #368) by POSTing `Follow`/`Undo(Follow)` to this
/// site's own outbox — the same owner-gated endpoint and `publishToken` bearer
/// `ActivityPubOutboxBackfill` already uses (`@dwk/activitypub`'s "Owner-published Follow /
/// Undo(Follow) now record the relationship and deliver to the target actor" behavior, phase 2).
/// This site's Worker is the trusted party here (it holds the signing key and does the actual
/// federated delivery), so — unlike `CommunityActorResolver` — there is no HTTPS/size-cap guard
/// on this client itself; the target IRI it's given already passed through that resolver.
public struct CommunityMembershipClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let outboxURL: URL
    private let ownActorURL: URL
    private let publishToken: String
    private let transport: Transport

    public init(
        ownActorURL: URL, publishToken: String,
        transport: @escaping Transport = CommunityMembershipClient.defaultTransport
    ) {
        self.ownActorURL = ownActorURL
        self.outboxURL = ownActorURL.appendingPathComponent("outbox")
        self.publishToken = publishToken
        self.transport = transport
    }

    /// Returns the activity id the outbox reports back — persist it (`CommunitiesLedger`) so
    /// `unfollow` can reference the exact original `Follow` in its `Undo`.
    @discardableResult
    public func follow(target: URL) async throws -> String {
        let body: [String: Any] = [
            "@context": "https://www.w3.org/ns/activitystreams",
            "type": "Follow",
            "actor": ownActorURL.absoluteString,
            "object": target.absoluteString,
        ]
        let data = try await post(body)
        return Self.activityID(from: data) ?? target.absoluteString
    }

    /// `followActivityID` is the id `follow(target:)` returned, if this membership was joined
    /// through this client (the common case). When it's `nil` — e.g. membership predates this
    /// feature — a synthetic nested `Follow` object stands in, a shape most AP implementations
    /// accept for `Undo` since the concrete activity id was never recorded client-side.
    public func unfollow(target: URL, followActivityID: String?) async throws {
        let followObject: Any = followActivityID ?? [
            "type": "Follow",
            "actor": ownActorURL.absoluteString,
            "object": target.absoluteString,
        ]
        let body: [String: Any] = [
            "@context": "https://www.w3.org/ns/activitystreams",
            "type": "Undo",
            "actor": ownActorURL.absoluteString,
            "object": followObject,
        ]
        _ = try await post(body)
    }

    private func post(_ activity: [String: Any]) async throws -> Data {
        var request = URLRequest(url: outboxURL)
        request.httpMethod = "POST"
        request.setValue("application/activity+json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(publishToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: activity)

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw CommunityMembershipError.requestFailed(status: 0, body: "\(error)")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw CommunityMembershipError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        return data
    }

    static func activityID(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["id"] as? String
    }

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
