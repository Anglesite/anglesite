import Foundation

/// Registry of user-configured ACP agent connections, persisted as JSON — mirrors `SiteStore`'s
/// `recents.json` pattern but stays synchronous (a plain class, not an actor): callers include
/// `AssistantBackendResolver`, which runs from a non-async closure (`SiteAssistantSessionFactory`'s
/// `AssistantBuilder`), and the store is tiny and touched rarely (Settings edits only).
public final class ACPAgentStore: @unchecked Sendable {
    private let fileManager: FileManager
    private let persistenceURL: URL

    /// - Parameters:
    ///   - persistenceURL: where to read/write `acp-agents.json`. Defaults to
    ///     `~/Library/Application Support/Anglesite/acp-agents.json`. Tests should pass a temp URL.
    ///   - fileManager: Injectable for tests; defaults to `.default`.
    public init(persistenceURL: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        self.persistenceURL = persistenceURL ?? Self.defaultPersistenceURL(fileManager: fileManager)
    }

    /// Reads the full list fresh from disk. Returns `[]` if no file exists yet.
    public func load() throws -> [ACPAgentConnection] {
        guard fileManager.fileExists(atPath: persistenceURL.path) else { return [] }
        let data = try Data(contentsOf: persistenceURL)
        return try Self.decoder.decode([ACPAgentConnection].self, from: data)
    }

    /// Appends `connection`. Callers are responsible for using a fresh `UUID` — this does not
    /// check for an existing entry with the same `id` (use `update` for that).
    public func add(_ connection: ACPAgentConnection) throws {
        var all = try load()
        all.append(connection)
        try persist(all)
    }

    /// Replaces the entry whose `id` matches `connection.id`. No-op if no entry matches.
    public func update(_ connection: ACPAgentConnection) throws {
        var all = try load()
        guard let index = all.firstIndex(where: { $0.id == connection.id }) else { return }
        all[index] = connection
        try persist(all)
    }

    /// Removes the entry with `id`. No-op if no entry matches.
    public func remove(id: UUID) throws {
        var all = try load()
        all.removeAll { $0.id == id }
        try persist(all)
    }

    private func persist(_ connections: [ACPAgentConnection]) throws {
        let dir = persistenceURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try Self.encoder.encode(connections)
        try data.write(to: persistenceURL, options: [.atomic])
    }

    private static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }

    private static var decoder: JSONDecoder { JSONDecoder() }

    private static func defaultPersistenceURL(fileManager: FileManager) -> URL {
        let support = (try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? fileManager.portableHomeDirectory
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        return support
            .appendingPathComponent("Anglesite", isDirectory: true)
            .appendingPathComponent("acp-agents.json")
    }
}
