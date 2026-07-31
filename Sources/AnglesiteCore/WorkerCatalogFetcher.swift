import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
// OSLog is Darwin-only; AnglesiteCore is part of the Linux-portable target set (Package.swift,
// cross-platform port design §9/§10), so logging falls back to stderr off-Darwin.
#if canImport(OSLog)
import OSLog
#endif

/// Internal failure signal for the fetch path — never escapes `WorkerCatalogFetcher.catalog()`,
/// which degrades to cache/empty instead of throwing; public only so tests can construct it.
public enum WorkerCatalogFetchError: Error, Sendable, Equatable {
    /// The HTTP fetch didn't produce a usable 2xx response; the string names the URL for the log.
    case fetchFailed(String)
}

/// Fetches, parses, and disk-caches the `@dwk/workers` catalog manifest (`catalog.json`).
/// Network or parse failures degrade to the last successfully cached copy, then to an empty
/// catalog — the Workers Settings tab and deploy composition must never block or crash on a
/// catalog fetch failure (design doc §3).
public actor WorkerCatalogFetcher {
    #if canImport(OSLog)
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "WorkerCatalogFetcher")
    #endif

    /// Degraded-path logging, portable off-Darwin (no OSLog on Linux — cross-platform port
    /// design §9/§10).
    private static func logDegradation(_ message: String) {
        #if canImport(OSLog)
        logger.error("\(message, privacy: .public)")
        #else
        FileHandle.standardError.write(Data("[WorkerCatalogFetcher] \(message)\n".utf8))
        #endif
    }

    private let catalogURL: URL
    private let cacheURL: URL
    private let session: URLSession
    private let fileManager: FileManager

    /// Creates a fetcher. `catalogURL` is deliberately required (pass ``productionCatalogURL`` in
    /// production) so tests point at a local fixture server; cache location, session, and file
    /// manager default to production values.
    public init(
        catalogURL: URL,
        cacheURL: URL = WorkerCatalogFetcher.defaultCacheURL(),
        session: URLSession = .shared,
        fileManager: FileManager = .default
    ) {
        self.catalogURL = catalogURL
        self.cacheURL = cacheURL
        self.session = session
        self.fileManager = fileManager
    }

    /// Fetches the latest catalog and caches the raw manifest bytes to disk on success. On any
    /// failure (network error, non-2xx response, malformed JSON), falls back to the last cached
    /// catalog; if there is no cache either, returns an empty catalog. Never throws.
    public func catalog() async -> [WorkerDescriptor] {
        do {
            return try await fetchAndCache()
        } catch {
            Self.logDegradation("catalog fetch failed, falling back to cache: \(error)")
        }
        do {
            return try Self.readCache(cacheURL)
        } catch {
            Self.logDegradation("catalog cache read failed, falling back to empty catalog: \(error)")
            return []
        }
    }

    private func fetchAndCache() async throws -> [WorkerDescriptor] {
        let (data, response) = try await session.data(from: catalogURL)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw WorkerCatalogFetchError.fetchFailed("bad response from \(catalogURL)")
        }
        let descriptors = try WorkerCatalogReader.parse(data)
        do {
            try Self.writeCache(data, to: cacheURL, fileManager: fileManager)
        } catch {
            Self.logDegradation("catalog cache write failed (serving fresh data anyway): \(error)")
        }
        return descriptors
    }

    private static func readCache(_ url: URL) throws -> [WorkerDescriptor] {
        let data = try Data(contentsOf: url)
        return try WorkerCatalogReader.parse(data)
    }

    private static func writeCache(_ data: Data, to url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic])
    }

    /// The last successfully cached catalog, without any network fetch — for callers with no
    /// fetcher wiring (the headless deploy path, `SiteOperations`) that still need descriptor
    /// metadata such as route claims (#746). Returns an empty catalog when nothing has ever been
    /// cached or the cache is unreadable, mirroring `catalog()`'s final degradation step — and,
    /// like `catalog()`, never degrades silently: the fallback is logged so a headless deploy
    /// that loses route claims to a missing/corrupt cache leaves a diagnostic trace.
    public static func cachedCatalog(cacheURL: URL = WorkerCatalogFetcher.defaultCacheURL()) -> [WorkerDescriptor] {
        do {
            return try readCache(cacheURL)
        } catch {
            logDegradation("catalog cache read failed, falling back to empty catalog: \(error)")
            return []
        }
    }

    /// The published `@dwk/workers` monorepo catalog manifest — verified live 2026-07-17
    /// (davidwkeith/workers#255, merged in davidwkeith/workers#258). Callers still supply
    /// `catalogURL` explicitly at `init`; this is the value production call sites should pass.
    public static let productionCatalogURL = URL(
        string: "https://raw.githubusercontent.com/davidwkeith/workers/main/catalog.json"
    )!

    /// `~/Library/Application Support/Anglesite/worker-catalog-cache.json` — mirrors
    /// `SiteStore`'s `defaultPersistenceURL` convention (`SiteStore.swift:323-333`).
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
            .appendingPathComponent("worker-catalog-cache.json")
    }
}
