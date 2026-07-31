import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One design system in the freedesignmd.com catalog, as listed by
/// ``FreedesignmdCatalog/parseSystemList(html:)``.
public struct FreedesignmdSystem: Sendable, Equatable, Identifiable {
    /// URL slug on freedesignmd.com (`/system/<slug>`) — the stable key for follow-up
    /// fetches and identity.
    public let slug: String
    /// Human-readable system name as the catalog lists it.
    public let name: String
    /// `Identifiable` conformance keyed on ``slug`` — the catalog's own stable identifier,
    /// so SwiftUI lists don't churn when names are re-rendered.
    public var id: String { slug }
    /// Creates a catalog entry from its slug and display name.
    public init(slug: String, name: String) { self.slug = slug; self.name = name }
}

/// A catalog entry paired with the description fetched from its detail page — the shape a
/// picker UI needs once the user focuses one system.
public struct FreedesignmdSystemDetail: Sendable, Equatable {
    /// The catalog entry this detail belongs to.
    public let system: FreedesignmdSystem
    /// The system page's meta description, per ``FreedesignmdCatalog/parseDescription(html:)``.
    public let description: String
    /// Pairs a catalog entry with its fetched description.
    public init(system: FreedesignmdSystem, description: String) { self.system = system; self.description = description }
}

/// Failures from the ``FreedesignmdCatalog`` fetch/parse pipeline. Split so callers can
/// distinguish a network/HTTP problem (retryable) from the site's markup no longer matching
/// the parser (a code-level breakage worth surfacing differently).
public enum FreedesignmdCatalogError: Error, Sendable, Equatable {
    /// The HTTP request failed or returned a non-2xx/undecodable response; the payload
    /// describes which URL misbehaved.
    case fetchFailed(String)
    /// The page fetched fine but yielded zero systems — freedesignmd.com's server-rendered
    /// JSON-LD markup has likely changed shape and the parsing regex needs updating.
    case parseFailed
}

/// Browses the freedesignmd.com catalog deterministically. The catalog page has no JSON API, but
/// server-renders a JSON-LD `ItemList` with every system's slug/name — this parses that block
/// directly rather than doing LLM-mediated page extraction (unlike the plugin's WebFetch-based
/// `freedesignmd` skill), using a tolerant regex over the server-rendered markup.
public enum FreedesignmdCatalog {
    static let systemsURL = URL(string: "https://freedesignmd.com/systems")!
    static func systemURL(slug: String) -> URL { URL(string: "https://freedesignmd.com/system/\(slug)")! }

    private static let listItemPattern = #""url":"https://freedesignmd\.com/system/([a-z0-9-]+)","name":"([^"]+)""#
    private static let descriptionPattern = #"name="description" content="([^"]*)""#

    /// Extracts the systems from a `/systems` page's server-rendered JSON-LD `ItemList`.
    /// A tolerant regex rather than a JSON decode: the JSON-LD block is embedded in HTML and
    /// its surrounding structure shifts between deploys, while the `url`/`name` pair shape
    /// has stayed stable. Returns `[]` rather than throwing — the fetch wrapper decides
    /// whether empty means ``FreedesignmdCatalogError/parseFailed``.
    public static func parseSystemList(html: String) -> [FreedesignmdSystem] {
        guard let re = try? NSRegularExpression(pattern: listItemPattern) else { return [] }
        let ns = html as NSString
        return re.matches(in: html, range: NSRange(location: 0, length: ns.length)).map {
            FreedesignmdSystem(slug: ns.substring(with: $0.range(at: 1)), name: ns.substring(with: $0.range(at: 2)))
        }
    }

    /// Extracts a system page's `<meta name="description">` content, or `nil` when absent.
    /// The meta description is the one piece of prose the site server-renders per system,
    /// which is why it stands in for a richer detail payload here.
    public static func parseDescription(html: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: descriptionPattern) else { return nil }
        let ns = html as NSString
        guard let match = re.firstMatch(in: html, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return ns.substring(with: match.range(at: 1))
    }

    /// Fetches and parses the `/systems` catalog page's JSON-LD `ItemList`.
    ///
    /// - Important: As of 2026-07-10, the server-rendered `/systems` page's JSON-LD
    ///   `itemListElement` only includes the first ~50 of the catalog's ~108 entries (per the
    ///   JSON-LD's own `numberOfItems`); the remainder load via client-side pagination not
    ///   present in this parse. This is a known constraint of the deterministic (non-LLM)
    ///   parsing approach — callers should not assume completeness.
    public static func fetchSystemList(session: URLSession = .shared) async throws -> [FreedesignmdSystem] {
        let (data, response) = try await session.data(from: systemsURL)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode,
              let html = String(data: data, encoding: .utf8)
        else { throw FreedesignmdCatalogError.fetchFailed("bad response from \(systemsURL)") }
        let systems = parseSystemList(html: html)
        guard !systems.isEmpty else { throw FreedesignmdCatalogError.parseFailed }
        return systems
    }

    /// Fetches a system's detail page and returns its meta description. Unlike
    /// ``fetchSystemList(session:)``, a missing description is `nil`, not an error — a
    /// system without one is a valid catalog entry, whereas an empty system list means the
    /// markup broke.
    ///
    /// - Throws: ``FreedesignmdCatalogError/fetchFailed(_:)`` on a network/HTTP failure.
    public static func fetchDescription(slug: String, session: URLSession = .shared) async throws -> String? {
        let (data, response) = try await session.data(from: systemURL(slug: slug))
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode,
              let html = String(data: data, encoding: .utf8)
        else { throw FreedesignmdCatalogError.fetchFailed("bad response for \(slug)") }
        return parseDescription(html: html)
    }

    /// Deterministic pre-filter: scores each system by how many whitespace-separated keywords from
    /// `businessType` appear as a substring of its name (case-insensitive), descending. Ties keep
    /// original catalog order (Swift's `sorted` is stable). Falls back to the original order when
    /// `businessType` is empty or nothing matches.
    public static func rank(_ systems: [FreedesignmdSystem], byKeywordsIn businessType: String) -> [FreedesignmdSystem] {
        let keywords = businessType.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        guard !keywords.isEmpty else { return systems }
        func score(_ system: FreedesignmdSystem) -> Int {
            let name = system.name.lowercased()
            return keywords.reduce(0) { $0 + (name.contains($1) ? 1 : 0) }
        }
        return systems.enumerated()
            .sorted { a, b in
                let (sa, sb) = (score(a.element), score(b.element))
                return sa == sb ? a.offset < b.offset : sa > sb
            }
            .map(\.element)
    }
}
