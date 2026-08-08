import Foundation

/// Errors surfaced by `DomainOperationsService`. `.cloudflare` wraps the underlying
/// `CloudflareError` for callers that want the detailed reason (e.g. to render the same
/// messages `HardenModel` shows for its own Cloudflare calls).
public enum DomainOperationError: Error, Equatable, Sendable {
    /// No Cloudflare API token was available from the token provider (neither the
    /// `CLOUDFLARE_API_TOKEN` env var nor the platform secret store) — the operation never
    /// reached the network.
    case noToken
    /// The token is valid but resolves no zone for `domain` — typically the domain isn't in
    /// the token's Cloudflare account, or the token's zone scope excludes it.
    case zoneNotFound(domain: String)
    /// Any Cloudflare API failure after zone resolution began, wrapping the underlying
    /// ``CloudflareError``. Non-`CloudflareError` throws are folded into
    /// ``CloudflareError/malformedResponse`` so this enum stays `Equatable`.
    case cloudflare(CloudflareError)
}

/// Domain/DNS operations for a site's Cloudflare-managed zone: list, add, and delete DNS
/// records. Centralizes token lookup and zone resolution so `DomainModel` (GUI) and the
/// `AnglesiteIntents` Domain intents (Siri) share one implementation, mirroring how
/// `IntegrationOperationsService` backs both `IntegrationWizardModel` and `IntegrationIntents`.
public protocol DomainOperationsService: Sendable {
    /// Lists the zone's DNS records. Returns a `Result` rather than throwing so GUI and
    /// intent callers can surface the same typed ``DomainOperationError`` without their own
    /// catch-and-classify step.
    func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError>

    /// `priority` is required by MX records (lower = higher priority mail server) and ignored
    /// by every other record type — `nil` for non-MX records.
    ///
    /// `purpose` is a namespaced tag (e.g. `"email:icloud-plus"`, `"verification:bluesky"` — see
    /// ``DomainRecordPurpose`` for the known vocabulary) mirrored into the live record's
    /// Cloudflare `comment` field as `"anglesite:<purpose>"` and, when `sourceDirectory` is
    /// non-nil, appended to `Source/anglesite.json`'s `dns.managedRecords` (#1170) — both nil for
    /// a generic owner-added record with no specific purpose.
    /// `sourceDirectory` is nil for callers with no local site context (Siri/Shortcuts intents),
    /// which skip the write-through entirely rather than failing.
    func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
        purpose: String?, sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError>

    /// Deletes one record by the Cloudflare record ID previously returned from
    /// ``listRecords(domain:)`` — there is no delete-by-name, so callers must list first.
    ///
    /// `type`/`name`/`content` (the record being deleted, as previously returned from
    /// ``listRecords(domain:)``) let the write-through remove the matching
    /// `dns.managedRecords` entry when `sourceDirectory` is non-nil; omit all four (or use the
    /// convenience overload below) to delete with no write-through.
    func deleteRecord(
        domain: String, recordID: String, type: String?, name: String?, content: String?,
        sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError>
}

extension DomainOperationsService {
    /// Convenience overload for callers with no purpose tag or local site context — equivalent
    /// to `purpose: nil, sourceDirectory: nil`. Not a protocol requirement, so it dispatches
    /// statically; existing callers (`DomainIntents`) that call this exact shape keep behaving
    /// identically to before #1170.
    public func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?
    ) async -> Result<Void, DomainOperationError> {
        await addRecord(domain: domain, type: type, name: name, content: content, ttl: ttl,
                        priority: priority, purpose: nil, sourceDirectory: nil)
    }

    /// Convenience overload mirroring `addRecord`'s — deletes with no write-through.
    public func deleteRecord(domain: String, recordID: String) async -> Result<Void, DomainOperationError> {
        await deleteRecord(domain: domain, recordID: recordID, type: nil, name: nil, content: nil, sourceDirectory: nil)
    }
}

/// The production ``DomainOperationsService``, backed by the Cloudflare HTTP client. Every
/// operation re-runs token lookup and zone resolution rather than caching either — the token
/// can be revoked or replaced between calls, and correctness beats saving one lookup request
/// at this call volume.
public struct DomainOperations: DomainOperationsService {
    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let tokenProvider: @Sendable () async -> String?

    /// All three dependencies are injectable seams for tests; the defaults (live HTTP client,
    /// ``defaultTokenProvider``) are what production callers should use.
    public init(
        reader: any CloudflareReading = HTTPCloudflareClient(),
        writer: any CloudflareWriting = HTTPCloudflareClient(),
        tokenProvider: @escaping @Sendable () async -> String? = DomainOperations.defaultTokenProvider
    ) {
        self.reader = reader
        self.writer = writer
        self.tokenProvider = tokenProvider
    }

    /// Env → OAuth (refresh-aware) → legacy-token, via the shared resolver (#1211).
    public static let defaultTokenProvider: @Sendable () async -> String? = {
        try? await CloudflareAPICredentials.resolve()
    }

    private func resolveZone(domain: String, token: String) async -> Result<String, DomainOperationError> {
        do {
            guard let zoneID = try await reader.resolveZoneID(domain: domain, apiToken: token) else {
                return .failure(.zoneNotFound(domain: domain))
            }
            return .success(zoneID)
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }

    /// See ``DomainOperationsService/listRecords(domain:)``.
    public func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> {
        guard let token = await tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                return .success(try await reader.listDNSRecords(zoneID: zoneID, apiToken: token))
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }

    /// See ``DomainOperationsService/addRecord(domain:type:name:content:ttl:priority:purpose:sourceDirectory:)``.
    public func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
        purpose: String?, sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        guard let token = await tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                let payload = DNSRecordPayload(
                    type: type, name: name, content: content, ttl: ttl, priority: priority,
                    comment: purpose.map { "anglesite:\($0)" })
                try await writer.addDNSRecord(zoneID: zoneID, record: payload, apiToken: token)
                if let sourceDirectory {
                    Self.writeThroughAdd(
                        type: type, name: name, content: content, priority: priority,
                        purpose: purpose, domain: domain, sourceDirectory: sourceDirectory)
                }
                return .success(())
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }

    /// See ``DomainOperationsService/deleteRecord(domain:recordID:type:name:content:sourceDirectory:)``.
    public func deleteRecord(
        domain: String, recordID: String, type: String?, name: String?, content: String?,
        sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        guard let token = await tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                try await writer.deleteDNSRecord(zoneID: zoneID, recordID: recordID, apiToken: token)
                if let sourceDirectory, let type, let name, let content {
                    Self.writeThroughRemove(
                        type: type, name: name, content: content, domain: domain,
                        sourceDirectory: sourceDirectory)
                }
                return .success(())
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }

    /// Normalizes a DNS record name to the zone-relative form `anglesite.json` declares (schema
    /// doc: `"name": "@"` for the apex, `"_atproto"` for a subdomain) — callers pass either form
    /// (`DomainModel`'s Bluesky/Google contexts and `EmailSetupPlanner`'s templates already use
    /// relative names; `CloudflareReading.DNSRecord.name`, the shape `DomainModel.runDelete` reads
    /// back from `listRecords`, is fully-qualified). Both `writeThroughAdd` and `writeThroughRemove`
    /// route through this so a record declared by one form can be found and removed via the other.
    private static func relativeName(_ name: String, domain: String) -> String {
        if name.caseInsensitiveCompare(domain) == .orderedSame { return "@" }
        let suffix = ".\(domain)"
        if name.count > suffix.count, name.lowercased().hasSuffix(suffix.lowercased()) {
            return String(name.dropLast(suffix.count))
        }
        return name
    }

    /// Best-effort: a write-through failure (disk full, permissions, a hand-corrupted file) must
    /// never turn an already-successful Cloudflare write into a reported failure — matches
    /// `CustomDomainAttachCommand`'s posture for the same reason.
    private static func writeThroughAdd(
        type: String, name: String, content: String, priority: Int?, purpose: String?, domain: String,
        sourceDirectory: URL
    ) {
        DomainConfigStore.update(sourceDirectory: sourceDirectory) { config in
            config = config.addingManagedDNSRecord(
                .init(type: type, name: relativeName(name, domain: domain), content: content,
                      priority: priority, purpose: purpose))
        }
    }

    private static func writeThroughRemove(
        type: String, name: String, content: String, domain: String, sourceDirectory: URL
    ) {
        DomainConfigStore.update(sourceDirectory: sourceDirectory) { config in
            config = config.removingManagedDNSRecord(
                type: type, name: relativeName(name, domain: domain), content: content)
        }
    }
}
