import Testing
import Foundation
@testable import AnglesiteCore

@Suite("RobotsConfigStore")
struct RobotsConfigStoreTests {
    @Test("read: empty/malformed input yields an empty config")
    func readMalformed() {
        #expect(RobotsConfigStore.read("") == RobotsConfig())
        #expect(RobotsConfigStore.read("not json") == RobotsConfig())
    }

    @Test("read: parses a valid config")
    func readValid() {
        let json = """
        {"noindex":[{"path":"/a/","source":{"kind":"page","file":"src/pages/a.astro"}}],"disallow":[],"extra":["User-agent: Foo\\nDisallow: /bar/"]}
        """
        let config = RobotsConfigStore.read(json)
        #expect(config.noindex == [RobotsConfigEntry(path: "/a/", source: .page(file: "src/pages/a.astro"))])
        #expect(config.extra == ["User-agent: Foo\nDisallow: /bar/"])
    }

    @Test("contains: true only for a matching source in the right directive")
    func containsMatchesSourceAndDirective() {
        let source = RobotsConfigSource.page(file: "src/pages/a.astro")
        let config = RobotsConfig(noindex: [RobotsConfigEntry(path: "/a/", source: source)])
        #expect(RobotsConfigStore.contains(source: source, directive: .noindex, in: config))
        #expect(!RobotsConfigStore.contains(source: source, directive: .disallowCrawl, in: config))
        #expect(!RobotsConfigStore.contains(source: .page(file: "src/pages/b.astro"), directive: .noindex, in: config))
    }

    @Test("upserting: appends a new entry")
    func upsertAppends() {
        let source = RobotsConfigSource.collection("blog", id: "post-1")
        let config = RobotsConfigStore.upserting(path: "/blog/post-1/", source: source, directive: .noindex, into: RobotsConfig())
        #expect(config.noindex == [RobotsConfigEntry(path: "/blog/post-1/", source: source)])
    }

    @Test("upserting: updates the path in place rather than duplicating")
    func upsertUpdatesInPlace() {
        let source = RobotsConfigSource.page(file: "src/pages/a.astro")
        var config = RobotsConfigStore.upserting(path: "/old/", source: source, directive: .disallowCrawl, into: RobotsConfig())
        config = RobotsConfigStore.upserting(path: "/new/", source: source, directive: .disallowCrawl, into: config)
        #expect(config.disallow == [RobotsConfigEntry(path: "/new/", source: source)])
    }

    @Test("upserting: leaves other directives and sourceless entries untouched")
    func upsertLeavesOthersAlone() {
        let manual = RobotsConfigEntry(path: "/manual/", source: nil)
        var config = RobotsConfig(disallow: [manual])
        config = RobotsConfigStore.upserting(
            path: "/a/", source: .page(file: "src/pages/a.astro"), directive: .noindex, into: config
        )
        #expect(config.disallow == [manual])
        #expect(config.noindex.count == 1)
    }

    @Test("removing: removes only the matching source")
    func removingMatchingSource() {
        let a = RobotsConfigSource.page(file: "src/pages/a.astro")
        let b = RobotsConfigSource.page(file: "src/pages/b.astro")
        var config = RobotsConfig(noindex: [
            RobotsConfigEntry(path: "/a/", source: a),
            RobotsConfigEntry(path: "/b/", source: b),
        ])
        config = RobotsConfigStore.removing(source: a, directive: .noindex, from: config)
        #expect(config.noindex == [RobotsConfigEntry(path: "/b/", source: b)])
    }

    @Test("removing: never matches a sourceless entry")
    func removingIgnoresManualEntries() {
        let manual = RobotsConfigEntry(path: "/manual/", source: nil)
        let config = RobotsConfig(disallow: [manual])
        let neverMatches = RobotsConfigSource(kind: "page", file: nil, collection: nil, id: nil)
        let after = RobotsConfigStore.removing(source: neverMatches, directive: .disallowCrawl, from: config)
        #expect(after.disallow == [manual])
    }

    @Test("serialized: sorts entries by path and round-trips through read")
    func serializedRoundTrips() {
        let config = RobotsConfig(noindex: [
            RobotsConfigEntry(path: "/z/", source: .page(file: "src/pages/z.astro")),
            RobotsConfigEntry(path: "/a/", source: .page(file: "src/pages/a.astro")),
        ])
        let text = RobotsConfigStore.serialized(config)
        #expect(text.hasSuffix("\n"))
        #expect(RobotsConfigStore.read(text).noindex.map(\.path) == ["/a/", "/z/"])
    }
}

@Suite("RobotsConfigFile")
struct RobotsConfigFileTests {
    private func tempSiteDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("RobotsConfigFileTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("read: missing file yields an empty config")
    func readMissing() throws {
        let dir = try tempSiteDir()
        #expect(RobotsConfigFile.read(under: dir) == RobotsConfig())
    }

    @Test("apply then flags: enabling a directive round-trips")
    func applyThenFlags() throws {
        let dir = try tempSiteDir()
        let source = RobotsConfigSource.page(file: "src/pages/secret.astro")
        try RobotsConfigFile.apply(source: source, noindex: true, disallowCrawl: false, path: "/secret/", under: dir)
        let flags = RobotsConfigFile.flags(for: source, under: dir)
        #expect(flags.noindex)
        #expect(!flags.disallowCrawl)
    }

    @Test("apply: disabling a previously-enabled directive removes its entry")
    func applyDisables() throws {
        let dir = try tempSiteDir()
        let source = RobotsConfigSource.page(file: "src/pages/secret.astro")
        try RobotsConfigFile.apply(source: source, noindex: true, disallowCrawl: false, path: "/secret/", under: dir)
        try RobotsConfigFile.apply(source: source, noindex: false, disallowCrawl: false, path: "/secret/", under: dir)
        #expect(!RobotsConfigFile.flags(for: source, under: dir).noindex)
    }

    @Test("apply: a no-op change never creates the file")
    func applyNoopSkipsWrite() throws {
        let dir = try tempSiteDir()
        let source = RobotsConfigSource.page(file: "src/pages/a.astro")
        try RobotsConfigFile.apply(source: source, noindex: false, disallowCrawl: false, path: "/a/", under: dir)
        #expect(!FileManager.default.fileExists(atPath: RobotsConfigFile.url(under: dir).path))
    }
}
