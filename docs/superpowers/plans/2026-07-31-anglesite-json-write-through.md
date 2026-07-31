# anglesite.json Write-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing writer that touches a site's domain/DNS/edge/email/Workers
configuration also update the git-tracked declaration in `Source/anglesite.json`, so the file
becomes an exact record of what the app actually applied (#1170, slice 2 of 5 for #1095).

**Architecture:** `DomainConfigStore` (from #1169 / PR #1178, already merged onto this branch)
provides `load()`/`save(_:)` for `Source/anglesite.json`. Each producer — `DomainOperations`
(DNS add/delete), `HardenExecutor` (edge hardening), `CustomDomainAttachCommand` (domain
attach), and a new `EmailSetupExecutor` (email DNS apply) — loads the current declaration,
folds in what it just successfully applied, and saves it back, best-effort (a write-through
failure never turns an already-successful Cloudflare/API call into a reported failure). GUI
call sites (`DomainModel`, `HardenModel`) learn the site's `sourceDirectory` via the existing
`CurrentSite` plumbing (#822) threaded from `SiteWindowModel.loadAndStart`. Siri/Shortcuts
intents (`DomainIntents`) have no site context today (they operate on a bare domain string) and
keep working unchanged via a protocol-extension convenience overload that passes
`sourceDirectory: nil` — no write-through, not a regression.

**Tech Stack:** Swift 6.4, SwiftPM (`AnglesiteCore`, `AnglesiteApp`, `AnglesiteIntents`
targets), Swift Testing (`@Test`/`#expect`).

## Global Constraints

- Follow `CONTRIBUTING.md`: conventional commits, subject ≤72 chars, `Closes #1170` in the
  final PR body using `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings.
- Run `swift test --package-path .` after every task; it must stay green.
- Never make a write-through failure turn a successful Cloudflare/API operation into a reported
  error — every write-through call is `try?`, discarding failures (matching
  `CustomDomainAttachCommand`'s existing best-effort posture).
- Every new/changed public API needs a doc comment (see `docs/comment-style-guide.md`); CI fails
  on broken DocC links.
- Do not touch `Sources/AnglesiteCore/DomainConfig.swift` or `DomainConfigStore.swift` bodies —
  they're #1169's surface (already merged onto this branch via PR #1178). Add new write-through
  logic in new files/extensions instead, to keep this slice's diff self-contained.
- HardenExecutor's DNS-record hardening items (`.addCAARecord`, `.addNullMX`,
  `.addSPFRejectAll`, `.addDMARCReject`) are **not** written into `dns.managedRecords` in this
  slice — the issue's scope note ties `dns.managedRecords` writes to `DomainOperations`
  specifically and `edge` writes to `HardenExecutor` specifically. Leave a code comment noting
  this as a known gap, not a silent omission.

---

## Task 1: `DomainConfig` write-through helpers (pure logic, no I/O)

**Files:**
- Create: `Sources/AnglesiteCore/DomainConfigWriteThrough.swift`
- Test: `Tests/AnglesiteCoreTests/DomainConfigWriteThroughTests.swift`

**Interfaces:**
- Consumes: `DomainConfig`, `DomainConfig.DNS`, `DomainConfig.DNSRecord`, `DomainConfig.Edge`,
  `DomainConfig.Edge.CloudflareEdge`, `DomainConfig.Edge.WAFRule` (all from
  `Sources/AnglesiteCore/DomainConfig.swift`, already on this branch).
- Produces: `DomainConfig.addingManagedDNSRecord(_:)`, `DomainConfig.removingManagedDNSRecord(type:name:content:)`,
  `DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules(_:onto:)` — used by Task 2 (`DomainOperations`)
  and Task 6 (`HardenExecutor`).

- [ ] **Step 1: Write the failing tests**

```swift
import Testing
@testable import AnglesiteCore

@Suite struct DomainConfigWriteThroughTests {
    @Test func addingManagedDNSRecordAppendsToEmptyConfig() {
        var config = DomainConfig()
        config = config.addingManagedDNSRecord(
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"))
        #expect(config.dns?.managedRecords == [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ])
    }

    @Test func addingManagedDNSRecordAppendsToExisting() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10, purpose: "email:icloud"),
        ]))
        config = config.addingManagedDNSRecord(
            .init(type: "MX", name: "@", content: "mx02.mail.icloud.com", priority: 10, purpose: "email:icloud"))
        #expect(config.dns?.managedRecords?.count == 2)
    }

    @Test func addingManagedDNSRecordDedupesExactRepeat() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ]))
        config = config.addingManagedDNSRecord(
            .init(type: "txt", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"))
        #expect(config.dns?.managedRecords?.count == 1)
    }

    @Test func removingManagedDNSRecordDropsMatchByTypeNameContent() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
            .init(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10),
        ]))
        config = config.removingManagedDNSRecord(type: "txt", name: "_atproto", content: "did=abc")
        #expect(config.dns?.managedRecords?.count == 1)
        #expect(config.dns?.managedRecords?.first?.type == "MX")
    }

    @Test func removingManagedDNSRecordNoMatchIsNoOp() {
        var config = DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc"),
        ]))
        config = config.removingManagedDNSRecord(type: "TXT", name: "other", content: "did=xyz")
        #expect(config.dns?.managedRecords?.count == 1)
    }

    @Test func removingManagedDNSRecordFromNilDNSIsNoOp() {
        var config = DomainConfig()
        config = config.removingManagedDNSRecord(type: "TXT", name: "x", content: "y")
        #expect(config.dns == nil)
    }

    @Test func accumulatingWAFRulesAppendsNewOntoExisting() {
        let existing = [DomainConfig.Edge.WAFRule(description: "Block dotfiles", expression: "(x)", action: "block")]
        let new = [DomainConfig.Edge.WAFRule(description: "Block xmlrpc", expression: "(y)", action: "block")]
        let merged = DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules(new, onto: existing)
        #expect(merged.count == 2)
    }

    @Test func accumulatingWAFRulesDedupesExactRepeat() {
        let rule = DomainConfig.Edge.WAFRule(description: "Block dotfiles", expression: "(x)", action: "block")
        let merged = DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules([rule], onto: [rule])
        #expect(merged.count == 1)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DomainConfigWriteThroughTests`
Expected: FAIL — `addingManagedDNSRecord`/`removingManagedDNSRecord`/`accumulatingWAFRules` not defined.

- [ ] **Step 3: Write the implementation**

```swift
import Foundation

/// Pure mutation helpers for `DomainConfig`'s array-typed fields (#1170). `DomainConfigStore.save`
/// deep-merges *objects* but replaces *arrays* wholesale (see its own doc comment), so any writer
/// that wants to grow an array field across repeated runs — instead of clobbering it with just
/// this run's records — must load the current value, combine it here, and save the combined
/// result. Kept in its own file (not `DomainConfig.swift`) so this slice's diff stays separate
/// from #1169's schema/store surface.
extension DomainConfig {
    /// Appends `record` to `dns.managedRecords`, de-duplicating an exact repeat (case-insensitive
    /// `type`, exact `name`/`content`) so re-running an idempotent add-if-absent flow (e.g. the
    /// MTA-STS publish flow, which already skips the Cloudflare call for a matching record) never
    /// grows the file with a duplicate entry.
    func addingManagedDNSRecord(_ record: DomainConfig.DNSRecord) -> DomainConfig {
        var copy = self
        var existing = copy.dns?.managedRecords ?? []
        let isDuplicate = existing.contains {
            $0.type.caseInsensitiveCompare(record.type) == .orderedSame
                && $0.name == record.name && $0.content == record.content
        }
        guard !isDuplicate else { return copy }
        existing.append(record)
        copy.dns = DNS(managedRecords: existing)
        return copy
    }

    /// Removes every entry matching `type`/`name`/`content` (case-insensitive `type`) from
    /// `dns.managedRecords`. Matched by content triple, not a Cloudflare record ID — this schema
    /// deliberately never stores Cloudflare-assigned IDs (investigation doc §5.2 exclusion list).
    func removingManagedDNSRecord(type: String, name: String, content: String) -> DomainConfig {
        var copy = self
        guard var existing = copy.dns?.managedRecords else { return copy }
        existing.removeAll {
            $0.type.caseInsensitiveCompare(type) == .orderedSame
                && $0.name == name && $0.content == content
        }
        copy.dns = DNS(managedRecords: existing)
        return copy
    }
}

extension DomainConfig.Edge.CloudflareEdge {
    /// Appends `newRules` onto `existing`, de-duplicating exact repeats (`Equatable`) — the
    /// `edge.cloudflare.wafRules` counterpart to `DomainConfig.addingManagedDNSRecord`, needed
    /// because a second Harden run must not erase WAF rules an earlier run already declared.
    static func accumulatingWAFRules(
        _ newRules: [DomainConfig.Edge.WAFRule], onto existing: [DomainConfig.Edge.WAFRule]
    ) -> [DomainConfig.Edge.WAFRule] {
        var result = existing
        for rule in newRules where !result.contains(rule) {
            result.append(rule)
        }
        return result
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DomainConfigWriteThroughTests`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DomainConfigWriteThrough.swift Tests/AnglesiteCoreTests/DomainConfigWriteThroughTests.swift
git commit -m "feat(#1170): add DomainConfig array-merge write-through helpers"
```

---

## Task 2: `DomainOperationsService` protocol + `DomainOperations` write-through

**Files:**
- Modify: `Sources/AnglesiteCore/DomainOperationsService.swift`
- Modify: `Sources/AnglesiteCore/CloudflareWriting.swift` (add `comment` to `DNSRecordPayload`)
- Modify: `Sources/AnglesiteCore/HardenExecutor.swift` (its 4 direct `DNSRecordPayload(...)`
  call sites need the new initializer's parameter order to still compile — they already use
  labeled args so no change needed; just re-run tests to confirm)
- Test: `Tests/AnglesiteCoreTests/DomainOperationsServiceTests.swift` (extend)

**Interfaces:**
- Consumes: `DomainConfigStore` (`Sources/AnglesiteCore/DomainConfigStore.swift`, already on
  branch), `DomainConfig.addingManagedDNSRecord`/`removingManagedDNSRecord` (Task 1).
- Produces: `DomainOperationsService.addRecord(domain:type:name:content:ttl:priority:purpose:sourceDirectory:)`
  and `.deleteRecord(domain:recordID:type:name:content:sourceDirectory:)` as the protocol's
  *required* methods, plus two convenience overloads (no `purpose`/`sourceDirectory`/
  `type`/`name`/`content`) in a protocol extension matching the old signatures exactly — so
  `DomainIntents.swift`'s existing call sites keep compiling and behaving unchanged (Task 5
  confirms this). Consumed by Task 3 (`DomainModel`), Task 4 (`PlistEditorModel`), Task 7
  (`EmailSetupExecutor`).

- [ ] **Step 1: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/DomainOperationsServiceTests.swift` (inside `struct DomainOperationsServiceTests`):

```swift
    @Test("addRecord stamps a comment from purpose and writes dns.managedRecords")
    func addRecordWithPurposeWritesThroughAndStampsComment() async throws {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let result = await service(reader: reader, writer: writer).addRecord(
            domain: "example.com", type: "TXT", name: "_atproto", content: "did=abc", ttl: 1,
            priority: nil, purpose: "verification:bluesky", sourceDirectory: tmp)

        #expect(result == .success(()))
        #expect(writer.addedRecords == [
            DNSRecordPayload(type: "TXT", name: "_atproto", content: "did=abc", ttl: 1, priority: nil,
                             comment: "anglesite:verification:bluesky"),
        ])
        let config = try DomainConfigStore(sourceDirectory: tmp).load()
        #expect(config.dns?.managedRecords == [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ])
    }

    @Test("addRecord with no sourceDirectory does not write a file")
    func addRecordWithoutSourceDirectorySkipsWriteThrough() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer).addRecord(
            domain: "example.com", type: "TXT", name: "n", content: "c", ttl: 1, priority: nil,
            purpose: nil, sourceDirectory: nil)
        #expect(result == .success(()))
        #expect(writer.addedRecords == [DNSRecordPayload(type: "TXT", name: "n", content: "c", ttl: 1, priority: nil, comment: nil)])
    }

    @Test("addRecord short overload (no purpose/sourceDirectory) still succeeds")
    func addRecordShortOverloadStillWorks() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer)
            .addRecord(domain: "example.com", type: "TXT", name: "n", content: "c", ttl: 1, priority: nil)
        #expect(result == .success(()))
        #expect(writer.addedRecords == [DNSRecordPayload(type: "TXT", name: "n", content: "c", ttl: 1, priority: nil, comment: nil)])
    }

    @Test("deleteRecord with type/name/content removes the matching managedRecords entry")
    func deleteRecordWritesThroughRemoval() async throws {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let store = DomainConfigStore(sourceDirectory: tmp)
        try store.save(DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ])))

        let result = await service(reader: reader, writer: writer).deleteRecord(
            domain: "example.com", recordID: "r1", type: "TXT", name: "_atproto", content: "did=abc",
            sourceDirectory: tmp)

        #expect(result == .success(()))
        let config = try store.load()
        #expect(config.dns?.managedRecords?.isEmpty == true)
    }

    @Test("deleteRecord short overload (no write-through args) still succeeds")
    func deleteRecordShortOverloadStillWorks() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer).deleteRecord(domain: "example.com", recordID: "r1")
        #expect(result == .success(()))
        #expect(writer.deletedRecordIDs == ["r1"])
    }
```

`FakeWriter` (defined lower in this same test file) already captures both `addedRecords` and
`deletedRecordIDs` — no fixture changes needed, only the new test functions above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DomainOperationsServiceTests`
Expected: FAIL to compile — new `addRecord`/`deleteRecord` overloads and `DNSRecordPayload.comment` don't exist yet.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/CloudflareWriting.swift`, add a `comment` field to `DNSRecordPayload`:

```swift
public struct DNSRecordPayload: Sendable, Equatable, Encodable {
    public let type: String
    public let name: String
    public let content: String
    public let ttl: Int
    public let priority: Int?
    /// Cloudflare's free-text `comment` field, stamped by ``DomainOperations/addRecord(domain:type:name:content:ttl:priority:purpose:sourceDirectory:)``
    /// as `"anglesite:<purpose>"` when the caller supplies a purpose (#1170) — lets reconciliation
    /// join a declared `anglesite.json` record to its live Cloudflare counterpart (investigation
    /// doc §5.3). `nil` — the default — omits the key entirely (synthesized `Encodable` uses
    /// `encodeIfPresent`), matching every other optional field here.
    public let comment: String?

    public init(type: String, name: String, content: String, ttl: Int = 1, priority: Int? = nil, comment: String? = nil) {
        self.type = type
        self.name = name
        self.content = content
        self.ttl = ttl
        self.priority = priority
        self.comment = comment
    }
}
```

In `Sources/AnglesiteCore/DomainOperationsService.swift`, change the protocol and `DomainOperations`:

```swift
public protocol DomainOperationsService: Sendable {
    func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError>

    /// `purpose` is a namespaced tag (e.g. `"email:icloud"`, `"verification:bluesky"`) mirrored
    /// into the live record's Cloudflare `comment` field as `"anglesite:<purpose>"` and, when
    /// `sourceDirectory` is non-nil, appended to `Source/anglesite.json`'s `dns.managedRecords`
    /// (#1170) — both nil for a generic owner-added record with no specific purpose.
    /// `sourceDirectory` is nil for callers with no local site context (Siri/Shortcuts intents),
    /// which skip the write-through entirely rather than failing.
    func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
        purpose: String?, sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError>

    /// `type`/`name`/`content` (the record being deleted, as previously returned from
    /// ``listRecords(domain:)``) let the write-through remove the matching
    /// `dns.managedRecords` entry when `sourceDirectory` is non-nil; omit all four (or use the
    /// convenience overload below) to delete with no write-through.
    func deleteRecord(
        domain: String, recordID: String, type: String?, name: String?, content: String?,
        sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError>
}

extension DomainOperationsService {
    /// Convenience overload for callers with no purpose tag or local site context — equivalent
    /// to `purpose: nil, sourceDirectory: nil`. Not a protocol requirement, so it dispatches
    /// statically; existing callers (`DomainIntents`) that call this exact shape keep behaving
    /// identically to before #1170.
    public func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?
    ) async -> Result<Void, DomainOperationError> {
        await addRecord(domain: domain, type: type, name: name, content: content, ttl: ttl,
                        priority: priority, purpose: nil, sourceDirectory: nil)
    }

    /// Convenience overload mirroring `addRecord`'s — deletes with no write-through.
    public func deleteRecord(domain: String, recordID: String) async -> Result<Void, DomainOperationError> {
        await deleteRecord(domain: domain, recordID: recordID, type: nil, name: nil, content: nil, sourceDirectory: nil)
    }
}
```

Update `DomainOperations`'s two methods (keep everything else in the file — `resolveZone`,
`listRecords`, `init`, `defaultTokenProvider` — unchanged):

```swift
    public func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
        purpose: String?, sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                let payload = DNSRecordPayload(
                    type: type, name: name, content: content, ttl: ttl, priority: priority,
                    comment: purpose.map { "anglesite:\($0)" })
                try await writer.addDNSRecord(zoneID: zoneID, record: payload, apiToken: token)
                if let sourceDirectory {
                    Self.writeThroughAdd(
                        type: type, name: name, content: content, priority: priority,
                        purpose: purpose, sourceDirectory: sourceDirectory)
                }
                return .success(())
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }

    public func deleteRecord(
        domain: String, recordID: String, type: String?, name: String?, content: String?,
        sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        switch await resolveZone(domain: domain, token: token) {
        case .failure(let error):
            return .failure(error)
        case .success(let zoneID):
            do {
                try await writer.deleteDNSRecord(zoneID: zoneID, recordID: recordID, apiToken: token)
                if let sourceDirectory, let type, let name, let content {
                    Self.writeThroughRemove(type: type, name: name, content: content, sourceDirectory: sourceDirectory)
                }
                return .success(())
            } catch let error as CloudflareError {
                return .failure(.cloudflare(error))
            } catch {
                return .failure(.cloudflare(.malformedResponse))
            }
        }
    }

    /// Best-effort: a write-through failure (disk full, permissions, a hand-corrupted file) must
    /// never turn an already-successful Cloudflare write into a reported failure — matches
    /// `CustomDomainAttachCommand`'s posture for the same reason.
    private static func writeThroughAdd(
        type: String, name: String, content: String, priority: Int?, purpose: String?, sourceDirectory: URL
    ) {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        let current = (try? store.load()) ?? DomainConfig()
        let updated = current.addingManagedDNSRecord(
            .init(type: type, name: name, content: content, priority: priority, purpose: purpose))
        try? store.save(updated)
    }

    private static func writeThroughRemove(type: String, name: String, content: String, sourceDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        let current = (try? store.load()) ?? DomainConfig()
        let updated = current.removingManagedDNSRecord(type: type, name: name, content: content)
        try? store.save(updated)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DomainOperationsServiceTests`
Expected: PASS (all existing + 5 new tests).

Then run the full suite once to catch any other conformer of `DomainOperationsService` that
needs updating: `swift test --package-path . 2>&1 | tail -80`. Expect compile failures in
`Tests/AnglesiteIntentsTests/DomainIntentsTests.swift` (`FakeDomainOps`) and
`Tests/AnglesiteAppTests/PlistEditorModelMTAStsTests.swift` (`RecordingDNS`) — those are fixed
in Task 5 and Task 4 respectively. Confirm no *other* file fails to compile.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DomainOperationsService.swift Sources/AnglesiteCore/CloudflareWriting.swift Tests/AnglesiteCoreTests/DomainOperationsServiceTests.swift
git commit -m "feat(#1170): write DNS add/delete through to anglesite.json"
```

---

## Task 3: `DomainModel` + `SiteWindowModel` wiring (Domain sheet)

**Files:**
- Modify: `Sources/AnglesiteApp/DomainModel.swift`
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (~line 1918, alongside
  `cleanup.configure(site: currentSite)`)
- Test: `Tests/AnglesiteAppTests/DomainModelTests.swift` (new file — no existing tests for
  `DomainModel` today)

**Interfaces:**
- Consumes: `DomainOperationsService.addRecord(...purpose:sourceDirectory:)` /
  `.deleteRecord(...sourceDirectory:)` (Task 2), `CurrentSite` (`Sources/AnglesiteApp/CurrentSite.swift`,
  unchanged), `DomainConfigStore` (for test assertions).
- Produces: `DomainModel.configure(site: CurrentSite)`, called from `SiteWindowModel.loadAndStart`.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteAppTests/DomainModelTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteApp
@testable import AnglesiteCore

@MainActor
@Suite struct DomainModelTests {
    private actor RecordingOps: DomainOperationsService {
        var addedPurposes: [String?] = []
        var addedSourceDirectories: [URL?] = []
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            addedPurposes.append(purpose)
            addedSourceDirectories.append(sourceDirectory)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            .success(())
        }
    }

    @Test func submitAddRecordWithBlueskyContextWritesThroughWithPurpose() async throws {
        let ops = RecordingOps()
        let model = DomainModel(ops: ops)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        model.configure(site: CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp))

        model.domainInput = "example.com"
        model.resolveAndLoad()
        // `while model.isRunning { await Task.yield() }` is this codebase's established pattern
        // for driving a Task-spawning `@Observable` model to completion in tests — see e.g.
        // `Tests/AnglesiteAppTests/OnionRoutingModelTests.swift`. `listRecords` returns
        // `.success([])` synchronously-fast, so this settles onto `.loaded` quickly.
        while model.isRunning { await Task.yield() }

        model.beginAddRecord(context: .bluesky)
        model.updateDraft(.init(type: "TXT", name: "_atproto", content: "did=abc", ttl: 1, priority: nil, context: .bluesky))
        model.submitAddRecord()
        while model.isRunning { await Task.yield() }

        #expect(await ops.addedPurposes == ["verification:bluesky"])
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter DomainModelTests`
Expected: FAIL to compile — `DomainModel.configure(site:)` doesn't exist, and `RecordingOps`
doesn't satisfy the new protocol shape until Task 2 lands (run this after Task 2 is committed).

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteApp/DomainModel.swift`, add a `purpose` computed property to
`Draft.Context`, a `currentSite` property + `configure(site:)`, and thread it through `runAdd`/`runDelete`:

```swift
    struct Draft: Equatable {
        enum Context: Equatable {
            case generic, bluesky, google

            /// The `dns.managedRecords` purpose tag for a record added in this context — `nil`
            /// for `.generic` (an owner-typed record with no specific reason the app can name),
            /// matching the schema's "purpose is optional" contract (#1170).
            var purpose: String? {
                switch self {
                case .generic: return nil
                case .bluesky: return "verification:bluesky"
                case .google: return "verification:google"
                }
            }
        }
        ...
```

Add near the top of the class body, alongside `private let ops`:

```swift
    private(set) var currentSite: CurrentSite?

    /// Threaded from `SiteWindowModel.loadAndStart` (#822 pattern) so add/delete can write
    /// through to `Source/anglesite.json` (#1170). Not passed to `init` because `harden`/`domain`
    /// are constructed before the site resolves (`SiteWindowModel`'s `var domain = DomainModel()`).
    func configure(site: CurrentSite) {
        currentSite = site
    }
```

Update `runAdd`/`runDelete`:

```swift
    private func runAdd(draft: Draft, domain: String) async {
        phase = .applying(domain: domain)
        let result = await ops.addRecord(
            domain: domain, type: draft.type, name: draft.name, content: draft.content,
            ttl: draft.ttl, priority: draft.priority, purpose: draft.context.purpose,
            sourceDirectory: currentSite?.sourceDirectory)
        switch result {
        case .success:
            await runLoad(domain: domain)
        case .failure(let error):
            phase = .failed(reason: message(for: error, domain: domain))
        }
    }

    private func runDelete(record: DNSRecord, domain: String) async {
        phase = .applying(domain: domain)
        switch await ops.deleteRecord(
            domain: domain, recordID: record.id, type: record.type, name: record.name,
            content: record.content, sourceDirectory: currentSite?.sourceDirectory
        ) {
        case .success:
            await runLoad(domain: domain)
        case .failure(let error):
            phase = .failed(reason: message(for: error, domain: domain))
        }
    }
```

In `Sources/AnglesiteApp/SiteWindowModel.swift`, in `loadAndStart` near the existing
`cleanup.configure(site: currentSite)` / `reader.configure(site: currentSite)` block, add:

```swift
        domain.configure(site: currentSite)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter DomainModelTests`
Expected: PASS. Then `swift test --package-path .` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/DomainModel.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteAppTests/DomainModelTests.swift
git commit -m "feat(#1170): wire Domain sheet writes through to anglesite.json"
```

---

## Task 4: `PlistEditorModel` MTA-STS write-through

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift` (the `publishMtaStsDNSRecords()` call
  site at ~line 708; `sourceDirectory` is already a stored property on this model, line 9)
- Modify: `Tests/AnglesiteAppTests/PlistEditorModelMTAStsTests.swift` (`RecordingDNS` fake needs
  the new protocol shape)

**Interfaces:**
- Consumes: `DomainOperationsService.addRecord(...purpose:sourceDirectory:)` (Task 2).

- [ ] **Step 1: Update the failing fake and add an assertion**

In `Tests/AnglesiteAppTests/PlistEditorModelMTAStsTests.swift`, change `RecordingDNS` to satisfy
the new protocol shape and capture the purpose:

```swift
    actor RecordingDNS: DomainOperationsService {
        var added: [(type: String, name: String, content: String)] = []
        var addedPurposes: [String?] = []
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            added.append((type, name, content))
            addedPurposes.append(purpose)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }
```

In the existing `publishDNS()` test (~line 56), which binds `let dns = RecordingDNS()` and later
reads `let added = await dns.added`, add right after that:

```swift
        #expect(await dns.addedPurposes.allSatisfy { $0 == "email:mta-sts" })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter PlistEditorModelMTAStsTests`
Expected: FAIL — `addedPurposes` is always `[nil]`, not `["email:mta-sts"]`, until Step 3 lands.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteApp/PlistEditorModel.swift`, update the `addRecord` call inside
`publishMtaStsDNSRecords()` (~line 708):

```swift
                switch await domainOperations.addRecord(
                    domain: domain, type: "TXT", name: record.name, content: record.content, ttl: 1,
                    priority: nil, purpose: "email:mta-sts", sourceDirectory: sourceDirectory
                ) {
```

(`sourceDirectory` is `self.sourceDirectory`, already a stored property — no other change needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter PlistEditorModelMTAStsTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorModel.swift Tests/AnglesiteAppTests/PlistEditorModelMTAStsTests.swift
git commit -m "feat(#1170): tag MTA-STS DNS records and write them through"
```

---

## Task 5: `DomainIntents` test fakes updated for the new protocol shape

**Files:**
- Modify: `Tests/AnglesiteIntentsTests/DomainIntentsTests.swift` (`FakeDomainOps` only —
  `Sources/AnglesiteIntents/DomainIntents.swift` needs **no changes**: its `svc.addRecord(...)`/
  `svc.deleteRecord(...)` calls already match the short convenience-overload shape from Task 2,
  which resolves to `purpose: nil, sourceDirectory: nil` — Siri/Shortcuts intents have no local
  site path to write through to, and that's unchanged by this slice.)

**Interfaces:**
- Consumes: `DomainOperationsService` (Task 2's new required shape).

- [ ] **Step 1: Confirm the test currently fails to compile**

Run: `swift test --package-path . --filter DomainIntentsTests 2>&1 | tail -40`
Expected: compile error — `FakeDomainOps` doesn't conform to `DomainOperationsService` (missing
the new required `addRecord(...purpose:sourceDirectory:)` / `deleteRecord(...sourceDirectory:)`).

- [ ] **Step 2: Update `FakeDomainOps`**

In `Tests/AnglesiteIntentsTests/DomainIntentsTests.swift` (bottom of the file, ~line 95), change
only the two method signatures — every stored property and capture body stays exactly as-is:

```swift
final class FakeDomainOps: DomainOperationsService, @unchecked Sendable {
    private let records: [DNSRecord]
    private let listError: DomainOperationError?
    private(set) var addedRecords: [(name: String, type: String, priority: Int?)] = []
    private(set) var deletedRecordIDs: [String] = []

    init(records: [DNSRecord] = [], listError: DomainOperationError? = nil) {
        self.records = records
        self.listError = listError
    }

    func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> {
        if let listError { return .failure(listError) }
        return .success(records)
    }
    func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
        purpose: String?, sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        addedRecords.append((name: name, type: type, priority: priority))
        return .success(())
    }
    func deleteRecord(
        domain: String, recordID: String, type: String?, name: String?, content: String?,
        sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        deletedRecordIDs.append(recordID)
        return .success(())
    }
}
```

The file already `import Foundation`s, so `URL` resolves with no import changes needed.

- [ ] **Step 3: Run tests to verify they pass**

Run: `swift test --package-path . --filter DomainIntentsTests`
Expected: PASS, no behavior change (this task is pure test-fixture upkeep).

- [ ] **Step 4: Commit**

```bash
git add Tests/AnglesiteIntentsTests/DomainIntentsTests.swift
git commit -m "test(#1170): update DomainIntents fake for new DomainOperationsService shape"
```

---

## Task 6: `HardenExecutor` write-through (edge hardening) + `HardenModel` wiring

**Files:**
- Modify: `Sources/AnglesiteCore/HardenExecutor.swift`
- Modify: `Sources/AnglesiteApp/HardenModel.swift`
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (~line 1918, alongside `domain.configure(...)`
  added in Task 3)
- Test: `Tests/AnglesiteCoreTests/HardenExecutorTests.swift` (extend)

**Interfaces:**
- Consumes: `DomainConfigStore`, `DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules(_:onto:)`
  (Task 1), `CurrentSite` (unchanged).
- Produces: `HardenExecutor.execute(plan:zoneID:domain:apiToken:sourceDirectory:)` (new
  defaulted `sourceDirectory: URL? = nil` param — existing call sites with 4 args keep
  compiling), `HardenModel.configure(site: CurrentSite)`.

- [ ] **Step 1: Write the failing test**

Append to `Tests/AnglesiteCoreTests/HardenExecutorTests.swift`:

```swift
    @Test("execute writes the applied plan into anglesite.json's edge section")
    func executeWritesThroughEdge() async throws {
        let writer = MockCloudflareWriter()
        let exec = HardenExecutor(reader: MockCloudflareReader(), writer: writer)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let plan = HardenPlan(items: [
            .enableDNSSEC,
            .enableAlwaysUseHTTPS,
            .enableHSTS(maxAge: 31_536_000, includeSubdomains: true, preload: false),
            .enableBotFightMode,
            .addWAFRule(description: "Block dotfiles", expression: "(x)", action: "block"),
        ])
        _ = await exec.execute(plan: plan, zoneID: "z", domain: "example.com", apiToken: "t", sourceDirectory: tmp)

        let config = try DomainConfigStore(sourceDirectory: tmp).load()
        #expect(config.edge?.dnssec == true)
        #expect(config.edge?.alwaysUseHTTPS == true)
        #expect(config.edge?.hsts == .init(maxAge: 31_536_000, includeSubdomains: true, preload: false))
        #expect(config.edge?.cloudflare?.botFightMode == true)
        #expect(config.edge?.cloudflare?.wafRules == [
            .init(description: "Block dotfiles", expression: "(x)", action: "block"),
        ])
    }

    @Test("execute with no sourceDirectory writes nothing")
    func executeWithoutSourceDirectorySkipsWriteThrough() async {
        let writer = MockCloudflareWriter()
        let exec = HardenExecutor(reader: MockCloudflareReader(), writer: writer)
        let result = await exec.execute(
            plan: HardenPlan(items: [.enableDNSSEC]), zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(result.appliedCount == 1)
    }

    @Test("a second execute accumulates WAF rules instead of replacing them")
    func executeAccumulatesWAFRulesAcrossRuns() async throws {
        let writer = MockCloudflareWriter()
        let exec = HardenExecutor(reader: MockCloudflareReader(), writer: writer)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        _ = await exec.execute(
            plan: HardenPlan(items: [.addWAFRule(description: "Block dotfiles", expression: "(x)", action: "block")]),
            zoneID: "z", domain: "example.com", apiToken: "t", sourceDirectory: tmp)
        _ = await exec.execute(
            plan: HardenPlan(items: [.addWAFRule(description: "Block xmlrpc", expression: "(y)", action: "block")]),
            zoneID: "z", domain: "example.com", apiToken: "t", sourceDirectory: tmp)

        let config = try DomainConfigStore(sourceDirectory: tmp).load()
        #expect(config.edge?.cloudflare?.wafRules?.count == 2)
    }
```

Check `HardenExecutorTests.swift`'s existing `MockCloudflareWriter` — if `.enableHSTS`/etc.
calls can be made to fail per-item in that mock, make sure this new test's mock configuration
lets all five items succeed (the default zero-configuration mock should already do this, matching
the existing `itemsDispatchCorrectly` test's usage).

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter HardenExecutorTests`
Expected: FAIL to compile — `execute(...sourceDirectory:)` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/HardenExecutor.swift`, change `execute`'s signature and body:

```swift
    public func execute(
        plan: HardenPlan,
        zoneID: String,
        domain: String,
        apiToken: String,
        sourceDirectory: URL? = nil
    ) async -> Result {
        var applied = 0
        var appliedItems: [HardenPlanItem] = []
        var failures: [ItemFailure] = []

        for item in plan.items {
            do {
                try await apply(item, zoneID: zoneID, domain: domain, apiToken: apiToken)
                applied += 1
                appliedItems.append(item)
            } catch {
                failures.append(.init(item: item, error: "\(error)"))
            }
        }

        if let sourceDirectory {
            Self.writeThroughEdge(appliedItems, sourceDirectory: sourceDirectory)
        }

        let findings: [AuditReport.Finding]
        var auditErr: String?
        do {
            let freshState = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: apiToken)
            let expectsMail = !freshState.mxRecords.isEmpty
                && !freshState.mxRecords.allSatisfy({ $0.trimmingCharacters(in: .whitespaces) == "." || $0.hasPrefix("0 .") })
            findings = SecurityAudit.evaluate(freshState, expectsMail: expectsMail)
        } catch {
            findings = []
            auditErr = "\(error)"
        }

        return Result(appliedCount: applied, failedItems: failures,
                      postAuditFindings: findings, auditError: auditErr)
    }

    /// Serializes exactly the successfully-applied items into `anglesite.json`'s `edge` section
    /// (#1170; the owner decision behind "exactly," not an aspirational target, is investigation
    /// doc §7.2). Best-effort — see `DomainOperations`'s identical write-through posture. DNS-record
    /// hardening items (`.addCAARecord`/`.addNullMX`/`.addSPFRejectAll`/`.addDMARCReject`) are
    /// intentionally not mirrored into `dns.managedRecords` here — this slice ties that array to
    /// `DomainOperations` specifically (see this file's own PR/issue for the scope note); tracking
    /// Harden's own DNS writes is left to a follow-up.
    private static func writeThroughEdge(_ items: [HardenPlanItem], sourceDirectory: URL) {
        guard !items.isEmpty else { return }
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        var edge = config.edge ?? DomainConfig.Edge()
        var cloudflareEdge = edge.cloudflare ?? DomainConfig.Edge.CloudflareEdge()
        var newWAFRules: [DomainConfig.Edge.WAFRule] = []

        for item in items {
            switch item {
            case .enableDNSSEC:
                edge.dnssec = true
            case .enableAlwaysUseHTTPS:
                edge.alwaysUseHTTPS = true
            case .enableHSTS(let maxAge, let subs, let preload):
                edge.hsts = .init(maxAge: maxAge, includeSubdomains: subs, preload: preload)
            case .enableBotFightMode:
                cloudflareEdge.botFightMode = true
            case .addWAFRule(let desc, let expr, let action):
                newWAFRules.append(.init(description: desc, expression: expr, action: action))
            case .addCAARecord, .addNullMX, .addSPFRejectAll, .addDMARCReject,
                 .enableSpeedBrain, .enableZstandardCompression, .enableECH, .enablePageShieldMonitoring:
                break
            }
        }

        if !newWAFRules.isEmpty {
            cloudflareEdge.wafRules = DomainConfig.Edge.CloudflareEdge.accumulatingWAFRules(
                newWAFRules, onto: cloudflareEdge.wafRules ?? [])
        }
        if cloudflareEdge.botFightMode != nil || cloudflareEdge.wafRules != nil {
            edge.cloudflare = cloudflareEdge
        }
        config.edge = edge
        try? store.save(config)
    }
```

The `switch` above is exhaustive against `HardenPlanItem`'s 13 cases as of this branch
(`Sources/AnglesiteCore/HardenPlan.swift`): `.enableDNSSEC`, `.addCAARecord`,
`.enableAlwaysUseHTTPS`, `.enableHSTS`, `.enableBotFightMode`, `.addNullMX`, `.addSPFRejectAll`,
`.addDMARCReject`, `.addWAFRule`, `.enableSpeedBrain`, `.enableZstandardCompression`,
`.enableECH`, `.enablePageShieldMonitoring` — the 5 named cases map to `edge` fields above; the
other 8 (4 DNS-record items + 4 edge toggles with no `DomainConfig.Edge` counterpart in this
schema version) fall into the shared `break` case. If the Swift compiler reports the `switch`
non-exhaustive, `HardenPlanItem` gained a case since this plan was written — add it to the
`break` branch unless it's a DNSSEC/HTTPS/HSTS/BotFightMode/WAF-shaped toggle, in which case it
needs its own `edge` mapping.

In `Sources/AnglesiteApp/HardenModel.swift`, add the same `currentSite`/`configure` pattern as
`DomainModel` (Task 3) and thread it into `runApply`:

```swift
    private(set) var currentSite: CurrentSite?

    /// Threaded from `SiteWindowModel.loadAndStart` (#822 pattern), mirroring `DomainModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }
```

```swift
    private func runApply(plan: HardenPlan, domain: String, zoneID: String) async {
        guard let token = apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found.")
            return
        }

        phase = .applying(plan: plan, domain: domain)

        let executor = HardenExecutor(reader: reader, writer: writer)
        let result = await executor.execute(
            plan: plan, zoneID: zoneID, domain: domain, apiToken: token,
            sourceDirectory: currentSite?.sourceDirectory)

        phase = .succeeded(result: HardenResult(
            appliedCount: result.appliedCount,
            failedItems: result.failedItems.map { .init(description: $0.item.description, error: $0.error) },
            postAuditFindings: result.postAuditFindings,
            auditError: result.auditError
        ))
    }
```

In `Sources/AnglesiteApp/SiteWindowModel.swift`, alongside `domain.configure(site: currentSite)`:

```swift
        harden.configure(site: currentSite)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter HardenExecutorTests`
Expected: PASS. Then `swift test --package-path .` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/HardenExecutor.swift Sources/AnglesiteApp/HardenModel.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteCoreTests/HardenExecutorTests.swift
git commit -m "feat(#1170): write applied Harden plan through to anglesite.json edge"
```

---

## Task 7: `CustomDomainAttachCommand` write-through (domain intent)

**Files:**
- Modify: `Sources/AnglesiteCore/CustomDomainAttachCommand.swift`
- Test: `Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift` (extend)

**Interfaces:**
- Consumes: `DomainConfigStore`, `NewSiteDomainChoice` (`Sources/AnglesiteCore/NewSiteDraft.swift`,
  unchanged).

- [ ] **Step 1: Write the failing test**

`Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift` already has a `makeSiteDir(config:)`
helper (writes a `.site-config` string into a fresh temp dir) and a `FakeCloudflareWriting` whose
`attachWorkersCustomDomain` result is settable via `.result`. Append a test using both, matching
the existing `confirmsFreshAttach()` test's fixture shape:

```swift
    @Test("attach() writes the domain intent into anglesite.json")
    func attachWritesThroughDomainIntent() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.attached)
        let command = CustomDomainAttachCommand(client: writer)

        _ = await command.attach(siteDirectory: dir, apiToken: "t")

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain?.hostname == "example.com")
        #expect(config.domain?.choice == "transfer")
        #expect(config.domain?.attach == true)
    }

    @Test("attach() writes the domain intent even when the zone isn't connected yet")
    func attachWritesThroughDomainIntentEvenWhenNotConnected() async throws {
        // domain.attach is intent, not confirmation (schema doc) — it should be declared as soon
        // as the owner's `.site-config` shows a transfer intent, before Cloudflare confirms
        // anything. `CF_DOMAIN_ATTACHED` (the confirmed-live receipt) stays absent either way.
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.zoneNotFound)
        let command = CustomDomainAttachCommand(client: writer)

        _ = await command.attach(siteDirectory: dir, apiToken: "t")

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain?.hostname == "example.com")
        #expect(config.domain?.attach == true)
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter CustomDomainAttachCommandTests`
Expected: FAIL — `config.domain` is `nil` (nothing writes it yet).

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/CustomDomainAttachCommand.swift`, call a new
`persistDomainIntent(hostname:siteDirectory:)` right after the initial guard succeeds (so it
runs on every `attach()` call that has a real transfer intent to declare, including the
"already confirmed, no network call" fast path a few lines below it):

```swift
        guard SiteConfigFile.value(forKey: "DOMAIN_CHOICE", in: config) == NewSiteDomainChoice.transfer.rawValue,
              let hostname = SiteConfigFile.value(forKey: "DOMAIN", in: config)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !hostname.isEmpty
        else { return .skipped }

        persistDomainIntent(hostname: hostname, siteDirectory: siteDirectory)

        // Already confirmed attached ...
```

Add the method near `persistAttached`:

```swift
    /// Mirrors the `.site-config` `DOMAIN_CHOICE`/`DOMAIN` intent this method already read above
    /// into `Source/anglesite.json`'s `domain` section (#1170) — `attach: true` records the
    /// owner's intent, distinct from `CF_DOMAIN_ATTACHED` in `.site-config`, which stays the
    /// confirmed-live receipt (`persistAttached`, below). Runs on every `attach()` call that has
    /// a transfer intent to declare, not just a freshly-successful one, so the declaration exists
    /// even before the domain is confirmed on the Cloudflare account. Best-effort, matching this
    /// type's existing posture for `persistAttached`.
    private func persistDomainIntent(hostname: String, siteDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: siteDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        config.domain = DomainConfig.Domain(
            hostname: hostname, choice: NewSiteDomainChoice.transfer.rawValue, attach: true)
        try? store.save(config)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter CustomDomainAttachCommandTests`
Expected: PASS. Then `swift test --package-path .` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CustomDomainAttachCommand.swift Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift
git commit -m "feat(#1170): write domain attach intent through to anglesite.json"
```

---

## Task 8: `EmailSetupExecutor` — the first producer for `email` + its DNS records

**Files:**
- Create: `Sources/AnglesiteCore/EmailSetupExecutor.swift`
- Test: `Tests/AnglesiteCoreTests/EmailSetupExecutorTests.swift`

**Scope note:** `EmailSetupPlanner` (`Sources/AnglesiteCore/EmailSetupPlanner.swift`) is a pure
planner with **no existing UI or apply path** — #769 tracks building its actual GUI front door
("a wizard off the Domain sheet"). This task builds the callable apply/write-through layer the
issue asks for (`Source/anglesite.json`'s first `email` producer), not the wizard UI — #769
remains open for that. This mirrors how #1169 shipped its store "inert" (nothing called the
writer yet); this task's `EmailSetupExecutor` is callable and tested, but nothing in the app UI
invokes it yet, same as before this task for the planner itself.

**Interfaces:**
- Consumes: `EmailSetupPlanner.DNSPlan`/`.Provider`/`.RecordTemplate` (unchanged),
  `DomainOperationsService.addRecord(...purpose:sourceDirectory:)` (Task 2), `DomainConfigStore`.
- Produces: `EmailSetupExecutor.apply(plan:domain:dmarcReportEmail:sourceDirectory:)`.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/EmailSetupExecutorTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct EmailSetupExecutorTests {
    private actor RecordingOps: DomainOperationsService {
        var addedPurposes: [String?] = []
        var addedTypes: [String] = []
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            addedPurposes.append(purpose)
            addedTypes.append(type)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }

    @Test func applyAddsEveryRecordTaggedWithProvider() async {
        let ops = RecordingOps()
        let plan = EmailSetupPlanner.dnsPlan(for: .fastmail, domain: "example.com", dmarcReportEmail: "me@example.com")
        let executor = EmailSetupExecutor(ops: ops)
        let result = await executor.apply(plan: plan, domain: "example.com", dmarcReportEmail: "me@example.com", sourceDirectory: nil)
        #expect(result.addedCount == plan.records.count)
        #expect(result.failures.isEmpty)
        let purposes = await ops.addedPurposes
        #expect(purposes.allSatisfy { $0 == "email:fastmail" })
    }

    @Test func applyWritesEmailSectionThrough() async throws {
        let ops = RecordingOps()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let plan = EmailSetupPlanner.dnsPlan(for: .icloudPlus, domain: "example.com", dmarcReportEmail: "me@example.com")
        let executor = EmailSetupExecutor(ops: ops)
        _ = await executor.apply(plan: plan, domain: "example.com", dmarcReportEmail: "me@example.com", sourceDirectory: tmp)

        let config = try DomainConfigStore(sourceDirectory: tmp).load()
        #expect(config.email?.provider == "icloud-plus")
        #expect(config.email?.dmarcReportEmail == "me@example.com")
        #expect(config.dns?.managedRecords?.count == plan.records.count)
    }

    @Test func applyContinuesPastPerRecordFailures() async {
        let ops = FailingOps()
        let plan = EmailSetupPlanner.dnsPlan(for: .zohoMail, domain: "example.com", dmarcReportEmail: "me@example.com")
        let executor = EmailSetupExecutor(ops: ops)
        let result = await executor.apply(plan: plan, domain: "example.com", dmarcReportEmail: "me@example.com", sourceDirectory: nil)
        #expect(result.addedCount == 0)
        #expect(result.failures.count == plan.records.count)
    }

    private actor FailingOps: DomainOperationsService {
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .failure(.noToken) }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter EmailSetupExecutorTests`
Expected: FAIL to compile — `EmailSetupExecutor` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```swift
import Foundation

/// Applies an `EmailSetupPlanner.DNSPlan` — the first `Source/anglesite.json` `email` producer
/// (#1170; the planner itself has no GUI front door yet, tracked separately by #769). Adds every
/// record in the plan through `DomainOperationsService`, tagging each with a
/// `"email:<provider>"` purpose (so the live Cloudflare record gets the matching `comment`, and
/// `dns.managedRecords` gets the entry), then declares the provider choice itself.
public struct EmailSetupExecutor: Sendable {
    private let ops: any DomainOperationsService

    /// `ops` is the same seam `DomainModel`/`DomainIntents` use — production callers should pass
    /// the live `DomainOperations()`.
    public init(ops: any DomainOperationsService) {
        self.ops = ops
    }

    /// One record from the plan that failed to add, paired with why.
    public struct RecordFailure: Sendable {
        public let record: EmailSetupPlanner.RecordTemplate
        public let error: DomainOperationError
        public init(record: EmailSetupPlanner.RecordTemplate, error: DomainOperationError) {
            self.record = record
            self.error = error
        }
    }

    /// The outcome of one ``apply(plan:domain:dmarcReportEmail:sourceDirectory:)`` run. Always
    /// returned, never thrown — a per-record Cloudflare failure doesn't abort the rest, mirroring
    /// `HardenExecutor.Result`.
    public struct Result: Sendable {
        public let addedCount: Int
        public let failures: [RecordFailure]
        public init(addedCount: Int, failures: [RecordFailure]) {
            self.addedCount = addedCount
            self.failures = failures
        }
    }

    /// Adds every record in `plan.records`, each tagged `"email:<provider.rawValue>"`, then
    /// declares `email.provider`/`email.dmarcReportEmail` in `Source/anglesite.json` when
    /// `sourceDirectory` is non-nil — written unconditionally (even if every record add failed):
    /// the provider/report-address choice is the owner's declared intent, independent of whether
    /// this particular apply run's DNS writes all landed (mirrors `domain.attach` being intent,
    /// not confirmation — investigation doc §5.2).
    public func apply(
        plan: EmailSetupPlanner.DNSPlan, domain: String, dmarcReportEmail: String, sourceDirectory: URL?
    ) async -> Result {
        var added = 0
        var failures: [RecordFailure] = []
        let purpose = "email:\(plan.provider.rawValue)"

        for record in plan.records {
            let result = await ops.addRecord(
                domain: domain, type: record.type, name: record.name, content: record.content,
                ttl: 1, priority: record.priority, purpose: purpose, sourceDirectory: sourceDirectory)
            switch result {
            case .success:
                added += 1
            case .failure(let error):
                failures.append(.init(record: record, error: error))
            }
        }

        if let sourceDirectory {
            let store = DomainConfigStore(sourceDirectory: sourceDirectory)
            var config = (try? store.load()) ?? DomainConfig()
            config.email = DomainConfig.Email(provider: plan.provider.rawValue, dmarcReportEmail: dmarcReportEmail)
            try? store.save(config)
        }

        return Result(addedCount: added, failures: failures)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter EmailSetupExecutorTests`
Expected: PASS. Then run the **full** suite: `swift test --package-path .`

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/EmailSetupExecutor.swift Tests/AnglesiteCoreTests/EmailSetupExecutorTests.swift
git commit -m "feat(#1170): add EmailSetupExecutor, first anglesite.json email producer"
```

---

## Task 9: Whole-branch verification + app build

**Files:** none (verification only).

- [ ] **Step 1: Full Swift test suite**

Run: `swift test --package-path .`
Expected: all suites PASS, including every test added in Tasks 1–8.

- [ ] **Step 2: App target build**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: builds clean. If it fails only on provisioning/signing (not on any file this plan
touched — `DomainModel.swift`, `HardenModel.swift`, `SiteWindowModel.swift`, `PlistEditorModel.swift`
are all `AnglesiteApp` target files, so a real compile error here is this plan's responsibility to
fix), record that as a pre-existing environment limitation in the PR's Test plan, matching how
PR #1178 reported it.

- [ ] **Step 3: Re-read the issue and confirm every bullet is covered**

Check off against issue #1170's body:
- [ ] `DomainOperations.addRecord`/`deleteRecord` (Domain sheet + DomainIntents) — Tasks 2, 3, 5.
- [ ] `HardenExecutor` — Task 6.
- [ ] `EmailSetupPlanner` apply path — Task 8.
- [ ] `CustomDomainAttachCommand` — Task 7.
- [ ] Record ownership stamping (`comment` field) — Task 2.
- [ ] Migration (`DOMAIN`/`DOMAIN_CHOICE` from `.site-config`) — covered as a byproduct of Task 7
      (see that task's doc comment on `persistDomainIntent`); confirm this reasoning still holds
      and, if a reviewer disagrees, file a follow-up rather than expanding this PR.

- [ ] **Step 4: No commit** — this task only verifies Tasks 1–8's commits.
