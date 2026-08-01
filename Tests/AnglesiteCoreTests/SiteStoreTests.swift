import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for `SiteStore` recents behavior: record, remove, load, bookmarks, change streams.
final class SiteStoreTests {
    private let tempDir: URL
    private let persistenceURL: URL
    private let fileManager = FileManager.default

    init() throws {
        tempDir = fileManager.temporaryDirectory.appendingPathComponent("anglesite-store-\(UUID().uuidString)", isDirectory: true)
        persistenceURL = tempDir.appendingPathComponent("recents.json")
        try fileManager.createDirectory(at: tempDir, withIntermediateDirectories: true)
    }

    deinit {
        try? fileManager.removeItem(at: tempDir)
    }

    /// Create a valid `.anglesite` package skeleton with all required sentinels in `Source/`.
    private func makeValidPackage(named name: String) throws -> AnglesitePackage {
        let (pkg, _) = try AnglesitePackage.createSkeleton(
            at: tempDir.appendingPathComponent("\(name).anglesite", isDirectory: true),
            displayName: name
        )
        for sentinel in ProjectValidator.requiredSentinels {
            try Data().write(to: pkg.sourceURL.appendingPathComponent(sentinel))
        }
        return pkg
    }

    @Test("record discovers valid package") func recordDiscoversValidPackage() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)
        #expect(site.name == "alpha")
        #expect(site.isValid)
        let all = await store.sites
        #expect(all.map(\.name) == ["alpha"])
    }

    @Test("record two packages preserves both") func recordTwoPackages() async throws {
        let a = try makeValidPackage(named: "alpha")
        let b = try makeValidPackage(named: "bravo")
        let store = SiteStore(persistenceURL: persistenceURL)
        _ = try await store.record(a)
        _ = try await store.record(b)
        let names = await store.sites.map(\.name)
        #expect(Set(names) == Set(["alpha", "bravo"]))
    }

    @Test("Persistence round trip") func persistenceRoundTrip() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let writer = SiteStore(persistenceURL: persistenceURL)
        _ = try await writer.record(pkg)

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        let loaded = await reader.sites
        #expect(loaded.map(\.name) == ["alpha"])
    }

    /// Regression for #749: deleting a package in Finder left its cached recents entry visible
    /// in the launcher, File ▸ Open Recent, and the Dock menu on every subsequent launch.
    @Test("load removes recents whose package directory was deleted")
    func loadRemovesDeletedPackage() async throws {
        let pkg = try makeValidPackage(named: "deleted")
        let writer = SiteStore(persistenceURL: persistenceURL)
        _ = try await writer.record(pkg)
        try fileManager.removeItem(at: pkg.url)

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        #expect(await reader.sites.isEmpty)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let persisted = try decoder.decode([SiteStore.Site].self, from: Data(contentsOf: persistenceURL))
        #expect(persisted.isEmpty, "load() should heal recents.json so the ghost does not return")
    }

    @Test("load retains an existing package that is missing project sentinels")
    func loadRetainsExistingInvalidPackage() async throws {
        let pkg = try makeValidPackage(named: "broken")
        let writer = SiteStore(persistenceURL: persistenceURL)
        let site = try await writer.record(pkg)
        try fileManager.removeItem(at: pkg.sourceURL.appendingPathComponent(ProjectValidator.requiredSentinels[0]))

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        let loaded = await reader.find(id: site.id)
        #expect(loaded != nil)
        #expect(loaded?.isValid == false)
    }

    /// A missing path is not proof of deletion when its security-scoped bookmark cannot resolve:
    /// the package may live on a temporarily unavailable external or network volume (#749).
    @Test("load retains a missing package when its bookmark cannot resolve")
    func loadRetainsMissingPackageWithUnresolvableBookmark() async throws {
        let pkg = try makeValidPackage(named: "temporarily-unavailable")
        let writer = SiteStore(persistenceURL: persistenceURL)
        let site = try await writer.record(pkg)
        try await writer.setBookmark(Data("not-a-bookmark".utf8), for: site.id)
        try fileManager.removeItem(at: pkg.url)

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        #expect(await reader.find(id: site.id) != nil)
    }

    /// The #776 scenario: the package is fully intact on disk — only its persisted bookmark can
    /// no longer be resolved (e.g. a reboot invalidated the sandbox extension). `load()` must not
    /// report this as "missing required files" (misleading — the files are all there) and must
    /// flag it as needing re-authorization so the UI can offer a "Locate…" recovery instead of
    /// going dead with no explanation.
    @Test("load flags an intact package with an unresolvable bookmark as needing reauthorization")
    func loadFlagsIntactPackageNeedingReauthorization() async throws {
        let pkg = try makeValidPackage(named: "lost-grant")
        let writer = SiteStore(persistenceURL: persistenceURL)
        let site = try await writer.record(pkg)
        #expect(site.isValid)
        try await writer.setBookmark(Data("not-a-bookmark".utf8), for: site.id)
        // The package itself is untouched — only the bookmark is bad.

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        let loaded = try #require(await reader.find(id: site.id))
        #expect(loaded.needsReauthorization)
        #expect(!loaded.isValid, "access can't be verified, so the site can't be opened until reauthorized")
        #expect(loaded.missingSentinels.isEmpty, "must not misreport a lost grant as missing project files")
    }

    /// `record()` rebuilds the entry via `Site.make`, which recomputes validity directly (no
    /// bookmark involved) — so it clears a stale `needsReauthorization` in memory immediately.
    /// This is what makes `SiteActions.reauthorize`/`registerPackage` (record + a fresh
    /// `setBookmark`, in `SiteActions.swift`) heal the visible state right away; the paired
    /// `setBookmark` call — not tested here, it lives outside AnglesiteCore — is still what makes
    /// the fix survive a relaunch, since `record()` alone carries the stale bookmark forward
    /// unchanged (see `recordCarriesBookmarkForward`).
    @Test("record clears a prior needsReauthorization flag")
    func recordClearsNeedsReauthorization() async throws {
        let pkg = try makeValidPackage(named: "healed")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)
        try await store.setBookmark(Data("not-a-bookmark".utf8), for: site.id)
        try await store.load()
        #expect(try #require(await store.find(id: site.id)).needsReauthorization)

        _ = try await store.record(pkg)
        let healed = try #require(await store.find(id: site.id))
        #expect(!healed.needsReauthorization)
        #expect(healed.isValid)
    }

    /// `recents.json` written before #776 has no `needsReauthorization` key. Decoding must default
    /// it to `false` rather than fail `load()` outright, which would blank the launcher for every
    /// existing user on upgrade.
    @Test("Site decodes pre-#776 JSON lacking needsReauthorization as false")
    func siteDecodesLegacyJSONWithoutReauthorizationKey() throws {
        let json = """
        {
            "id": "legacy-id",
            "name": "legacy",
            "packageURL": "file:///tmp/legacy.anglesite/",
            "isValid": true,
            "missingSentinels": [],
            "lastSeen": "2026-01-01T00:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let site = try decoder.decode(SiteStore.Site.self, from: Data(json.utf8))
        #expect(!site.needsReauthorization)
    }

    /// Regression: validity is cached in `recents.json` but recomputed on `load()`. A registry
    /// written by an older build (or before a sentinel-list fix) can hold a stale `isValid:false`
    /// for a package that is actually valid on disk — that left every site greyed-out in the
    /// launcher even after the validator was corrected, because the launcher reads the cached
    /// value and `load()` never re-checked. `load()` must heal the verdict, and persist it back.
    @Test("load re-validates a stale isValid against the live filesystem") func loadRevalidatesStaleValidity() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        // Record normally, then corrupt the on-disk registry to a stale invalid verdict.
        let writer = SiteStore(persistenceURL: persistenceURL)
        let site = try await writer.record(pkg)
        #expect(site.isValid)
        let stale = SiteStore.Site(
            id: site.id,
            name: site.name,
            packageURL: site.packageURL,
            isValid: false,
            missingSentinels: ["anglesite.config.json", "astro.config.ts"],
            lastSeen: site.lastSeen
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode([stale]).write(to: persistenceURL)

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        let loaded = await reader.sites
        #expect(loaded.count == 1)
        #expect(loaded[0].isValid, "load() should recompute validity from the live filesystem")
        #expect(loaded[0].missingSentinels.isEmpty)

        // The correction is healed back to disk, so a second reader sees it without re-checking.
        let healed = try Data(contentsOf: persistenceURL)
        #expect(String(decoding: healed, as: UTF8.self).contains("\"isValid\" : true"))
    }

    @Test("Remove does not delete files") func removeDoesNotDeleteFiles() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        try await store.remove(id: site.id)
        let remaining = await store.sites
        #expect(remaining.isEmpty)
        #expect(fileManager.fileExists(atPath: pkg.url.path), "package on disk must be untouched")
    }

    /// The #186 case: a bookmarked entry must stay gone after removal, even across a reload.
    @Test("Remove drops a bookmarked entry permanently across reload")
    func removeBookmarkedSitePermanent() async throws {
        let pkg = try makeValidPackage(named: "external-site")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)
        try await store.setBookmark(Data([0xAB, 0xCD]), for: site.id)
        #expect(await store.bookmarkData(for: site.id) != nil)

        try await store.remove(id: site.id)

        let reloaded = SiteStore(persistenceURL: persistenceURL)
        try await reloaded.load()
        let afterLoad = await reloaded.sites
        #expect(afterLoad.isEmpty)
        #expect(await reloaded.bookmarkData(for: site.id) == nil)
    }

    // MARK: - displayName override (#266)

    /// Write a `settings.plist` override into a package's `Config/`.
    private func writeOverride(_ name: String?, into pkg: AnglesitePackage) async throws {
        try await SiteConfigStore(configDirectory: pkg.configURL).save(SiteSettings(displayName: name))
    }

    @Test("Site.make prefers the settings displayName override over the marker name")
    func makePrefersOverride() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        try await writeOverride("Alpha Production", into: pkg)
        let site = try SiteStore.Site.make(package: pkg)
        #expect(site.name == "Alpha Production")
    }

    @Test("Site.make falls back to the marker name when the override is nil")
    func makeFallsBackWhenNoOverride() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let site = try SiteStore.Site.make(package: pkg)
        #expect(site.name == "alpha")
    }

    @Test("Site.make falls back to the marker name when the override is blank")
    func makeFallsBackWhenOverrideBlank() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        try await writeOverride("   ", into: pkg)
        let site = try SiteStore.Site.make(package: pkg)
        #expect(site.name == "alpha")
    }

    @Test("Site.make falls back to the marker name when settings.plist is corrupt")
    func makeFallsBackWhenSettingsCorrupt() throws {
        let pkg = try makeValidPackage(named: "alpha")
        try Data("not a plist".utf8).write(to: pkg.configURL.appendingPathComponent("settings.plist"))
        let site = try SiteStore.Site.make(package: pkg)
        #expect(site.name == "alpha")
    }

    @Test("setDisplayName persists the override and updates the in-memory name")
    func setDisplayNameUpdatesName() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        let updated = try await store.setDisplayName("Alpha Production", for: site.id)
        #expect(updated?.name == "Alpha Production")
        #expect(await store.find(id: site.id)?.name == "Alpha Production")
        // Persisted to settings.plist (a fresh make() re-resolves it).
        #expect(try SiteConfigStore.read(from: pkg.configURL).displayName == "Alpha Production")
    }

    @Test("setDisplayName with blank input clears the override back to the marker name")
    func setDisplayNameClearsOnBlank() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)
        _ = try await store.setDisplayName("Alpha Production", for: site.id)

        let cleared = try await store.setDisplayName("  ", for: site.id)
        #expect(cleared?.name == "alpha")
        #expect(try SiteConfigStore.read(from: pkg.configURL).displayName == nil)
    }

    @Test("setDisplayName persists the new name across a reload")
    func setDisplayNamePersistsAcrossReload() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let writer = SiteStore(persistenceURL: persistenceURL)
        let site = try await writer.record(pkg)
        _ = try await writer.setDisplayName("Alpha Production", for: site.id)

        let reader = SiteStore(persistenceURL: persistenceURL)
        try await reader.load()
        #expect(await reader.find(id: site.id)?.name == "Alpha Production")
    }

    @Test("setDisplayName returns the unchanged site when the name is identical")
    func setDisplayNameNoOpWhenUnchanged() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)
        let first = try await store.setDisplayName("Alpha Production", for: site.id)

        // Re-applying the same override short-circuits to the existing entry.
        let again = try await store.setDisplayName("Alpha Production", for: site.id)
        #expect(again == first)
        #expect(await store.find(id: site.id)?.name == "Alpha Production")
    }

    @Test("setDisplayName propagates SITE_NAME/CF_PROJECT_NAME into an untitled site's .site-config and wrangler.toml")
    func setDisplayNamePropagatesUntitledSiteConfig() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        try "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\n".write(
            to: pkg.sourceURL.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        try #"name = "untitled""#.write(
            to: pkg.sourceURL.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        _ = try await store.setDisplayName("Acme Bakery", for: site.id)

        let config = try String(contentsOf: pkg.sourceURL.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
        let toml = try String(contentsOf: pkg.sourceURL.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains(#"name = "acme-bakery""#))
    }

    @Test("setDisplayName does not propagate into .site-config once the site has deployed")
    func setDisplayNameSkipsPropagationAfterDeploy() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        try "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nCF_WORKER_DEPLOYED=true\n".write(
            to: pkg.sourceURL.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        _ = try await store.setDisplayName("Acme Bakery", for: site.id)

        let config = try String(contentsOf: pkg.sourceURL.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "untitled")
    }

    @Test("setDisplayName is a no-op for an unknown id")
    func setDisplayNameUnknownIDNoOp() async throws {
        let store = SiteStore(persistenceURL: persistenceURL)
        let result = try await store.setDisplayName("ghost", for: "no-such-id")
        #expect(result == nil)
        #expect(await store.sites.isEmpty)
    }

    // MARK: - Change handler

    actor ChangeRecorder {
        private(set) var snapshots: [[SiteStore.Site]] = []
        func record(_ sites: [SiteStore.Site]) { snapshots.append(sites) }
        var count: Int { snapshots.count }
        var last: [SiteStore.Site]? { snapshots.last }
    }

    @Test("Change handler fires on record")
    func changeHandlerFiresOnRecord() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let recorder = ChangeRecorder()
        await store.setChangeHandler { sites in await recorder.record(sites) }

        _ = try await store.record(pkg)

        let last = await recorder.last
        #expect(last?.map(\.name) == ["alpha"])
    }

    @Test("Change handler fires on remove")
    func changeHandlerFiresOnRemove() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        let recorder = ChangeRecorder()
        await store.setChangeHandler { sites in await recorder.record(sites) }

        try await store.remove(id: site.id)

        let last = await recorder.last
        #expect(last?.isEmpty == true)
    }

    @Test("Change handler fires on load")
    func changeHandlerFiresOnLoad() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let writer = SiteStore(persistenceURL: persistenceURL)
        _ = try await writer.record(pkg)

        let reader = SiteStore(persistenceURL: persistenceURL)
        let recorder = ChangeRecorder()
        await reader.setChangeHandler { sites in await recorder.record(sites) }

        try await reader.load()

        let last = await recorder.last
        #expect(last?.map(\.name) == ["alpha"])
    }

    @Test("Change handler does not fire on setBookmark")
    func changeHandlerDoesNotFireOnSetBookmark() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        let recorder = ChangeRecorder()
        await store.setChangeHandler { sites in await recorder.record(sites) }
        try await store.setBookmark(Data([0x01, 0x02]), for: site.id)

        let count = await recorder.count
        #expect(count == 0)
    }

    @Test("Change handler can be cleared")
    func changeHandlerCanBeCleared() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        let recorder = ChangeRecorder()
        await store.setChangeHandler { sites in await recorder.record(sites) }

        _ = try await store.record(pkg)
        await store.setChangeHandler(nil)
        let id = try #require(await store.sites.first).id
        try await store.remove(id: id)

        let count = await recorder.count
        #expect(count == 1, "the post-clear remove must not emit")
    }

    // MARK: - Change stream

    @Test("Change stream yields the current snapshot on subscribe")
    func changeStreamYieldsCurrentSnapshotOnSubscribe() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        let store = SiteStore(persistenceURL: persistenceURL)
        _ = try await store.record(pkg)

        var iterator = store.changeStream().makeAsyncIterator()
        let first = await iterator.next()
        #expect(first?.map(\.name) == ["alpha"])
    }

    @Test("Change stream delivers a post-remove snapshot without the removed id")
    func changeStreamDeliversRemoval() async throws {
        let a = try makeValidPackage(named: "alpha")
        let b = try makeValidPackage(named: "bravo")
        let store = SiteStore(persistenceURL: persistenceURL)
        let siteA = try await store.record(a)
        _ = try await store.record(b)
        let alphaID = siteA.id

        var iterator = store.changeStream().makeAsyncIterator()
        _ = await iterator.next() // drain subscribe-time snapshot

        try await store.remove(id: alphaID)

        let afterRemove = await iterator.next()
        #expect(afterRemove?.contains { $0.id == alphaID } == false)
    }

    @Test("Change stream fans out to multiple subscribers")
    func changeStreamFansOutToMultipleSubscribers() async throws {
        let store = SiteStore(persistenceURL: persistenceURL)
        var iterA = store.changeStream().makeAsyncIterator()
        var iterB = store.changeStream().makeAsyncIterator()
        _ = await iterA.next()
        _ = await iterB.next()

        let pkg = try makeValidPackage(named: "alpha")
        _ = try await store.record(pkg)

        let a = await iterA.next()
        let b = await iterB.next()
        #expect(a?.map(\.name) == ["alpha"])
        #expect(b?.map(\.name) == ["alpha"])
    }

    @Test("A cancelled subscriber does not break a surviving one")
    func changeStreamSurvivesSubscriberCancellation() async throws {
        let store = SiteStore(persistenceURL: persistenceURL)

        let task1 = Task {
            for await _ in store.changeStream() { }
        }
        var iter2 = store.changeStream().makeAsyncIterator()
        _ = await iter2.next()

        task1.cancel()
        _ = await task1.value

        let pkg = try makeValidPackage(named: "alpha")
        _ = try await store.record(pkg)

        let survivor = await iter2.next()
        #expect(survivor?.map(\.name) == ["alpha"])
    }

    @Test("Change handler does not fire on no-file load")
    func changeHandlerDoesNotFireOnNoFileLoad() async throws {
        let store = SiteStore(persistenceURL: persistenceURL)
        let recorder = ChangeRecorder()
        await store.setChangeHandler { sites in await recorder.record(sites) }

        try await store.load()

        let count = await recorder.count
        #expect(count == 0)
    }

    // MARK: - Bookmark retention

    @Test("record carries bookmark forward on re-record of same package")
    func recordCarriesBookmarkForward() async throws {
        let pkg = try makeValidPackage(named: "live")
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)
        try await store.setBookmark(Data([0xCA, 0xFE]), for: site.id)

        _ = try await store.record(pkg)

        let bookmark = await store.bookmarkData(for: site.id)
        #expect(bookmark == Data([0xCA, 0xFE]))
    }
}
