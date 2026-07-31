import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cloudflare Workers KV client for the #587 runtime-inbox-capture staging store. The per-site
/// Worker (`Resources/Template/worker/worker.ts`) stages visitor submissions under `inbox:<id>`
/// keys in the `INBOX_KV` namespace; this is the app-side counterpart that lists, reads, and
/// clears those staged entries once they've been committed into the site's git working copy
/// (`InboxSubmissionSync`). Follows the same injectable-transport DI pattern as
/// `HTTPCloudflareClient`/`CloudflareCapabilityProber` — no Keychain coupling, token passed in
/// at init.
public struct InboxKVClient: Sendable {
    /// A visitor submission as staged by the Worker (`worker.ts`'s `handleInbox`) — field names
    /// and shape must match exactly, since the Worker is the writer and this is the reader.
    public struct Submission: Sendable, Equatable, Decodable {
        /// Worker-assigned unique id — also the KV key suffix (`inbox:<id>`), which is what
        /// ``InboxKVClient/deleteSubmission(id:)`` reconstructs to clear the entry.
        public let id: String
        /// Visitor-supplied subject line, exactly as staged.
        public let subject: String
        /// Visitor-supplied sender identity (typically an email address). Untrusted input —
        /// treat as display text, not a validated address.
        public let from: String
        /// Visitor-supplied message body, exactly as staged.
        public let message: String
        /// Timestamp string as the Worker wrote it. Kept as a string deliberately: it
        /// round-trips into content front matter rather than being computed on, and parsing it
        /// here would only add a failure mode.
        public let receivedAt: String

        /// Memberwise initializer, mainly for tests and previews — production values are
        /// decoded straight from KV entries the Worker wrote.
        public init(id: String, subject: String, from: String, message: String, receivedAt: String) {
            self.id = id
            self.subject = subject
            self.from = from
            self.message = message
            self.receivedAt = receivedAt
        }
    }

    private struct KeyListEnvelope: Decodable {
        struct Key: Decodable { let name: String }
        /// Cloudflare's "List a Namespace's Keys" pagination info: `cursor` is empty once there
        /// are no more pages. Optional so a response without `result_info` (e.g. in tests, or if
        /// Cloudflare ever omits it) still decodes.
        struct ResultInfo: Decodable { let cursor: String? }
        let success: Bool
        let result: [Key]?
        let resultInfo: ResultInfo?

        enum CodingKeys: String, CodingKey {
            case success, result
            case resultInfo = "result_info"
        }
    }

    private static let keyPrefix = "inbox:"

    private let baseURL: String
    private let accountID: String
    private let namespaceID: String
    private let apiToken: String
    private let transport: CloudflareTransport

    /// Creates a client bound to one KV namespace. The token is passed in rather than read from
    /// the Keychain here (same DI posture as `HTTPCloudflareClient` — resolution stays the
    /// caller's concern), and `baseURL`/`transport` exist so tests can point at a stub without
    /// any network; production callers take their defaults.
    public init(
        accountID: String,
        namespaceID: String,
        apiToken: String,
        baseURL: String = "https://api.cloudflare.com/client/v4",
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) {
        self.accountID = accountID
        self.namespaceID = namespaceID
        self.apiToken = apiToken
        self.baseURL = baseURL
        self.transport = transport
    }

    /// Lists every staged submission (`inbox:*` keys), fetching and decoding each value.
    /// Malformed entries (a key whose value fails to decode as `Submission`) are skipped rather
    /// than failing the whole pull — one bad/partial write shouldn't block every other
    /// submission.
    ///
    /// Cloudflare's "List a Namespace's Keys" endpoint paginates (max 1000 keys per call), so
    /// this follows `result_info.cursor` across pages until it comes back empty — or the page
    /// itself comes back empty, which also ends the loop so a misbehaving cursor can't spin
    /// forever.
    public func listStagedSubmissions() async throws -> [Submission] {
        var allKeys: [KeyListEnvelope.Key] = []
        var cursor: String?
        repeat {
            let page = try await fetchKeysPage(cursor: cursor)
            guard !page.result.isEmpty else { break }
            allKeys.append(contentsOf: page.result)
            cursor = page.cursor
        } while !(cursor ?? "").isEmpty

        var submissions: [Submission] = []
        for key in allKeys {
            guard let submission = try? await fetchSubmission(key: key.name) else { continue }
            submissions.append(submission)
        }
        return submissions
    }

    private func fetchKeysPage(cursor: String?) async throws -> (result: [KeyListEnvelope.Key], cursor: String?) {
        var keysURLString = "\(baseURL)/accounts/\(accountID)/storage/kv/namespaces/\(namespaceID)/keys"
            + "?prefix=\(Self.keyPrefix)"
        if let cursor, !cursor.isEmpty {
            keysURLString += "&cursor=\(cursor)"
        }
        guard let url = URL(string: keysURLString) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        guard let envelope = try? JSONDecoder().decode(KeyListEnvelope.self, from: data), envelope.success else {
            throw CloudflareError.malformedResponse
        }
        return (envelope.result ?? [], envelope.resultInfo?.cursor)
    }

    /// Deletes a staged submission by id — called only after it has been successfully committed
    /// into the site's git working copy, so a mid-pull failure leaves the entry staged for retry
    /// rather than losing it.
    public func deleteSubmission(id: String) async throws {
        let valueURLString = "\(baseURL)/accounts/\(accountID)/storage/kv/namespaces/\(namespaceID)/values/"
            + "\(Self.keyPrefix)\(id)"
        guard let url = URL(string: valueURLString) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        let (_, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
    }

    private func fetchSubmission(key: String) async throws -> Submission {
        let valueURLString = "\(baseURL)/accounts/\(accountID)/storage/kv/namespaces/\(namespaceID)/values/\(key)"
        guard let url = URL(string: valueURLString) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        let (data, http) = try await transport(request)
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        return try JSONDecoder().decode(Submission.self, from: data)
    }
}
