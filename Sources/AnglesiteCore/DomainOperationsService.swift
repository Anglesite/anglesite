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
    func addRecord(domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?) async -> Result<Void, DomainOperationError>
    /// Deletes one record by the Cloudflare record ID previously returned from
    /// ``listRecords(domain:)`` — there is no delete-by-name, so callers must list first.
    func deleteRecord(domain: String, recordID: String) async -> Result<Void, DomainOperationError>
}

/// The production ``DomainOperationsService``, backed by the Cloudflare HTTP client. Every
/// operation re-runs token lookup and zone resolution rather than caching either — the token
/// can be revoked or replaced between calls, and correctness beats saving one lookup request
/// at this call volume.
public struct DomainOperations: DomainOperationsService {
    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let tokenProvider: @Sendable () -> String?

    /// All three dependencies are injectable seams for tests; the defaults (live HTTP client,
    /// ``defaultTokenProvider``) are what production callers should use.
    public init(
        reader: any CloudflareReading = HTTPCloudflareClient(),
        writer: any CloudflareWriting = HTTPCloudflareClient(),
        tokenProvider: @escaping @Sendable () -> String? = DomainOperations.defaultTokenProvider
    ) {
        self.reader = reader
        self.writer = writer
        self.tokenProvider = tokenProvider
    }

    /// Env var first (matches `HardenModel.apiToken()`), then the platform secret store
    /// (the user's Keychain on macOS).
    public static let defaultTokenProvider: @Sendable () -> String? = {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return env
        }
        return try? PlatformSecretStore.make().readCloudflareToken()
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
        guard let token = tokenProvider() else { return .failure(.noToken) }
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

    /// See ``DomainOperationsService/addRecord(domain:type:name:content:ttl:priority:)``.
    public func addRecord(domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?) async -> Result<Void, DomainOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                let payload = DNSRecordPayload(type: type, name: name, content: content, ttl: ttl, priority: priority)
                try await writer.addDNSRecord(zoneID: zoneID, record: payload, apiToken: token)
                return .success(())
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }

    /// See ``DomainOperationsService/deleteRecord(domain:recordID:)``.
    public func deleteRecord(domain: String, recordID: String) async -> Result<Void, DomainOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                try await writer.deleteDNSRecord(zoneID: zoneID, recordID: recordID, apiToken: token)
                return .success(())
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }
}
