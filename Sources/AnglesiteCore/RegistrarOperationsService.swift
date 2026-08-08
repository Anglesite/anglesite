import Foundation

/// Errors surfaced by `RegistrarOperationsService`. Mirrors `DomainOperationError`'s shape
/// (minus `.zoneNotFound`, not meaningful for account-scoped Registrar calls).
public enum RegistrarOperationError: Error, Equatable, Sendable {
    /// No Cloudflare API token was available from the token provider — the operation never
    /// reached the network.
    case noToken
    /// Any Cloudflare API failure, wrapping the underlying ``CloudflareError``.
    case cloudflare(CloudflareError)
}

/// Domain search/check/register operations, centralizing token lookup so `BuyDomainModel`
/// doesn't do its own — mirrors `DomainOperationsService`'s role for DNS operations.
public protocol RegistrarOperationsService: Sendable {
    func searchDomains(query: String) async -> Result<[String], RegistrarOperationError>
    func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError>
    func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError>
}

/// The production ``RegistrarOperationsService``, backed by the Cloudflare HTTP client. Every
/// operation re-runs token lookup rather than caching it — mirrors `DomainOperations`'s reasoning.
public struct RegistrarOperations: RegistrarOperationsService {
    private let reader: any CloudflareRegistrarReading
    private let writer: any CloudflareRegistrarWriting
    private let tokenProvider: @Sendable () async -> String?

    public init(
        reader: any CloudflareRegistrarReading = HTTPCloudflareClient(),
        writer: any CloudflareRegistrarWriting = HTTPCloudflareClient(),
        tokenProvider: @escaping @Sendable () async -> String? = DomainOperations.defaultTokenProvider
    ) {
        self.reader = reader
        self.writer = writer
        self.tokenProvider = tokenProvider
    }

    public func searchDomains(query: String) async -> Result<[String], RegistrarOperationError> {
        guard let token = await tokenProvider() else { return .failure(.noToken) }
        do {
            return .success(try await reader.searchDomains(query: query, apiToken: token))
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }

    public func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError> {
        guard let token = await tokenProvider() else { return .failure(.noToken) }
        do {
            return .success(try await reader.checkDomainAvailability(domains: domains, apiToken: token))
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }

    public func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError> {
        guard let token = await tokenProvider() else { return .failure(.noToken) }
        do {
            return .success(try await writer.registerDomain(name: name, apiToken: token))
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }
}
