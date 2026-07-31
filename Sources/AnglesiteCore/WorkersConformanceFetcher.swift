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

/// Internal failure signal for the fetch path — never escapes `WorkersConformanceFetcher.status()`,
/// which degrades to cache/empty instead of throwing; public only so tests can construct it.
public enum WorkersConformanceFetchError: Error, Sendable, Equatable {
    /// The HTTP fetch didn't produce a usable 2xx response; the string names the URL for the log.
    case fetchFailed(String)
}

/// Fetches, parses, and disk-caches `conformance/status.json` from the `@dwk/workers` monorepo.
/// Network or parse failures degrade to the last successfully cached copy, then to an empty
/// status — this is advisory-only (see `WorkerActivation.conformanceAdvisory`), so a fetch
/// failure must never block a deploy, mirroring `WorkerCatalogFetcher`'s own degradation
/// contract.
public actor WorkersConformanceFetcher {
    #if canImport(OSLog)
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "WorkersConformanceFetcher")
    #endif

    /// Degraded-path logging, portable off-Darwin (no OSLog on Linux — cross-platform port
    /// design §9/§10).
    private static func logDegradation(_ message: String) {
        #if canImport(OSLog)
        logger.error("\(message, privacy: .public)")
        #else
        FileHandle.standardError.write(Data("[WorkersConformanceFetcher] \(message)\n".utf8))
        #endif
    }

    private let statusURL: URL
    private let cacheURL: URL
    private let session: URLSession
    private let fileManager: FileManager

    /// Creates a fetcher. `statusURL` is deliberately required (pass ``productionStatusURL`` in
    /// production) so tests point at a local fixture server; cache location, session, and file
    /// manager default to production values.
    public init(
        statusURL: URL,
        cacheURL: URL = WorkersConformanceFetcher.defaultCacheURL(),
        session: URLSession = .shared,
        fileManager: FileManager = .default
    ) {
        self.statusURL = statusURL
        self.cacheURL = cacheURL
        self.session = session
        self.fileManager = fileManager
    }

    /// Fetches the latest conformance status and caches the raw manifest bytes to disk on
    /// success. On any failure (network error, non-2xx response, malformed JSON), falls back to
    /// the last cached status; if there is no cache either, returns an empty status. Never
    /// throws — this is advisory-only, so callers must never have to handle a failure path.
    public func status() async -> WorkersConformanceStatus {
        do {
            return try await fetchAndCache()
        } catch {
            Self.logDegradation("status fetch failed, falling back to cache: \(error)")
        }
        do {
            return try Self.readCache(cacheURL)
        } catch {
            Self.logDegradation("status cache read failed, falling back to empty status: \(error)")
            return WorkersConformanceStatus(packages: [:])
        }
    }

    private func fetchAndCache() async throws -> WorkersConformanceStatus {
        let (data, response) = try await session.data(from: statusURL)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw WorkersConformanceFetchError.fetchFailed("bad response from \(statusURL)")
        }
        let status = try WorkersConformanceReader.parse(data)
        do {
            try Self.writeCache(data, to: cacheURL, fileManager: fileManager)
        } catch {
            Self.logDegradation("status cache write failed (serving fresh data anyway): \(error)")
        }
        return status
    }

    private static func readCache(_ url: URL) throws -> WorkersConformanceStatus {
        let data = try Data(contentsOf: url)
        return try WorkersConformanceReader.parse(data)
    }

    private static func writeCache(_ data: Data, to url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic])
    }

    /// Verified live against `davidwkeith/workers` during #359 planning (2026-07-21).
    public static let productionStatusURL = URL(
        string: "https://raw.githubusercontent.com/davidwkeith/workers/main/conformance/status.json"
    )!

    /// `~/Library/Application Support/Anglesite/worker-conformance-cache.json` — mirrors
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
            .appendingPathComponent("worker-conformance-cache.json")
    }
}
