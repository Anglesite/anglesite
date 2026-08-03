import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
// OSLog is Darwin-only; AnglesiteCore is part of the Linux-portable target set (Package.swift,
// cross-platform port design §9/§10), so logging falls back to stderr off-Darwin — mirrors
// `WorkerCatalogFetcher.logDegradation`.
#if canImport(OSLog)
import OSLog
#endif

/// Registrar name and expiration date for one domain, from an RDAP lookup (`RDAPClient`, #1194).
public struct RDAPDomainInfo: Equatable, Sendable {
    /// The domain's registrar name, from the RDAP response's `registrar`-role entity's jCard `fn`
    /// property. `nil` if the response had no registrar entity.
    public let registrar: String?
    /// Raw RDAP `eventDate` string (ISO 8601) for the domain's expiration event, unparsed — every
    /// other value in `DomainConfig.Domain` is stored as a plain string too; callers format it
    /// for display.
    public let expiresAt: String?

    /// - Parameters:
    ///   - registrar: The domain's registrar name, or `nil` if unknown.
    ///   - expiresAt: The raw ISO 8601 expiration event date, or `nil` if unknown.
    public init(registrar: String?, expiresAt: String?) {
        self.registrar = registrar
        self.expiresAt = expiresAt
    }
}

/// Looks up a domain's registrar and expiration date. A protocol seam so `ConnectDomainModel`
/// tests can inject a fake instead of hitting the network — mirrors `DomainOperationsService`.
public protocol RDAPLookupService: Sendable {
    /// Looks up the registrar and expiration date for `hostname`.
    ///
    /// - Parameter hostname: The fully-qualified domain name to look up (e.g. `"example.com"`).
    /// - Returns: The domain's registrar/expiration info, or `nil` if the lookup failed or found
    ///   nothing usable — implementations are expected to degrade every failure mode to `nil`
    ///   rather than throwing (see ``RDAPClient/lookup(hostname:)`` for the production
    ///   implementation's full list of degradation cases).
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
    #if canImport(OSLog)
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "RDAPClient")
    #endif

    /// Degraded-path logging, portable off-Darwin (no OSLog on Linux — cross-platform port design
    /// §9/§10). Mirrors `WorkerCatalogFetcher.logDegradation` — every failure branch below logs
    /// enough context (which URL, what was malformed) to diagnose without logging response bodies
    /// (#1194 review: every RDAP failure was previously silent to both user and developer).
    private static func logDegradation(_ message: String) {
        #if canImport(OSLog)
        logger.error("\(message, privacy: .public)")
        #else
        FileHandle.standardError.write(Data("[RDAPClient] \(message)\n".utf8))
        #endif
    }

    /// How long a cached bootstrap registry is trusted before a fresh fetch is attempted again.
    /// IANA's `dns.json` changes rarely, so a day is generous — this avoids re-downloading it on
    /// every sheet open (#1194 review: the design doc's stated caching rationale wasn't actually
    /// achieved by the original always-fetch-first implementation).
    private static let bootstrapCacheTTL: TimeInterval = 24 * 60 * 60

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

    /// Looks up `hostname`'s registrar and expiration date via RDAP: resolves the RDAP server for
    /// its TLD from IANA's bootstrap registry (caching the registry for up to 24h), then queries
    /// that server directly for the domain.
    ///
    /// - Parameter hostname: The fully-qualified domain name to look up (e.g. `"example.com"`);
    ///   surrounding whitespace is trimmed and the value is lowercased before use.
    /// - Returns: The domain's registrar/expiration info, or `nil` on any failure (unknown TLD,
    ///   network error, malformed response, or no matching registrar/expiration data) — see this
    ///   type's doc comment for the full list of degradation cases, each of which logs via
    ///   `logDegradation(_:)` before returning `nil`.
    public func lookup(hostname: String) async -> RDAPDomainInfo? {
        let host = hostname.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let tld = host.split(separator: ".").last.map(String.init), !tld.isEmpty else {
            Self.logDegradation("hostname \"\(host)\" has no TLD to resolve an RDAP server for")
            return nil
        }
        guard let bootstrapData = await rdapServerData() else { return nil }
        guard let base = Self.rdapServer(forTLD: tld, bootstrapData: bootstrapData) else { return nil }
        return await fetchDomainInfo(base: base, hostname: host)
    }

    /// Returns the bootstrap registry, preferring a still-fresh cache over the network entirely
    /// (see `bootstrapCacheTTL`). Otherwise fetches over the network and caches it on success;
    /// falls back to a stale cache on any failure (network error or non-2xx). Returns `nil` only
    /// when there's neither a fresh fetch nor any usable cache.
    private func rdapServerData() async -> Data? {
        if let fresh = freshCachedBootstrapData() {
            return fresh
        }
        do {
            let (data, response) = try await session.data(from: bootstrapURL)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                Self.logDegradation("bootstrap registry fetch from \(bootstrapURL) returned a non-2xx response")
                return staleCachedBootstrapData()
            }
            do {
                try writeCache(data)
            } catch {
                Self.logDegradation("bootstrap registry cache write to \(cacheURL.path) failed: \(error)")
            }
            return data
        } catch {
            Self.logDegradation("bootstrap registry fetch from \(bootstrapURL) failed: \(error)")
            return staleCachedBootstrapData()
        }
    }

    /// The cached bootstrap registry if it exists and is younger than `bootstrapCacheTTL` —
    /// skips the network entirely. `nil` if there's no cache, the cache is stale, or the cache
    /// file can't be read despite fresh-looking attributes (falls through to a live fetch in that
    /// last case, same as a missing cache).
    private func freshCachedBootstrapData() -> Data? {
        guard let attributes = try? fileManager.attributesOfItem(atPath: cacheURL.path),
              let modified = attributes[.modificationDate] as? Date,
              Date().timeIntervalSince(modified) < Self.bootstrapCacheTTL
        else { return nil }
        return try? Data(contentsOf: cacheURL)
    }

    private func staleCachedBootstrapData() -> Data? {
        do {
            return try Data(contentsOf: cacheURL)
        } catch {
            Self.logDegradation("bootstrap registry cache read from \(cacheURL.path) failed: \(error)")
            return nil
        }
    }

    private func writeCache(_ data: Data) throws {
        try fileManager.createDirectory(
            at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: cacheURL, options: [.atomic])
    }

    /// Finds the RDAP base URL that serves `tld`, per the bootstrap registry's
    /// `services: [[tlds, urls], ...]` shape (RFC 9224) — parsed with `JSONValue` rather than a
    /// `Decodable` struct since each entry is itself a heterogeneous nested array. Prefers an
    /// `https` URL among the candidates for the matched TLD (RFC 9224 says https SHOULD be
    /// preferred), falling back to the first parseable URL otherwise — some TLDs list `http://`
    /// first, which App Transport Security blocks, previously causing a silent `nil`.
    private static func rdapServer(forTLD tld: String, bootstrapData: Data) -> URL? {
        guard let any = try? JSONSerialization.jsonObject(with: bootstrapData),
              case .object(let fields)? = JSONValue.from(any),
              case .array(let services)? = fields["services"]
        else {
            logDegradation("bootstrap registry data was not valid JSON or had no services array")
            return nil
        }
        for case .array(let entry) in services where entry.count >= 2 {
            guard case .array(let tlds) = entry[0], case .array(let urls) = entry[1] else { continue }
            guard tlds.contains(.string(tld)) else { continue }
            let candidates: [URL] = urls.compactMap {
                guard case .string(let urlString) = $0 else { return nil }
                return URL(string: urlString)
            }
            if let https = candidates.first(where: { $0.scheme == "https" }) {
                return https
            }
            if let first = candidates.first {
                return first
            }
            logDegradation("bootstrap registry entry for .\(tld) had no parseable RDAP server URL")
            return nil
        }
        logDegradation("bootstrap registry has no RDAP server entry for .\(tld)")
        return nil
    }

    private func fetchDomainInfo(base: URL, hostname: String) async -> RDAPDomainInfo? {
        let url = base.appendingPathComponent("domain").appendingPathComponent(hostname)
        let data: Data
        do {
            let (responseData, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                Self.logDegradation("domain lookup at \(url) returned a non-2xx response")
                return nil
            }
            data = responseData
        } catch {
            Self.logDegradation("domain lookup at \(url) failed: \(error)")
            return nil
        }
        guard let any = try? JSONSerialization.jsonObject(with: data),
              case .object(let fields)? = JSONValue.from(any)
        else {
            Self.logDegradation("domain lookup response from \(url) was not valid JSON")
            return nil
        }
        let registrar = Self.registrarName(fields: fields)
        let expiresAt = Self.expirationDate(fields: fields)
        guard registrar != nil || expiresAt != nil else {
            Self.logDegradation("domain lookup response from \(url) had no registrar or expiration event")
            return nil
        }
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
