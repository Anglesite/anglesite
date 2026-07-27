import Foundation
import Testing
@testable import AnglesiteCore

@Suite("LicensingStore (#991)")
struct LicensingStoreTests {
    private func makeDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("LicensingStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func write(_ json: String, to directory: URL) throws {
        let dataDir = directory.appendingPathComponent("src/data", isDirectory: true)
        try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try json.write(to: dataDir.appendingPathComponent("licensing.json"), atomically: true, encoding: .utf8)
    }

    private let ccBY = LicenseRef(url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")

    @Test("load() returns an empty policy when the file is absent")
    func loadAbsent() throws {
        let dir = try makeDirectory()
        #expect(try LicensingStore(sourceDirectory: dir).load() == LicensingPolicy())
    }

    @Test("load() distinguishes an absent collection key from an explicit null")
    func loadAbsentVersusNull() throws {
        let dir = try makeDirectory()
        try write(#"{"default":null,"collections":{"notes":null}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.collections[.notes] == .assertNothing)
        #expect(policy.collections[.articles] == nil)
        #expect(policy.rule(for: .articles) == .inherit)
    }

    @Test("save() then load() round-trips every rule kind and the usage block")
    func roundTrip() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.defaultLicense = ccBY
        policy.collections[.notes] = .assertNothing
        policy.collections[.photos] = .license(ccBY)
        policy.usage = AIUsage(search: .yes, aiInput: .no, aiTrain: .no, blockAICrawlers: true)
        try LicensingStore(sourceDirectory: dir).save(policy)
        #expect(try LicensingStore(sourceDirectory: dir).load() == policy)
    }

    @Test("save() omits unset purposes so the JSON never carries key=unset")
    func saveOmitsUnset() throws {
        let dir = try makeDirectory()
        try LicensingStore(sourceDirectory: dir).save(LicensingPolicy())
        let json = try String(
            contentsOf: dir.appendingPathComponent("src/data/licensing.json"), encoding: .utf8)
        #expect(!json.contains("unset"))
    }

    @Test("the clamp survives a hand-edited document that permits AI but asks to block")
    func loadClamps() throws {
        let dir = try makeDirectory()
        try write(#"{"usage":{"aiInput":"yes","aiTrain":"no","blockAICrawlers":true}}"#, to: dir)
        #expect(try LicensingStore(sourceDirectory: dir).load().usage.blockAICrawlers == false)
    }

    @Test("save() clamps rather than writing a contradictory document")
    func saveClamps() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.usage = AIUsage(search: .unset, aiInput: .unset, aiTrain: .no, blockAICrawlers: true)
        try LicensingStore(sourceDirectory: dir).save(policy)
        // Read the raw bytes `save()` wrote, not `load()`'s re-decoded result: `AIUsage.init(from:)`
        // re-clamps on every decode, so asserting via `load()` would pass even if `encode` wrote a
        // contradictory `blockAICrawlers: true` to disk — it would be entirely subsumed by
        // `loadClamps`. This isolates the save path the way `saveOmitsUnset` does.
        let data = try Data(contentsOf: dir.appendingPathComponent("src/data/licensing.json"))
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let usage = raw?["usage"] as? [String: Any]
        #expect(usage?["blockAICrawlers"] as? Bool == false)
    }

    @Test("load() throws on a malformed document rather than silently discarding it")
    func loadMalformed() throws {
        let dir = try makeDirectory()
        try write("{ not json", to: dir)
        #expect(throws: (any Error).self) { try LicensingStore(sourceDirectory: dir).load() }
    }

    @Test("an unrecognized collection key is dropped")
    func loadDropsUnknownCollection() throws {
        let dir = try makeDirectory()
        try write(#"{"collections":{"bogus":null,"likes":null}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.collections.count == 1)
        #expect(policy.collections[.likes] == .assertNothing)
    }

    @Test("save() rejects a license URL the template would refuse to render")
    func saveRejectsUnsafeURL() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.defaultLicense = LicenseRef(url: "javascript:alert(1)", name: "Evil")
        #expect(throws: LicensingStore.ValidationError.unsafeLicenseURL("javascript:alert(1)")) {
            try LicensingStore(sourceDirectory: dir).save(policy)
        }
    }

    @Test("isSafeLicenseURL matches licensing.ts's hasSafeLicenseScheme")
    func schemeGuard() {
        #expect(LicenseRef.isSafeLicenseURL("https://example.com/l"))
        #expect(LicenseRef.isSafeLicenseURL("http://example.com/l"))
        #expect(LicenseRef.isSafeLicenseURL("/license/"))
        #expect(!LicenseRef.isSafeLicenseURL("//evil.example/x"))
        #expect(!LicenseRef.isSafeLicenseURL("license.html"))
        #expect(!LicenseRef.isSafeLicenseURL("javascript:alert(1)"))
        #expect(!LicenseRef.isSafeLicenseURL("JavaScript:alert(1)"))
        #expect(!LicenseRef.isSafeLicenseURL("data:text/html,x"))
        #expect(!LicenseRef.isSafeLicenseURL(""))
    }

    @Test("isSafeLicenseURL rejects a scheme with no authority, matching new URL()'s throw")
    func schemeGuardRejectsMissingAuthority() {
        // `new URL("http://")` (and "https://", and the slash-less "http:") throws in WHATWG
        // parsing — there is no host to point at — so hasSafeLicenseScheme returns false for all
        // three. A bare scheme guard that only checks `.scheme` (not `.host`) is more permissive
        // than the rule it claims to mirror.
        #expect(!LicenseRef.isSafeLicenseURL("http://"))
        #expect(!LicenseRef.isSafeLicenseURL("https://"))
        #expect(!LicenseRef.isSafeLicenseURL("http:"))
    }

    @Test("isSafeLicenseURL accepts a URL WHATWG's new URL() would trim before parsing")
    func schemeGuardAcceptsWhitespacePadding() {
        // WHATWG's URL parser strips leading/trailing C0 control-or-space and removes internal
        // tab/CR/LF before parsing, so `new URL()` accepts all three of these. Foundation's
        // `URL(string:)` fails outright on any of them, so without matching sanitization Swift is
        // *stricter* than the TS original — the opposite direction of a security bug, but still a
        // behavioral divergence the review flagged.
        #expect(LicenseRef.isSafeLicenseURL(" http://evil.com"))
        #expect(LicenseRef.isSafeLicenseURL("http://example.com\t"))
        #expect(LicenseRef.isSafeLicenseURL("\thttp://example.com"))
    }

    @Test("load() sanitizes an unsafe default URL instead of loading it verbatim")
    func loadSanitizesUnsafeDefaultURL() throws {
        // Self.validate (called only from save()) is not the only place an unsafe URL must be
        // caught: a hand-edited document loads through decode, not through validate, so the
        // sanitization has to live on the decode path too — matching toLicenseRef running on
        // every parse in the TS original, not just on the app's own writes.
        let dir = try makeDirectory()
        try write(#"{"default":{"url":"javascript:alert(1)","name":"Evil"}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.defaultLicense == nil)
    }

    @Test("load() degrades a garbage collection value to assertNothing, not inherit")
    func loadDegradesGarbageCollectionValueToAssertNothing() throws {
        // inherit falls through to the site default, asserting a license the document never
        // granted; a value that is present but untrustworthy must land on assertNothing instead,
        // matching normalizePolicy's `toLicenseRef(value)` returning null for a present key.
        let dir = try makeDirectory()
        try write(#"{"default":null,"collections":{"notes":{"garbage":true}}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.collections[.notes] == .assertNothing)
        #expect(policy.rule(for: .notes) != .inherit)
    }

    @Test("load() degrades a malformed default to nil instead of throwing")
    func loadDegradesMalformedDefaultToNil() throws {
        let dir = try makeDirectory()
        try write(#"{"default":{"name":"No URL here"}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.defaultLicense == nil)
    }

    @Test("load() treats collections: null as empty instead of throwing")
    func loadTreatsNullCollectionsAsEmpty() throws {
        let dir = try makeDirectory()
        try write(#"{"default":null,"collections":null}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.collections.isEmpty)
    }

    @Test("load() falls back to the URL for a missing or empty license name")
    func loadFallsBackToURLForMissingName() throws {
        let dir = try makeDirectory()
        try write(#"{"default":{"url":"https://example.com/l"},"collections":{"photos":{"url":"https://example.com/p","name":""}}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.defaultLicense?.name == "https://example.com/l")
        #expect(policy.rule(for: .photos) == .license(LicenseRef(url: "https://example.com/p", name: "https://example.com/p")))
    }

    @Test("a genuinely unparseable document still throws")
    func loadStillThrowsOnUnparseableJSON() throws {
        // The defensive-decode fixes above must not swallow a document that isn't JSON at all — a
        // later task refuses to overwrite a file it couldn't read, and that depends on this throw.
        let dir = try makeDirectory()
        try write("{ not json", to: dir)
        #expect(throws: (any Error).self) { try LicensingStore(sourceDirectory: dir).load() }
    }

    @Test(
        "load() degrades a wrong-typed usage container instead of throwing",
        arguments: [
            #"{"usage":"x"}"#,
            #"{"usage":42}"#,
            #"{"usage":[1,2]}"#,
        ]
    )
    func loadDegradesWrongTypedUsage(_ json: String) throws {
        // normalizeUsage's `!raw || typeof raw !== "object"` guard returns the all-unset default
        // for a string/number; an array is typeof "object" in JS, so it falls through to
        // destructuring, but every property comes back undefined and toPermission(undefined) is
        // "unset" too — so all three shapes land on the same all-unset result.
        let dir = try makeDirectory()
        try write(json, to: dir)
        #expect(try LicensingStore(sourceDirectory: dir).load().usage == AIUsage())
    }

    @Test(
        "load() degrades a wrong-typed collections container instead of throwing",
        arguments: [
            #"{"collections":"x"}"#,
            #"{"collections":42}"#,
            #"{"collections":[1,2]}"#,
        ]
    )
    func loadDegradesWrongTypedCollections(_ json: String) throws {
        // normalizePolicy's `rawCollections && typeof rawCollections === "object"` guard skips the
        // loop entirely for a string/number; an array passes the typeof check and is iterated, but
        // every numeric-index key ("0", "1", ...) fails isLicensable, so it also ends up empty.
        let dir = try makeDirectory()
        try write(json, to: dir)
        #expect(try LicensingStore(sourceDirectory: dir).load().collections.isEmpty)
    }

    @Test(
        "load() degrades a non-object top-level document instead of throwing",
        arguments: [
            #""nope""#,
            "[1,2]",
        ]
    )
    func loadDegradesNonObjectTopLevelDocument(_ json: String) throws {
        // normalizePolicy's `!raw || typeof raw !== "object"` guard returns the empty policy
        // outright for a bare string; a bare array is typeof "object" in JS, so it isn't caught by
        // that check, but destructuring `default`/`collections`/`usage` off an array with no such
        // properties yields undefined for all three, which resolves to the same empty policy.
        let dir = try makeDirectory()
        try write(json, to: dir)
        #expect(try LicensingStore(sourceDirectory: dir).load() == LicensingPolicy())
    }

    @Test("save() treats an empty-URL default license as no license, not an unsafe URL")
    func saveTreatsEmptyURLDefaultAsNoLicense() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.defaultLicense = LicenseRef(url: "", name: "")
        try LicensingStore(sourceDirectory: dir).save(policy)
        let reloaded = try LicensingStore(sourceDirectory: dir).load()
        #expect(reloaded.defaultLicense == nil)
    }

    @Test("validate() does not reject an empty-URL default license")
    func validateAllowsEmptyURLDefault() throws {
        var policy = LicensingPolicy()
        policy.defaultLicense = LicenseRef(url: "", name: "")
        try LicensingStore.validate(policy)
    }

    @Test("normalized() nils out only an empty-URL default, leaving everything else untouched")
    func normalizedOnlyTouchesEmptyURLDefault() {
        var policy = LicensingPolicy()
        policy.defaultLicense = ccBY
        policy.collections[.notes] = .license(ccBY)
        #expect(LicensingStore.normalized(policy) == policy)

        policy.defaultLicense = LicenseRef(url: "", name: "")
        #expect(LicensingStore.normalized(policy).defaultLicense == nil)
    }

    @Test("isSafeLicenseURL rejects a protocol-relative URL smuggled past the leading-slash guard via tab/CR/LF")
    func schemeGuardRejectsTabSmuggledProtocolRelative() {
        // The leading-slash fast path used to run against the raw string: "/\t/evil.com" has a
        // single leading slash before sanitization, so it was (wrongly) accepted as root-relative.
        // A browser strips the tab before parsing and resolves this as `//evil.com` — a
        // protocol-relative URL handing an attacker-chosen host to href — so this must be rejected
        // (#991 review finding 2).
        #expect(!LicenseRef.isSafeLicenseURL("/\t/evil.com"))
        #expect(!LicenseRef.isSafeLicenseURL("/\r/evil.com"))
        #expect(!LicenseRef.isSafeLicenseURL("/\n/evil.com"))
    }

    @Test("isSafeLicenseURL rejects a protocol-relative URL smuggled via a backslash")
    func schemeGuardRejectsBackslashSmuggledProtocolRelative() {
        // WHATWG's relative-slash state treats `\` the same as `/` for special schemes, so
        // `new URL("/\\evil.com", "https://site.example/")` resolves to `https://evil.com/` — the
        // leading-slash fast path must reject a backslash immediately after the leading slash the
        // same way it already rejects a second slash (#991 review finding 2). Verified against
        // Foundation's own `URL(string:)` resolution before writing this guard.
        #expect(!LicenseRef.isSafeLicenseURL("/\\evil.com"))
        #expect(!LicenseRef.isSafeLicenseURL("/\\/evil.com"))
        // ...and the same smuggling still works after whatwgTrim strips a tab first.
        #expect(!LicenseRef.isSafeLicenseURL("/\t\\evil.com"))
        #expect(!LicenseRef.isSafeLicenseURL("/\r\\evil.com"))
        #expect(!LicenseRef.isSafeLicenseURL("/\n\\evil.com"))
    }

    @Test("mayBlockAICrawlers requires both AI purposes denied")
    func mayBlock() {
        #expect(AIUsage(search: .unset, aiInput: .no, aiTrain: .no, blockAICrawlers: false).mayBlockAICrawlers)
        #expect(!AIUsage(search: .no, aiInput: .no, aiTrain: .unset, blockAICrawlers: false).mayBlockAICrawlers)
        #expect(!AIUsage(search: .no, aiInput: .yes, aiTrain: .no, blockAICrawlers: false).mayBlockAICrawlers)
    }
}
