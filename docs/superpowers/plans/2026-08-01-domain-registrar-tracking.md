# Domain Registrar/Expiration Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Look up a connected domain's registrar and expiration date via RDAP, persist it into `Source/anglesite.json`, and surface it in the Connect Domain sheet.

**Architecture:** A new `RDAPClient` actor in `AnglesiteCore` resolves the right RDAP server per TLD from IANA's bootstrap registry, queries it for a domain's registrar/expiration, and degrades to `nil` on any failure. `ConnectDomainModel` (`AnglesiteApp`, #1180) is extended to detect an already-declared domain on `openSheet()`, run the lookup in the background, show cached results instantly, and persist fresh ones back into `anglesite.json` via the existing `DomainConfigStore`.

**Tech Stack:** Swift 6.4, Swift Testing (`@Test`/`@Suite`), `URLSession` + a stub `URLProtocol` for network tests, SwiftUI.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-01-domain-registrar-tracking-design.md` — read it first if anything below is ambiguous.
- Conventional commits, subject line ≤72 characters, reference `#1194`.
- No new third-party dependencies — `RDAPClient` uses only `Foundation`/`URLSession` and the existing `JSONValue` type (`Sources/AnglesiteCore/MCPClient.swift`).
- Every new/changed public type in `AnglesiteCore`/`AnglesiteApp` needs a doc comment per `docs/comment-style-guide.md` (state the non-obvious *why*, not the *what*).
- `RDAPClient.lookup(hostname:)` must never throw and must degrade to `nil` on any failure (network error, non-2xx, malformed JSON, unknown TLD, no useful data) — this is advisory metadata, never blocking.
- Don't touch `CustomDomainAttachCommand`'s attach logic, `DeployCommand`'s pipeline, or `.notConnected`/`conflict` handling in `DeployDrawerView` — out of scope per the design doc's non-goals.

---

### Task 1: Extend `DomainConfig.Domain` with `registrar`/`expiresAt`

**Files:**
- Modify: `Sources/AnglesiteCore/DomainConfig.swift:43-56`
- Test: `Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift:24-41` (`saveLoadRoundTrips`)

**Interfaces:**
- Produces: `DomainConfig.Domain.registrar: String?`, `DomainConfig.Domain.expiresAt: String?`, and the corresponding `init` parameters (both default `nil`) — every later task constructs/reads `Domain` through these.

- [ ] **Step 1: Write the failing test**

Edit `Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift`, in `saveLoadRoundTrips()`, change the `domain:` line from:

```swift
            domain: .init(hostname: "example.com", choice: "transfer", attach: true),
```

to:

```swift
            domain: .init(
                hostname: "example.com", choice: "transfer", attach: true,
                registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z"),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter DomainConfigStoreTests 2>&1 | tail -40`
Expected: FAIL to build — `extra argument 'registrar' in call` (the `Domain.init` doesn't accept it yet).

- [ ] **Step 3: Implement the schema change**

In `Sources/AnglesiteCore/DomainConfig.swift`, replace the `Domain` struct (lines 43-56):

```swift
    public struct Domain: Codable, Equatable, Sendable {
        public var hostname: String?
        /// `"buy" | "transfer" | "later"` — kept as an open string (not a closed `enum`) so an
        /// unrecognized value from a future app version or a hand edit degrades gracefully for
        /// the reader instead of failing the whole document to decode.
        public var choice: String?
        public var attach: Bool?
        /// The domain's registrar name, from an RDAP lookup (`RDAPClient`, #1194). `nil` until a
        /// lookup has succeeded at least once.
        public var registrar: String?
        /// The domain's expiration date, as the raw ISO 8601 `eventDate` string RDAP returned —
        /// unparsed, like every other value in this struct; callers format it for display.
        public var expiresAt: String?

        public init(
            hostname: String? = nil, choice: String? = nil, attach: Bool? = nil,
            registrar: String? = nil, expiresAt: String? = nil
        ) {
            self.hostname = hostname
            self.choice = choice
            self.attach = attach
            self.registrar = registrar
            self.expiresAt = expiresAt
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter DomainConfigStoreTests 2>&1 | tail -40`
Expected: PASS — all `DomainConfigStoreTests` tests green, including the updated round-trip.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DomainConfig.swift Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift
git commit -m "feat(#1194): add registrar/expiresAt to DomainConfig.Domain"
```

---

### Task 2: RDAP lookup client (`AnglesiteCore`)

**Files:**
- Create: `Sources/AnglesiteCore/RDAPClient.swift`
- Test: `Tests/AnglesiteCoreTests/RDAPClientTests.swift`

**Interfaces:**
- Consumes: `JSONValue` (`Sources/AnglesiteCore/MCPClient.swift`) — cases `.object([String: JSONValue])`, `.array([JSONValue])`, `.string(String)`, and `static func from(_ value: Any) -> JSONValue?`.
- Produces: `public struct RDAPDomainInfo: Equatable, Sendable { let registrar: String?; let expiresAt: String? }` (public memberwise `init(registrar:expiresAt:)`), `public protocol RDAPLookupService: Sendable { func lookup(hostname: String) async -> RDAPDomainInfo? }`, `public actor RDAPClient: RDAPLookupService` with `init(bootstrapURL: URL = RDAPClient.productionBootstrapURL, cacheURL: URL = RDAPClient.defaultCacheURL(), session: URLSession = .shared, fileManager: FileManager = .default)`, `static let productionBootstrapURL: URL`, `static func defaultCacheURL(fileManager: FileManager = .default) -> URL`. Task 3 (`ConnectDomainModel`) consumes all of these.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/RDAPClientTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

/// Routes each request to a canned status/body keyed by exact URL string, so `RDAPClient`'s
/// two-hop fetch (bootstrap registry, then the domain-specific RDAP server) can be exercised
/// without a real network call. Unlike `WorkerCatalogStubURLProtocol` (which returns one fixed
/// response for every request), `RDAPClient` makes two *different* requests per lookup, so the
/// stub needs to distinguish them.
private final class RDAPStubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Stub { let statusCode: Int; let body: String }
    nonisolated(unsafe) static var responses: [String: Stub] = [:]
    nonisolated(unsafe) static var failingURLs: Set<String> = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let key = request.url?.absoluteString ?? ""
        if Self.failingURLs.contains(key) {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        guard let stub = Self.responses[key] else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: stub.statusCode, httpVersion: "HTTP/1.1", headerFields: nil
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        responses = [:]
        failingURLs = []
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RDAPStubURLProtocol.self]
        return URLSession(configuration: config)
    }
}

// .serialized: tests share RDAPStubURLProtocol's mutable static response table, which would race
// under Swift Testing's default parallel execution.
@Suite(.serialized) struct RDAPClientTests {
    private let bootstrapURL = URL(string: "https://example.invalid/rdap/dns.json")!
    private let domainURL = "https://example.invalid/rdap-com/domain/example.com"

    private let bootstrapJSON = """
    {"services":[[["com","net"],["https://example.invalid/rdap-com/"]],[["org"],["https://example.invalid/rdap-org/"]]]}
    """
    private let domainJSON = """
    {
      "events":[
        {"eventAction":"registration","eventDate":"1995-08-14T04:00:00Z"},
        {"eventAction":"expiration","eventDate":"2027-08-13T04:00:00Z"}
      ],
      "entities":[
        {"roles":["registrar"],"vcardArray":["vcard",[["version",{},"text","4.0"],["fn",{},"text","Example Registrar, LLC"]]]}
      ]
    }
    """

    private func tempCacheURL() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("rdap-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("rdap-bootstrap-cache.json")
    }

    @Test("looks up registrar and expiration for a known TLD")
    func looksUpRegistrarAndExpiration() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "Example.com")

        #expect(info?.registrar == "Example Registrar, LLC")
        #expect(info?.expiresAt == "2027-08-13T04:00:00Z")
    }

    @Test("returns nil for a TLD absent from the bootstrap registry")
    func returnsNilForUnknownTLD() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.zzz")

        #expect(info == nil)
    }

    @Test("returns nil when the domain lookup responds with a non-2xx status")
    func returnsNilOnBadDomainStatus() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 404, body: "not found")
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info == nil)
    }

    @Test("falls back to the cached bootstrap registry when the live fetch fails")
    func fallsBackToCachedBootstrapOnFetchFailure() async throws {
        RDAPStubURLProtocol.reset()
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(bootstrapJSON.utf8).write(to: cacheURL)

        RDAPStubURLProtocol.failingURLs = [bootstrapURL.absoluteString]
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info?.registrar == "Example Registrar, LLC")
    }

    @Test("returns nil when the bootstrap fetch fails and there is no cache")
    func returnsNilWhenNoCacheAndFetchFails() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.failingURLs = [bootstrapURL.absoluteString]
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info == nil)
    }

    @Test("caches the bootstrap registry to disk on a successful fetch")
    func cachesBootstrapOnSuccess() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        _ = await client.lookup(hostname: "example.com")

        #expect(FileManager.default.fileExists(atPath: cacheURL.path))
    }

    @Test("returns nil when the domain response has neither a registrar nor an expiration date")
    func returnsNilWhenNoUsefulData() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: "{}")
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info == nil)
    }

    @Test("productionBootstrapURL points at IANA's RDAP bootstrap registry")
    func productionBootstrapURLIsIANA() {
        #expect(RDAPClient.productionBootstrapURL == URL(string: "https://data.iana.org/rdap/dns.json")!)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter RDAPClientTests 2>&1 | tail -40`
Expected: FAIL to build — `cannot find type 'RDAPClient' in scope` (nothing implemented yet).

- [ ] **Step 3: Implement `RDAPClient`**

Create `Sources/AnglesiteCore/RDAPClient.swift`:

```swift
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter RDAPClientTests 2>&1 | tail -60`
Expected: PASS — all 8 `RDAPClientTests` tests green.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/RDAPClient.swift Tests/AnglesiteCoreTests/RDAPClientTests.swift
git commit -m "feat(#1194): add RDAPClient for registrar/expiration lookup"
```

---

### Task 3: Wire registrar lookup into `ConnectDomainModel`

**Files:**
- Modify: `Sources/AnglesiteApp/ConnectDomainModel.swift` (full rewrite, ~120 lines)
- Test: `Tests/AnglesiteAppTests/ConnectDomainModelTests.swift` (append new tests + a fake)

**Interfaces:**
- Consumes: `RDAPLookupService`, `RDAPClient`, `RDAPDomainInfo` (Task 2); `DomainConfigStore`, `DomainConfig`, `DomainConfig.Domain`, `NewSiteDomainChoice.transfer` (existing `AnglesiteCore`).
- Produces: `ConnectDomainModel.RegistrarInfoState` (`.idle`/`.loading`/`.available(RDAPDomainInfo)`/`.unavailable`), `ConnectDomainModel.registrarInfo: RegistrarInfoState` (read-only), `ConnectDomainModel.isLookingUpRegistrarInfo: Bool` (read-only, for tests to await the background lookup), `ConnectDomainModel.init(rdap: any RDAPLookupService = RDAPClient())`. Task 4 (the view) consumes `registrarInfo`.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteAppTests/ConnectDomainModelTests.swift`, add a fake right after the imports (before `@MainActor @Suite struct ConnectDomainModelTests {`):

```swift
private actor FakeRDAPLookupService: RDAPLookupService {
    private let result: RDAPDomainInfo?
    init(result: RDAPDomainInfo?) { self.result = result }
    func lookup(hostname: String) async -> RDAPDomainInfo? { result }
}
```

Then append these tests inside the `ConnectDomainModelTests` struct, after the existing `submitTransferWithEmptyHostnameIsANoOp` test:

```swift
    @Test func openSheetJumpsToConnectedWhenTransferAlreadyDeclared() throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(
            DomainConfig(domain: .init(hostname: "example.com", choice: "transfer", attach: true)))

        model.openSheet()

        #expect(model.phase == .connected(hostname: "example.com"))
        #expect(model.sheetPresented)
    }

    @Test func openSheetStaysAtChoosingWhenChoiceIsBuy() throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(
            DomainConfig(domain: .init(hostname: "", choice: "buy", attach: false)))

        model.openSheet()

        #expect(model.phase == .choosing)
    }

    @Test func openSheetSeedsRegistrarInfoFromCachedAnglesiteJSON() throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(
            hostname: "example.com", choice: "transfer", attach: true,
            registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))

        model.openSheet()

        #expect(model.registrarInfo == .available(
            RDAPDomainInfo(registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))
    }

    @Test func submitTransferPersistsFreshRegistrarLookup() async throws {
        let fake = FakeRDAPLookupService(result: RDAPDomainInfo(registrar: "Namecheap", expiresAt: "2028-01-01T00:00:00Z"))
        let model = ConnectDomainModel(rdap: fake)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.beginTransfer()
        model.hostnameInput = "example.com"
        model.submitTransfer()

        repeat { await Task.yield() } while model.isLookingUpRegistrarInfo

        #expect(model.registrarInfo == .available(RDAPDomainInfo(registrar: "Namecheap", expiresAt: "2028-01-01T00:00:00Z")))
        let saved = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(saved.domain?.registrar == "Namecheap")
        #expect(saved.domain?.expiresAt == "2028-01-01T00:00:00Z")
    }

    @Test func failedLookupDoesNotClobberCachedRegistrarInfo() async throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(
            hostname: "example.com", choice: "transfer", attach: true,
            registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))

        model.openSheet()
        repeat { await Task.yield() } while model.isLookingUpRegistrarInfo

        #expect(model.registrarInfo == .available(
            RDAPDomainInfo(registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter ConnectDomainModelTests 2>&1 | tail -60`
Expected: FAIL to build — `argument passed to call that takes no arguments` (`ConnectDomainModel(rdap:)`) and `value of type 'ConnectDomainModel' has no member 'registrarInfo'`/`'isLookingUpRegistrarInfo'`.

- [ ] **Step 3: Implement the model changes**

Replace the full contents of `Sources/AnglesiteApp/ConnectDomainModel.swift`:

```swift
import SwiftUI
import AnglesiteCore

/// Drives the "Connect a Domain" sheet (#1180): buy/transfer/later, reachable from the
/// first-publish nudge in `DeployDrawerView` and permanently from `Website ▸ Connect a Domain…`.
/// Every domain-declaration action is a synchronous local file write via `ConnectDomainCommand` —
/// no network calls, unlike `HardenModel`/`DomainModel`. The actual Workers Custom Domain attach
/// stays owned by `CustomDomainAttachCommand`, which already runs on every deploy. The one
/// exception is registrar/expiration lookup (#1194): a passive, best-effort RDAP query that never
/// blocks or gates anything else in this sheet.
@MainActor
@Observable
final class ConnectDomainModel {
    enum Phase: Equatable {
        case choosing
        case enteringHostname
        case connected(hostname: String)
    }

    /// Registrar/expiration info for the connected hostname (#1194) — orthogonal to `phase` since
    /// it loads and refreshes on its own schedule instead of gating the sheet's own flow.
    enum RegistrarInfoState: Equatable {
        case idle
        case loading
        case available(RDAPDomainInfo)
        case unavailable
    }

    private(set) var phase: Phase = .choosing
    var sheetPresented: Bool = false
    var hostnameInput: String = ""
    private(set) var registrarInfo: RegistrarInfoState = .idle
    /// `true` while an RDAP lookup is in flight — lets tests deterministically wait for the
    /// background `Task` `loadRegistrarInfo` spawns to finish, the same role `DomainModel.isRunning`
    /// plays for its own async work.
    private(set) var isLookingUpRegistrarInfo: Bool = false

    private let rdap: any RDAPLookupService
    private var registrarLookupTask: Task<Void, Never>?
    private var currentSite: CurrentSite?

    /// The Cloudflare Domains marketing page — opened by the view layer's "Buy a domain" button,
    /// not by `chooseBuy()` itself, so this model stays free of `NSWorkspace`/AppKit side effects
    /// and is fully testable (matches `WebsiteCommands`'s "View on GitHub" convention of keeping
    /// `NSWorkspace.shared.open` out of the model layer).
    static let cloudflareDomainsURL = URL(string: "https://www.cloudflare.com/products/registrar/")!

    /// `rdap` is injectable for tests; production callers take the default `RDAPClient`.
    init(rdap: any RDAPLookupService = RDAPClient()) {
        self.rdap = rdap
    }

    /// Threaded from `SiteWindowModel.loadAndStart`, mirroring `DomainModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    /// Resets to `.choosing` unless `anglesite.json` already declares an owned (`transfer`)
    /// hostname, in which case this jumps straight to `.connected` and kicks off a registrar
    /// lookup — the only way to revisit a previously-connected domain's registrar/expiration info
    /// (#1194). A `buy` declaration (no real hostname yet) or no declaration at all still starts
    /// at `.choosing`, unchanged from #1180.
    func openSheet() {
        hostnameInput = ""
        registrarLookupTask?.cancel()
        registrarLookupTask = nil
        isLookingUpRegistrarInfo = false
        registrarInfo = .idle

        if let site = currentSite,
           let declared = try? DomainConfigStore(sourceDirectory: site.sourceDirectory).load(),
           let hostname = declared.domain?.hostname, !hostname.isEmpty,
           declared.domain?.choice == NewSiteDomainChoice.transfer.rawValue {
            phase = .connected(hostname: hostname)
            loadRegistrarInfo(hostname: hostname, sourceDirectory: site.sourceDirectory)
        } else {
            phase = .choosing
        }
        sheetPresented = true
    }

    func dismissSheet() {
        registrarLookupTask?.cancel()
        sheetPresented = false
    }

    /// "Not now" — dismisses without writing anything. `DOMAIN_CHOICE` stays whatever it already
    /// was (`later` by default), so this is a true no-op.
    func notNow() {
        dismissSheet()
    }

    /// "Buy a domain" — records the buy intent and dismisses. Opening Cloudflare Domains in the
    /// browser is the view's job (see `cloudflareDomainsURL`'s doc comment).
    func chooseBuy() {
        guard let site = currentSite else { return }
        ConnectDomainCommand.recordBuy(siteDirectory: site.sourceDirectory)
        dismissSheet()
    }

    /// "I already own a domain" — reveals the hostname field.
    func beginTransfer() {
        phase = .enteringHostname
    }

    /// Submits the typed hostname. No format validation beyond non-empty/trim, matching
    /// `DomainModel.resolveAndLoad` — a malformed hostname simply won't resolve a Cloudflare zone
    /// on the next deploy, surfaced there exactly like today's `.notConnected` outcome.
    func submitTransfer() {
        guard case .enteringHostname = phase, let site = currentSite else { return }
        let hostname = hostnameInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !hostname.isEmpty else { return }
        ConnectDomainCommand.recordTransfer(hostname: hostname, siteDirectory: site.sourceDirectory)
        phase = .connected(hostname: hostname)
        loadRegistrarInfo(hostname: hostname, sourceDirectory: site.sourceDirectory)
    }

    // MARK: - Private

    /// Seeds `registrarInfo` from whatever's already cached in `anglesite.json` (instant, no
    /// spinner) and kicks off a fresh RDAP lookup in the background. A successful lookup updates
    /// `registrarInfo` and persists into `anglesite.json`; a failed one only clears a `.loading`
    /// placeholder to `.unavailable` — it never regresses an already-good cached value back to
    /// nothing.
    private func loadRegistrarInfo(hostname: String, sourceDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        let declared = try? store.load()
        if let cached = declared?.domain, cached.hostname == hostname,
           cached.registrar != nil || cached.expiresAt != nil {
            registrarInfo = .available(RDAPDomainInfo(registrar: cached.registrar, expiresAt: cached.expiresAt))
        } else {
            registrarInfo = .loading
        }

        isLookingUpRegistrarInfo = true
        registrarLookupTask?.cancel()
        registrarLookupTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.rdap.lookup(hostname: hostname)
            self.isLookingUpRegistrarInfo = false
            guard case .connected(let current) = self.phase, current == hostname else { return }
            if let result, result.registrar != nil || result.expiresAt != nil {
                self.registrarInfo = .available(result)
                self.persistRegistrarInfo(result, hostname: hostname, sourceDirectory: sourceDirectory)
            } else if case .loading = self.registrarInfo {
                self.registrarInfo = .unavailable
            }
        }
    }

    private func persistRegistrarInfo(_ info: RDAPDomainInfo, hostname: String, sourceDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        guard var config = try? store.load(), config.domain?.hostname == hostname else { return }
        config.domain?.registrar = info.registrar
        config.domain?.expiresAt = info.expiresAt
        try? store.save(config)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter ConnectDomainModelTests 2>&1 | tail -80`
Expected: PASS — all `ConnectDomainModelTests` tests green, including the 5 new ones and the 5 pre-existing ones (`openSheetResetsToChoosingPhase` still passes since it declares no domain, so it still lands on `.choosing`).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/ConnectDomainModel.swift Tests/AnglesiteAppTests/ConnectDomainModelTests.swift
git commit -m "feat(#1194): look up and persist registrar info in ConnectDomainModel"
```

---

### Task 4: Display registrar/expiration in `ConnectDomainSheetView`

**Files:**
- Modify: `Sources/AnglesiteApp/ConnectDomainSheetView.swift`

**Interfaces:**
- Consumes: `ConnectDomainModel.registrarInfo: RegistrarInfoState`, `RDAPDomainInfo.registrar`/`.expiresAt` (Task 3).

There is no unit test target for SwiftUI view bodies in this codebase (`DomainConfigAuditSheetView`, `DomainSheetView`, etc. have no corresponding `*ViewTests.swift`) — this task is verified by building and a manual check in Task 5.

- [ ] **Step 1: Add the registrar info view**

In `Sources/AnglesiteApp/ConnectDomainSheetView.swift`, add `import Foundation` after `import AppKit`:

```swift
import SwiftUI
import AppKit
import Foundation
```

Replace the `.connected` case inside `content` (currently a single `Label`):

```swift
        case .connected(let hostname):
            Label("We'll connect \(hostname) on your next Publish.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
```

with:

```swift
        case .connected(let hostname):
            VStack(alignment: .leading, spacing: 8) {
                Label("We'll connect \(hostname) on your next Publish.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                registrarInfoView
            }
```

Then add these two private members after `content` (before `progressView`/`footer`, i.e. right after the `content` computed property's closing brace):

```swift
    @ViewBuilder
    private var registrarInfoView: some View {
        switch model.registrarInfo {
        case .idle, .unavailable:
            EmptyView()
        case .loading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Looking up registrar info…")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .available(let info):
            VStack(alignment: .leading, spacing: 2) {
                if let registrar = info.registrar {
                    Text("Registrar: \(registrar)")
                }
                if let expiresAt = info.expiresAt {
                    Text("Expires \(Self.formattedExpiration(expiresAt))")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    /// Formats a raw RDAP ISO 8601 `eventDate` for display; falls back to the raw string if it
    /// doesn't parse (an RDAP server returning something non-standard shouldn't blank the field).
    private static func formattedExpiration(_ raw: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
```

- [ ] **Step 2: Build the app target**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -60`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/ConnectDomainSheetView.swift
git commit -m "feat(#1194): show registrar and expiration in Connect Domain sheet"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full SwiftPM test suite**

Run: `swift test --package-path . 2>&1 | tail -80`
Expected: All tests pass, including the pre-existing `ConnectDomainCommandTests`, `DomainConfigAuditModelTests`, `CustomDomainAttachCommandTests` (none touch the new code path, but confirm nothing regressed).

If it hangs with no output: a stale SwiftPM process may be holding the `.build` lock — check `pgrep -fl swift-test`, kill the orphan, and re-run.

- [ ] **Step 2: Rebuild the app target**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -60`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Manual check (requires a Cloudflare API token already configured)**

1. Launch the built app, open or create a site.
2. `Website ▸ Connect a Domain…` ▸ "I already own a domain" ▸ enter a real domain you control ▸ Connect.
3. Confirm "Registrar: …" / "Expires …" appear under the confirmation message within a few seconds.
4. Check `Source/anglesite.json` for that site — confirm `domain.registrar` and `domain.expiresAt` are populated.
5. Quit and relaunch the app, reopen the same site, `Website ▸ Connect a Domain…` again — confirm the sheet shows the cached registrar/expiration immediately (no spinner) before/without needing network.

- [ ] **Step 4: Confirm no unrelated files changed**

Run: `git status`
Expected: only `Sources/AnglesiteCore/DomainConfig.swift`, `Sources/AnglesiteCore/RDAPClient.swift`, `Sources/AnglesiteApp/ConnectDomainModel.swift`, `Sources/AnglesiteApp/ConnectDomainSheetView.swift`, `Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift`, `Tests/AnglesiteCoreTests/RDAPClientTests.swift`, `Tests/AnglesiteAppTests/ConnectDomainModelTests.swift`, and the design/plan docs already committed this session.
