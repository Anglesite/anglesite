import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Registrar name and expiration date for one domain, from an RDAP lookup (`RDAPClient`, #1194).
public struct RDAPDomainInfo: Equatable, Sendable {
    public let registrar: String?
    /// Raw RDAP `eventDate` string (ISO 8601) for the domain's expiration event, unparsed — every
    /// other value in `DomainConfig.Domain` is stored as a plain string too; callers format it
    /// for display.
    public let expiresAt: String?

    public init(registrar: String?, expiresAt: String?) {
        self.registrar = registrar
        self.expiresAt = expiresAt
    }
}

/// Looks up a domain's registrar and expiration date. A protocol seam so `ConnectDomainModel`
/// tests can inject a fake instead of hitting the network — mirrors `DomainOperationsService`.
public protocol RDAPLookupService: Sendable {
    func lookup(hostname: String) async -> RDAPDomainInfo?
}

/// Production `RDAPLookupService`: looks up a domain's registrar and expiration date via RDAP
/// (RFC 7480/9082/9083, the standardized WHOIS successor) — no API key needed (#1194). Resolves
/// the RDAP server for the hostname's TLD from IANA's bootstrap registry (RFC 9224), then queries
/// that server directly for the domain.
///
/// Every failure mode (unknown TLD, network error, non-2xx response, malformed JSON, no matching
/// `expiration` event or `registrar` entity) degrades to `nil` — this is advisory metadata for the
/// Connect Domain sheet (#1180), never a blocking requirement.
public actor RDAPClient: RDAPLookupService {
    private let bootstrapURL: URL
    private let cacheURL: URL
    private let session: URLSession
    private let fileManager: FileManager

    /// All parameters are injectable for tests; production callers take the defaults.
    public init(
        bootstrapURL: URL = RDAPClient.productionBootstrapURL,
        cacheURL: URL = RDAPClient.defaultCacheURL(),
        session: URLSession = .shared,
        fileManager: FileManager = .default
    ) {
        self.bootstrapURL = bootstrapURL
        self.cacheURL = cacheURL
        self.session = session
        self.fileManager = fileManager
    }

    /// IANA's RDAP bootstrap registry for the DNS (domain name) space (RFC 9224).
    public static let productionBootstrapURL = URL(string: "https://data.iana.org/rdap/dns.json")!

    /// `~/Library/Application Support/Anglesite/rdap-bootstrap-cache.json` — mirrors
    /// `WorkerCatalogFetcher.defaultCacheURL`'s convention.
    public static func defaultCacheURL(fileManager: FileManager = .default) -> URL {
        let support = (try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? fileManager.portableHomeDirectory
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        return support
            .appendingPathComponent("Anglesite", isDirectory: true)
            .appendingPathComponent("rdap-bootstrap-cache.json")
    }

    public func lookup(hostname: String) async -> RDAPDomainInfo? {
        let host = hostname.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let tld = host.split(separator: ".").last.map(String.init), !tld.isEmpty else { return nil }
        guard let bootstrapData = await rdapServerData() else { return nil }
        guard let base = Self.rdapServer(forTLD: tld, bootstrapData: bootstrapData) else { return nil }
        return await fetchDomainInfo(base: base, hostname: host)
    }

    /// Fetches the bootstrap registry and caches it on success; falls back to the cache on any
    /// failure (network error or non-2xx). Returns `nil` only when there's neither a fresh fetch
    /// nor a usable cache.
    private func rdapServerData() async -> Data? {
        if let (data, response) = try? await session.data(from: bootstrapURL),
           let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
            try? writeCache(data)
            return data
        }
        return try? Data(contentsOf: cacheURL)
    }

    private func writeCache(_ data: Data) throws {
        try fileManager.createDirectory(
            at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: cacheURL, options: [.atomic])
    }

    /// Finds the RDAP base URL that serves `tld`, per the bootstrap registry's
    /// `services: [[tlds, urls], ...]` shape (RFC 9224) — parsed with `JSONValue` rather than a
    /// `Decodable` struct since each entry is itself a heterogeneous nested array.
    private static func rdapServer(forTLD tld: String, bootstrapData: Data) -> URL? {
        guard let any = try? JSONSerialization.jsonObject(with: bootstrapData),
              case .object(let fields)? = JSONValue.from(any),
              case .array(let services)? = fields["services"]
        else { return nil }
        for case .array(let entry) in services where entry.count >= 2 {
            guard case .array(let tlds) = entry[0], case .array(let urls) = entry[1] else { continue }
            guard tlds.contains(.string(tld)) else { continue }
            for case .string(let urlString) in urls {
                if let url = URL(string: urlString) { return url }
            }
        }
        return nil
    }

    private func fetchDomainInfo(base: URL, hostname: String) async -> RDAPDomainInfo? {
        let url = base.appendingPathComponent("domain").appendingPathComponent(hostname)
        guard let (data, response) = try? await session.data(from: url),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let any = try? JSONSerialization.jsonObject(with: data),
              case .object(let fields)? = JSONValue.from(any)
        else { return nil }
        let registrar = Self.registrarName(fields: fields)
        let expiresAt = Self.expirationDate(fields: fields)
        guard registrar != nil || expiresAt != nil else { return nil }
        return RDAPDomainInfo(registrar: registrar, expiresAt: expiresAt)
    }

    /// The `expiration` event's `eventDate`, from the response's top-level `events` array
    /// (RFC 9083 §4.5).
    private static func expirationDate(fields: [String: JSONValue]) -> String? {
        guard case .array(let events)? = fields["events"] else { return nil }
        for case .object(let event) in events {
            if case .string("expiration")? = event["eventAction"],
               case .string(let date)? = event["eventDate"] {
                return date
            }
        }
        return nil
    }

    /// The `registrar`-role entity's formatted name, from its jCard `vcardArray` (RFC 9083 §5.1,
    /// RFC 7095).
    private static func registrarName(fields: [String: JSONValue]) -> String? {
        guard case .array(let entities)? = fields["entities"] else { return nil }
        for case .object(let entity) in entities {
            guard case .array(let roles)? = entity["roles"], roles.contains(.string("registrar")) else { continue }
            if let name = fn(fromVCard: entity["vcardArray"]) { return name }
        }
        return nil
    }

    /// Extracts the `fn` (formatted name) property from a jCard array:
    /// `["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar"]]]`.
    private static func fn(fromVCard vcard: JSONValue?) -> String? {
        guard case .array(let outer)? = vcard, outer.count >= 2, case .array(let properties) = outer[1] else { return nil }
        for case .array(let field) in properties where field.count >= 4 {
            if case .string("fn") = field[0], case .string(let value) = field[3] {
                return value
            }
        }
        return nil
    }
}
