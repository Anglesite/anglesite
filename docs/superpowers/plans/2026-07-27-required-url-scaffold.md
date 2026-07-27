# Required `.url` fields collected at creation — Implementation Plan (#916)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Anglesite committing a schema-invalid bookmark/reply/like by collecting each type's required `.url` value in the New Collection sheet and validating it before the file is written.

**Architecture:** `ContentScaffold.renderEntry` gains a pure `fieldValues:` input; `NativeContentOperations.createTyped` validates required `.url` values at the write boundary and derives a dated slug from the URL for types with no title field; `NewCollectionEntrySheet` collects those URLs and drops the throwaway Title row for `reply`/`like`.

**Tech Stack:** Swift 6.4 / SwiftUI (macOS 27+), Swift Testing (`import Testing`, `@Suite`/`@Test`/`#expect`), SwiftPM for the `AnglesiteCore` targets, XcodeGen + `xcodebuild` for the app target.

**Spec:** [`docs/superpowers/specs/2026-07-27-required-url-scaffold-design.md`](../specs/2026-07-27-required-url-scaffold-design.md)

## Global Constraints

- **No new dependencies.** Apple frameworks only; new third-party deps need approval in an issue first (`CONTRIBUTING.md` ▸ Code guidelines).
- **Conventional commits, subject ≤ 72 characters**, referencing `(#916)`. Extra detail goes in the body, never the subject.
- **Work happens in this worktree only.** `cd` to the worktree before any git operation. Never touch the main checkout.
- **`Anglesite.xcodeproj` is gitignored and generated** from `project.yml` by `xcodegen generate`. Never edit or commit the project file.
- **Never `git add -A` / `git add .`** — the worktree contains gitignored generated resources. Stage the exact paths each step lists.
- **`renderEntry` stays pure** — no I/O, no `Date()` calls inside it; time always arrives via the `now` parameter.
- **Template `Resources/Template/src/content.config.ts` is NOT modified.** This is an app-only change; no paired sidecar PR.
- **Byte-compatibility:** with an empty `fieldValues`, `ContentScaffold.renderEntry` output must be byte-identical to today's. `MicropubContentCommitter` (`Sources/AnglesiteCore/MicropubContentCommitter.swift:118`) calls it with no field values and must be unaffected.
- **Existing tests are contracts.** Two of them are expected to change and are called out explicitly (Task 5 Step 1, Task 6 Step 3). Do not silence any other failing test — if one breaks, the implementation is wrong.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `Sources/AnglesiteCore/ContentFieldValidation.swift` | **New.** Sole owner of "is this an absolute URL" for content fields. | 1 |
| `Tests/AnglesiteCoreTests/ContentFieldValidationTests.swift` | **New.** Tests for the above. | 1 |
| `Sources/AnglesiteCore/ContentTypeRegistry.swift` | Adds `titleField` / `requiredURLFields` to `ContentTypeDescriptor` and owns `titleLikeFieldNames`. | 2 |
| `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` | Tests for the two new computed properties. | 2 |
| `Sources/AnglesiteCore/ContentScaffold.swift` | `renderEntry(fieldValues:)` + `slugFromURL`. Rendering only — no validation. | 3, 4 |
| `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift` | Tests for both. | 3, 4 |
| `Sources/AnglesiteCore/NativeContentOperations.swift` | The write boundary: validates and picks the slug. | 5 |
| `Tests/AnglesiteCoreTests/NativeContentOperationsTests.swift` | Tests for validation + slug precedence. | 5 |
| `Sources/AnglesiteCore/ContentCreationWorkflow.swift` | Threads `fieldValues` from the app down to the write boundary. | 6 |
| `Tests/AnglesiteCoreTests/ContentCreationWorkflowTests.swift` | Forwarding test + arity fix. | 6 |
| `Sources/AnglesiteApp/SiteWindowModel.swift` | App-side pass-through. | 7 |
| `Sources/AnglesiteApp/NewContentSheets.swift` | The sheet UI: URL rows, conditional Title row, Create enablement. | 7 |
| `Sources/AnglesiteApp/Localizable.xcstrings` | Generated catalog for the sheet's new string. | 8 |

Tasks 1–6 are `AnglesiteCore` (`swift test`-verifiable, Linux-portable). Task 7 is the app target (`xcodebuild` only — the app target has no CI-runnable hosted tests; see `CLAUDE.md` ▸ Build).

---

### Task 1: `ContentFieldValidation`

**Files:**
- Create: `Sources/AnglesiteCore/ContentFieldValidation.swift`
- Test: `Tests/AnglesiteCoreTests/ContentFieldValidationTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `public enum ContentFieldValidation { public static func isAbsoluteURL(_ value: String) -> Bool }` — used by Tasks 5 and 7.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/ContentFieldValidationTests.swift`:

```swift
// Tests/AnglesiteCoreTests/ContentFieldValidationTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContentFieldValidation")
struct ContentFieldValidationTests {
    @Test("isAbsoluteURL accepts http(s) URLs with a host")
    func acceptsAbsoluteURLs() {
        #expect(ContentFieldValidation.isAbsoluteURL("https://example.com"))
        #expect(ContentFieldValidation.isAbsoluteURL("https://example.com/blog/hello-world"))
        #expect(ContentFieldValidation.isAbsoluteURL("http://a.b/c?d=e#f"))
    }

    @Test("isAbsoluteURL rejects anything without a scheme and host")
    func rejectsNonAbsoluteURLs() {
        #expect(!ContentFieldValidation.isAbsoluteURL(""))
        #expect(!ContentFieldValidation.isAbsoluteURL("   "))
        #expect(!ContentFieldValidation.isAbsoluteURL("not a url"))
        #expect(!ContentFieldValidation.isAbsoluteURL("example.com"))
        #expect(!ContentFieldValidation.isAbsoluteURL("/relative/path"))
        #expect(!ContentFieldValidation.isAbsoluteURL("https:"))
        // A scheme with no host: parses, but yields no usable u-* microformat value.
        #expect(!ContentFieldValidation.isAbsoluteURL("mailto:a@b.c"))
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
swift test --package-path . --filter ContentFieldValidation
```

Expected: FAIL to **compile**, with `cannot find 'ContentFieldValidation' in scope`. (A compile failure is the correct red state here — the type doesn't exist yet.)

Note: `--filter` restricts what *runs*, not what *compiles*; the whole package still builds. If the build hangs with no output, a stale SwiftPM process is holding the `.build` lock — check `pgrep -fl swift-test` and kill the orphan.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/ContentFieldValidation.swift`:

```swift
// Sources/AnglesiteCore/ContentFieldValidation.swift
import Foundation

/// Value checks for `ContentTypeField` values, applied before a content entry is written to disk.
///
/// Scaffolding renders; this validates. Kept separate from `ContentScaffold` so the create path can
/// reject a bad value *before* asking for a render, and so the rules are testable on their own.
public enum ContentFieldValidation {
    /// Whether `value` is an absolute URL with a scheme **and** a non-empty host.
    ///
    /// Deliberately stricter than the template's `z.string().url()`, which accepts anything
    /// `new URL()` parses — including `mailto:` and other host-less schemes. A `.url` field feeds a
    /// `u-*` microformat property (`u-bookmark-of`, `u-in-reply-to`, `u-like-of`), which needs a
    /// dereferenceable target, so requiring a host is the useful rule. Anything accepted here is
    /// accepted by `z.string().url()`, so a value that passes never fails `astro check`.
    ///
    /// Mirrors the same host-not-just-scheme rule `IntegrationPlanner` applies to its `.url` fields.
    public static func isAbsoluteURL(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let components = URLComponents(string: trimmed),
              let scheme = components.scheme, !scheme.isEmpty,
              let host = components.host, !host.isEmpty
        else { return false }
        return true
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
swift test --package-path . --filter ContentFieldValidation
```

Expected: PASS, 2 tests.

If `"not a url"` unexpectedly passes, `URLComponents(string:)` accepted the space on this Foundation version — add an explicit `trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil` guard and re-run. Do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentFieldValidation.swift Tests/AnglesiteCoreTests/ContentFieldValidationTests.swift
git commit -m "feat(core): add absolute-URL validation for content fields (#916)"
```

---

### Task 2: Descriptor helpers

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift` (add to `ContentTypeDescriptor`)
- Modify: `Sources/AnglesiteCore/ContentScaffold.swift` (delete the private `titleLikeFieldNames`, point its two uses at the new home)
- Test: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ContentTypeDescriptor.titleField: ContentTypeField?`
  - `ContentTypeDescriptor.requiredURLFields: [ContentTypeField]`
  - `ContentTypeDescriptor.titleLikeFieldNames: Set<String>` (internal, module-scoped — `ContentScaffold` reads it)

- [ ] **Step 1: Write the failing test**

Append inside the existing `struct ContentTypeRegistryTests` in `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`:

```swift
    @Test("titleField finds the type's human-facing title field, or nil")
    func titleFieldPerType() throws {
        let registry = ContentTypeRegistry()
        let bookmark = try #require(registry.descriptor(id: "bookmark"))
        let event = try #require(registry.descriptor(id: "event"))
        let review = try #require(registry.descriptor(id: "review"))
        let reply = try #require(registry.descriptor(id: "reply"))
        let like = try #require(registry.descriptor(id: "like"))

        #expect(bookmark.titleField?.name == "title")
        #expect(event.titleField?.name == "name")
        #expect(review.titleField?.name == "itemReviewed")
        // reply and like are identified by their target URL, not by a name (#916).
        #expect(reply.titleField == nil)
        #expect(like.titleField == nil)
    }

    @Test("requiredURLFields lists required .url fields in declaration order")
    func requiredURLFieldsPerType() throws {
        let registry = ContentTypeRegistry()
        let bookmark = try #require(registry.descriptor(id: "bookmark"))
        let reply = try #require(registry.descriptor(id: "reply"))
        let like = try #require(registry.descriptor(id: "like"))
        let note = try #require(registry.descriptor(id: "note"))

        #expect(bookmark.requiredURLFields.map(\.name) == ["bookmarkOf"])
        #expect(reply.requiredURLFields.map(\.name) == ["inReplyTo"])
        #expect(like.requiredURLFields.map(\.name) == ["likeOf"])
        // `audience` is an optional .url, so it must not appear here.
        #expect(note.requiredURLFields.isEmpty)
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
swift test --package-path . --filter ContentTypeRegistry
```

Expected: FAIL to compile — `value of type 'ContentTypeDescriptor' has no member 'titleField'`.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, add to `ContentTypeDescriptor` immediately after the existing `singletonSlot` computed property:

```swift
    /// Field names treated as a type's human-facing title, in no particular order. A descriptor
    /// declares at most one of these; `ContentScaffold` fills whichever it declares from the
    /// caller-supplied title (#386).
    static let titleLikeFieldNames: Set<String> = ["title", "name", "itemReviewed"]

    /// The field carrying this type's human-facing title, or `nil` when it has none. `reply` and
    /// `like` have none — they are identified by their target URL, not by a name — so the create
    /// UI hides the Title row for them and derives a slug from that URL instead (#916).
    public var titleField: ContentTypeField? {
        fields.first { Self.titleLikeFieldNames.contains($0.name) }
    }

    /// Required `.url` fields, in declaration order. The template schemas these project to are
    /// `z.string().url()`, which rejects an empty string, so the create path must collect a value
    /// for each one before writing rather than scaffolding a placeholder (#916).
    public var requiredURLFields: [ContentTypeField] {
        fields.filter { $0.kind == .url && $0.required }
    }
```

In `Sources/AnglesiteCore/ContentScaffold.swift`, delete the last line of the enum:

```swift
    private static let titleLikeFieldNames: Set<String> = ["title", "name", "itemReviewed"]
```

and update its two remaining uses — one in `renderEntry`, one in `renderSingleton` — replacing each

```swift
            titleLikeFieldNames.contains(field.name)
```

with

```swift
            ContentTypeDescriptor.titleLikeFieldNames.contains(field.name)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
swift test --package-path . --filter 'ContentTypeRegistry|ContentScaffold'
```

Expected: PASS. The existing `ContentScaffold` suite must be green and unchanged — this step moves a constant, it does not change any rendered output.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Sources/AnglesiteCore/ContentScaffold.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
git commit -m "refactor(core): add titleField/requiredURLFields to descriptors (#916)"
```

---

### Task 3: `renderEntry(fieldValues:)`

**Files:**
- Modify: `Sources/AnglesiteCore/ContentScaffold.swift` (`renderEntry`)
- Test: `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift`

**Interfaces:**
- Consumes: `ContentTypeDescriptor.titleLikeFieldNames` (Task 2).
- Produces: `ContentScaffold.renderEntry(descriptor:title:now:fieldValues:) -> String`, where `fieldValues` defaults to `[:]`. Used by Task 5.

- [ ] **Step 1: Write the failing test**

Append inside the existing `struct ContentScaffoldTests` in `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift`:

```swift
    @Test("renderEntry renders a supplied required .url value live and valid")
    func renderEntrySuppliedRequiredURL() throws {
        let like = try #require(ContentTypeRegistry().descriptor(id: "like"))
        let out = ContentScaffold.renderEntry(
            descriptor: like,
            title: nil,
            now: Date(timeIntervalSince1970: 1_750_000_000),
            fieldValues: ["likeOf": "https://example.com/post"])
        #expect(out.contains("likeOf: \"https://example.com/post\""))
        #expect(!out.contains("likeOf: \"\""))
    }

    @Test("a supplied optional .url value renders live instead of commented out")
    func renderEntrySuppliedOptionalURL() throws {
        let note = try #require(ContentTypeRegistry().descriptor(id: "note"))
        let now = Date(timeIntervalSince1970: 1_750_000_000)

        let withValue = ContentScaffold.renderEntry(
            descriptor: note, title: nil, now: now,
            fieldValues: ["audience": "https://example.com/friends"])
        #expect(withValue.contains("\naudience: \"https://example.com/friends\""))
        #expect(!withValue.contains("# audience:"))

        // An explicitly empty value is treated the same as no value: commented out (#913).
        let withEmpty = ContentScaffold.renderEntry(
            descriptor: note, title: nil, now: now, fieldValues: ["audience": ""])
        #expect(withEmpty.contains("# audience: \"\""))
    }

    @Test("renderEntry escapes a supplied value and ignores unknown field names")
    func renderEntrySuppliedValueEscaping() throws {
        let bookmark = try #require(ContentTypeRegistry().descriptor(id: "bookmark"))
        let out = ContentScaffold.renderEntry(
            descriptor: bookmark,
            title: "Title",
            now: Date(timeIntervalSince1970: 1_750_000_000),
            fieldValues: ["bookmarkOf": "https://example.com/a\"b", "notAField": "ignored"])
        #expect(out.contains("bookmarkOf: \"https://example.com/a\\\"b\""))
        #expect(!out.contains("notAField"))
    }

    @Test("an empty fieldValues reproduces the pre-#916 output for every collection type")
    func renderEntryEmptyFieldValuesIsUnchanged() {
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        for descriptor in ContentTypeRegistry.builtIns where descriptor.collection != nil {
            let withDefault = ContentScaffold.renderEntry(descriptor: descriptor, title: "Title", now: now)
            let withEmpty = ContentScaffold.renderEntry(
                descriptor: descriptor, title: "Title", now: now, fieldValues: [:])
            #expect(withDefault == withEmpty, "\(descriptor.id)")
            // Required .url fields still scaffold as an empty live line when nothing is supplied —
            // the create path (NativeContentOperations) is what refuses to write that, not the
            // renderer, which stays a pure formatter.
            for field in descriptor.requiredURLFields {
                #expect(withDefault.contains("\(field.name): \"\""), "\(descriptor.id).\(field.name)")
            }
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter ContentScaffold
```

Expected: FAIL to compile — `extra argument 'fieldValues' in call`.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/ContentScaffold.swift`, replace the `renderEntry` signature line:

```swift
    public static func renderEntry(descriptor: ContentTypeDescriptor, title: String?, now: Date) -> String {
```

with:

```swift
    public static func renderEntry(
        descriptor: ContentTypeDescriptor,
        title: String?,
        now: Date,
        fieldValues: [String: String] = [:]
    ) -> String {
```

Extend its doc comment (the three `///` lines directly above) with a fourth line:

```swift
    /// `fieldValues` supplies caller-collected values by field name for the scalar-string kinds
    /// (`.string`, `.text`, `.url`, `.image`); an absent key falls back to the title-like/empty
    /// default. Still pure — an empty `fieldValues` renders exactly what it rendered before (#916).
```

Replace the two scalar-string cases in the `switch field.kind` block:

```swift
            case .string, .text, .url, .image:
                let value = ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (title ?? "") : ""
                lines.append("\(field.name): \"\(escapeYAML(value))\"")
            // Optional `.url` fields scaffold commented-out: an emitted `""` is not a valid URL
            // under `z.string().url()`, unlike `.string`/`.text`/`.image`'s bare `z.string()`,
            // which accepts an empty string. Mirrors the `.datetime`/`.date` comment-out rationale
            // above. Required ones (bookmarkOf, inReplyTo, likeOf) stay live — those entries are
            // already incomplete without them, same as every other required field.
            case .url:
                let value = ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (title ?? "") : ""
                lines.append("\(field.required ? "" : "# ")\(field.name): \"\(escapeYAML(value))\"")
```

with:

```swift
            case .string, .text, .image:
                lines.append("\(field.name): \"\(escapeYAML(scalarValue(field, title: title, fieldValues: fieldValues)))\"")
            // A `.url` line is commented out only when the field is optional *and* nothing was
            // supplied: an emitted `""` is not a valid URL under `z.string().url()`, unlike
            // `.string`/`.text`/`.image`'s bare `z.string()`, which accepts an empty string.
            // Mirrors the `.datetime`/`.date` comment-out rationale above (#913). A supplied value
            // always renders live — that is how the create path pre-fills the required
            // `bookmarkOf`/`inReplyTo`/`likeOf` so a new entry is schema-valid on first write
            // (#916). Required fields with nothing supplied still render an empty live line; the
            // create path refuses to write that, keeping this function a pure formatter.
            case .url:
                let value = scalarValue(field, title: title, fieldValues: fieldValues)
                let isLive = field.required || !value.isEmpty
                lines.append("\(isLive ? "" : "# ")\(field.name): \"\(escapeYAML(value))\"")
```

Add this private helper immediately after `renderEntry`'s closing brace:

```swift
    /// The value for a scalar-string field: the caller's supplied value if there is one, otherwise
    /// the entry title for a title-like field, otherwise empty.
    private static func scalarValue(
        _ field: ContentTypeField,
        title: String?,
        fieldValues: [String: String]
    ) -> String {
        if let supplied = fieldValues[field.name] { return supplied }
        return ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (title ?? "") : ""
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
swift test --package-path . --filter ContentScaffold
```

Expected: PASS, including every pre-existing test in the suite — `renderEntryNote`, `optionalURLFieldsScaffoldCommented`, `renderEntryAlbumAndLike`, and `businessTypeFrontmatter` all still assert the no-`fieldValues` behavior and must stay green untouched.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentScaffold.swift Tests/AnglesiteCoreTests/ContentScaffoldTests.swift
git commit -m "feat(core): let renderEntry take caller-supplied field values (#916)"
```

---

### Task 4: `slugFromURL`

**Files:**
- Modify: `Sources/AnglesiteCore/ContentScaffold.swift`
- Test: `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift`

**Interfaces:**
- Consumes: `ContentScaffold.slugify` (already exists).
- Produces: `ContentScaffold.slugFromURL(_ value: String, now: Date) -> String`. Used by Task 5.

- [ ] **Step 1: Write the failing test**

Append inside `struct ContentScaffoldTests`:

```swift
    @Test("slugFromURL combines the UTC date, host, and last path segment")
    func slugFromURLShape() {
        // 1_750_000_000 == 2025-06-15T15:06:40Z
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        #expect(ContentScaffold.slugFromURL("https://example.com/blog/hello-world", now: now)
                == "2025-06-15-example-com-hello-world")
        #expect(ContentScaffold.slugFromURL("https://www.example.com/a/b/", now: now)
                == "2025-06-15-example-com-b")
        #expect(ContentScaffold.slugFromURL("https://example.com/", now: now)
                == "2025-06-15-example-com")
        #expect(ContentScaffold.slugFromURL("https://example.com", now: now)
                == "2025-06-15-example-com")
        // Query and fragment are not part of the slug.
        #expect(ContentScaffold.slugFromURL("https://example.com/post?utm=x#frag", now: now)
                == "2025-06-15-example-com-post")
    }

    @Test("slugFromURL returns empty for a value with no host, so callers can fall back")
    func slugFromURLNoHost() {
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        #expect(ContentScaffold.slugFromURL("", now: now).isEmpty)
        #expect(ContentScaffold.slugFromURL("not a url", now: now).isEmpty)
        #expect(ContentScaffold.slugFromURL("/relative/path", now: now).isEmpty)
        #expect(ContentScaffold.slugFromURL("mailto:a@b.c", now: now).isEmpty)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter ContentScaffold
```

Expected: FAIL to compile — `type 'ContentScaffold' has no member 'slugFromURL'`.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/ContentScaffold.swift`, add immediately after `postRelativePath`:

```swift
    /// Derive a slug from a target URL, for content types with no title field to slugify — `reply`
    /// and `like` are identified by what they point at, not by a name (#916).
    ///
    /// `yyyy-MM-dd` (UTC, same clock and formatter family `renderEntry` uses) + the host with a
    /// leading `www.` dropped + the last non-empty path component, all through `slugify`. Query and
    /// fragment are ignored. The date prefix keeps entries chronologically sortable and makes
    /// collisions practically impossible — two replies to the same URL on the same day — while
    /// keeping the permalink descriptive; it matches the IndieWeb convention for replies and likes.
    ///
    /// Returns `""` when `value` has no host, so callers fall back to their own default rather than
    /// producing a date-only slug that says nothing about the entry.
    public static func slugFromURL(_ value: String, now: Date) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              let host = components.host, !host.isEmpty
        else { return "" }

        let bareHost = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        let lastSegment = components.path
            .split(separator: "/", omittingEmptySubsequences: true)
            .last
            .map(String.init) ?? ""

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let day = String(formatter.string(from: now).prefix(10))

        return slugify([day, bareHost, lastSegment].filter { !$0.isEmpty }.joined(separator: "-"))
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
swift test --package-path . --filter ContentScaffold
```

Expected: PASS.

If `"not a url"` unexpectedly yields a non-empty slug, `URLComponents(string:)` accepted the space — that value has no host either way, so check the assertion that actually failed before changing anything.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentScaffold.swift Tests/AnglesiteCoreTests/ContentScaffoldTests.swift
git commit -m "feat(core): derive a dated slug from a target URL (#916)"
```

---

### Task 5: Validate and slug at the write boundary

**Files:**
- Modify: `Sources/AnglesiteCore/NativeContentOperations.swift` (`createTyped`, lines ~134–178)
- Test: `Tests/AnglesiteCoreTests/NativeContentOperationsTests.swift`

**Interfaces:**
- Consumes: `ContentFieldValidation.isAbsoluteURL` (Task 1), `ContentTypeDescriptor.requiredURLFields` (Task 2), `ContentScaffold.renderEntry(…fieldValues:)` (Task 3), `ContentScaffold.slugFromURL` (Task 4).
- Produces: `NativeContentOperations.createTyped(siteID:typeID:title:slug:fieldValues:registry:onProgress:)`, `fieldValues` defaulting to `[:]`. Used by Task 6.

- [ ] **Step 1: Update the one existing test this intentionally breaks**

`createTypedLike` in `Tests/AnglesiteCoreTests/NativeContentOperationsTests.swift` currently creates a like with no URL — exactly the #916 bug. Replace the whole test:

```swift
    @Test("createTyped writes a like to its collection and commits")
    func createTypedLike() async throws {
        let (ops, root, spy) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "like", title: "Cool post", slug: nil,
            fieldValues: ["likeOf": "https://example.com/post"])
        #expect(result == .created(filePath: "src/content/likes/cool-post.md", identifier: "cool-post"))
        let written = try String(
            contentsOf: root.appendingPathComponent("src/content/likes/cool-post.md"), encoding: .utf8)
        #expect(written.contains("likeOf: \"https://example.com/post\""))
        #expect(written.contains("publishDate:"))
        let calls = await spy.calls
        #expect(calls.count == 1)
        #expect(calls.first?.1 == "src/content/likes/cool-post.md")
        #expect(calls.first?.2 == "anglesite: add likes cool-post")
    }
```

- [ ] **Step 2: Write the failing tests**

Append inside `struct NativeContentOperationsTests`:

```swift
    @Test("createTyped refuses to write an entry missing a required .url value")
    func createTypedRejectsMissingRequiredURL() async {
        let (ops, root, spy) = makeOps()
        // The #916 regression guard: this is what the New Collection sheet used to do.
        let result = await ops.createTyped(siteID: "s1", typeID: "like", title: "Cool post", slug: nil)
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("likeOf"))
        #expect(!FileManager.default.fileExists(
            atPath: root.appendingPathComponent("src/content/likes/cool-post.md").path))
        let calls = await spy.calls
        #expect(calls.isEmpty)
    }

    @Test("createTyped refuses a required .url value that isn't an absolute URL")
    func createTypedRejectsMalformedRequiredURL() async {
        let (ops, root, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "bookmark", title: "Cool post", slug: nil,
            fieldValues: ["bookmarkOf": "example.com/post"])
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("bookmarkOf"))
        #expect(!FileManager.default.fileExists(
            atPath: root.appendingPathComponent("src/content/bookmarks/cool-post.md").path))
    }

    @Test("createTyped refuses a supplied optional .url value that isn't an absolute URL")
    func createTypedRejectsMalformedOptionalURL() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "note", title: "Hello", slug: nil,
            fieldValues: ["audience": "nope"])
        guard case let .failed(reason) = result else { Issue.record("expected .failed"); return }
        #expect(reason.contains("audience"))
    }

    @Test("createTyped writes a bookmark with its target URL live in the frontmatter")
    func createTypedBookmarkWritesURL() async throws {
        let (ops, root, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "bookmark", title: "Cool post", slug: nil,
            fieldValues: ["bookmarkOf": "https://example.com/blog/hello-world"])
        #expect(result == .created(filePath: "src/content/bookmarks/cool-post.md", identifier: "cool-post"))
        let written = try String(
            contentsOf: root.appendingPathComponent("src/content/bookmarks/cool-post.md"), encoding: .utf8)
        #expect(written.contains("bookmarkOf: \"https://example.com/blog/hello-world\""))
        #expect(written.contains("title: \"Cool post\""))
    }

    @Test("a titleless type with no title derives its slug from the target URL")
    func createTypedDerivesSlugFromURL() async {
        let (ops, _, spy) = makeOps()   // now == 2025-06-15T15:06:40Z
        let result = await ops.createTyped(
            siteID: "s1", typeID: "reply", title: "", slug: nil,
            fieldValues: ["inReplyTo": "https://example.com/blog/hello-world"])
        #expect(result == .created(
            filePath: "src/content/replies/2025-06-15-example-com-hello-world.md",
            identifier: "2025-06-15-example-com-hello-world"))
        let calls = await spy.calls
        #expect(calls.first?.2 == "anglesite: add replies 2025-06-15-example-com-hello-world")
    }

    @Test("an explicit slug still beats both the title and the URL")
    func createTypedExplicitSlugWins() async {
        let (ops, _, _) = makeOps()
        let result = await ops.createTyped(
            siteID: "s1", typeID: "reply", title: "", slug: "my-reply",
            fieldValues: ["inReplyTo": "https://example.com/blog/hello-world"])
        #expect(result == .created(filePath: "src/content/replies/my-reply.md", identifier: "my-reply"))
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
swift test --package-path . --filter NativeContentOperations
```

Expected: FAIL to compile — `extra argument 'fieldValues' in call`.

- [ ] **Step 4: Write the implementation**

In `Sources/AnglesiteCore/NativeContentOperations.swift`, change the `createTyped` signature from:

```swift
    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?,
        registry: ContentTypeRegistry = ContentTypeRegistry(),
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
```

to:

```swift
    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?,
        fieldValues: [String: String] = [:],
        registry: ContentTypeRegistry = ContentTypeRegistry(),
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
```

Extend its doc comment with:

```swift
    /// `fieldValues` carries values collected before the write (the New Collection sheet's URL
    /// rows). Every required `.url` field must have one that passes
    /// `ContentFieldValidation.isAbsoluteURL`, and any supplied optional `.url` must too — this is
    /// the boundary that makes a schema-invalid entry unwritable by *any* caller, not just the
    /// sheet (#916). Note the `ContentOperationsService` protocol witness above is title-only, so a
    /// non-native runtime cannot carry field values; unreachable today, and widening the protocol
    /// would ripple into `RemoteSandboxSiteRuntime` (#66) / `LocalContainerSiteRuntime` (#69) for no
    /// present benefit — same reasoning as the `createTypedSingleton` TODO below.
```

Insert this validation block immediately after the existing `guard let collection = descriptor.collection` block and before the `let cleanTitle` line:

```swift
        for field in descriptor.fields where field.kind == .url {
            let supplied = fieldValues[field.name]?.trimmingCharacters(in: .whitespacesAndNewlines)
            if field.required {
                guard let supplied, ContentFieldValidation.isAbsoluteURL(supplied) else {
                    return .failed(reason:
                        "\(descriptor.displayName) needs an absolute URL for \(field.name), "
                        + "e.g. https://example.com/post")
                }
            } else if let supplied, !supplied.isEmpty, !ContentFieldValidation.isAbsoluteURL(supplied) {
                return .failed(reason:
                    "\(field.name) must be an absolute URL, e.g. https://example.com/post")
            }
        }
```

Replace the three slug lines:

```swift
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSlug = (slug ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let finalSlug = ContentScaffold.slugify(cleanSlug.isEmpty ? (cleanTitle.isEmpty ? descriptor.id : cleanTitle) : cleanSlug)
```

with:

```swift
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSlug = (slug ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // Slug precedence: explicit → title → target URL → type id. The URL step is what gives
        // `reply`/`like` a meaningful permalink now that they no longer ask for a throwaway title
        // (#916); it uses the first required `.url` field in declaration order, which is the only
        // one each of bookmark/reply/like declares.
        let urlSlug = descriptor.requiredURLFields.first
            .flatMap { fieldValues[$0.name] }
            .map { ContentScaffold.slugFromURL($0, now: now()) } ?? ""
        let slugSource = [cleanSlug, cleanTitle, urlSlug].first { !$0.isEmpty } ?? descriptor.id
        let finalSlug = ContentScaffold.slugify(slugSource)
```

Finally, pass the values through to the renderer — change:

```swift
        let contents = ContentScaffold.renderEntry(
            descriptor: descriptor, title: cleanTitle.isEmpty ? nil : cleanTitle, now: now())
```

to:

```swift
        let contents = ContentScaffold.renderEntry(
            descriptor: descriptor, title: cleanTitle.isEmpty ? nil : cleanTitle, now: now(),
            fieldValues: fieldValues)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
swift test --package-path . --filter NativeContentOperations
```

Expected: PASS, including the pre-existing `createTypedUnknown` and `createTypedRejectsSingleton` (both fail before reaching the new validation, so their `.failed` reasons are unchanged).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/NativeContentOperations.swift Tests/AnglesiteCoreTests/NativeContentOperationsTests.swift
git commit -m "fix(core): require a valid URL before writing a typed entry (#916)"
```

---

### Task 6: Thread `fieldValues` through `ContentCreationWorkflow`

**Files:**
- Modify: `Sources/AnglesiteCore/ContentCreationWorkflow.swift` (`TypedSlugCreator` typealias ~line 17, the `native(…)` factory's `typedSlugCreator` closure ~line 105, and the `createTyped(…slug:)` overload ~line 213)
- Test: `Tests/AnglesiteCoreTests/ContentCreationWorkflowTests.swift`

**Interfaces:**
- Consumes: `NativeContentOperations.createTyped(…fieldValues:)` (Task 5).
- Produces:
  - `ContentCreationWorkflow.TypedSlugCreator = @Sendable (String, String, String, String?, [String: String], ProgressHandler?) async -> ContentCreateResult`
  - `ContentCreationWorkflow.createTyped(siteID:typeID:title:slug:fieldValues:onProgress:)`, `fieldValues` defaulting to `[:]`. Used by Task 7.

- [ ] **Step 1: Write the failing test**

Append inside `struct ContentCreationWorkflowTests` in `Tests/AnglesiteCoreTests/ContentCreationWorkflowTests.swift`:

```swift
    @Test("createTyped forwards fieldValues to the typed slug creator")
    func createTypedForwardsFieldValues() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let seen = SeenFieldValues()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: nil,
            siteDirectory: { _ in root },
            typedSlugCreator: { _, _, _, _, fieldValues, _ in
                await seen.record(fieldValues)
                return .created(filePath: "src/content/likes/x.md", identifier: "x")
            }
        )

        _ = await workflow.createTyped(
            siteID: Self.siteID, typeID: "like", title: "", slug: nil,
            fieldValues: ["likeOf": "https://example.com/post"])

        #expect(await seen.values == ["likeOf": "https://example.com/post"])
    }
```

and add this actor at file scope, next to the existing `private struct FakeCreateOperations`:

```swift
private actor SeenFieldValues {
    private(set) var values: [String: String] = [:]
    func record(_ v: [String: String]) { values = v }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
swift test --package-path . --filter ContentCreationWorkflow
```

Expected: FAIL to compile — `contextual closure type … expects 5 arguments, but 6 were used`.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/ContentCreationWorkflow.swift`, change the `TypedSlugCreator` typealias from:

```swift
    public typealias TypedSlugCreator = @Sendable (
        _ siteID: String,
        _ typeID: String,
        _ title: String,
        _ slug: String?,
        _ onProgress: ProgressHandler?
    ) async -> ContentCreateResult
```

to:

```swift
    public typealias TypedSlugCreator = @Sendable (
        _ siteID: String,
        _ typeID: String,
        _ title: String,
        _ slug: String?,
        _ fieldValues: [String: String],
        _ onProgress: ProgressHandler?
    ) async -> ContentCreateResult
```

In the `native(…)` factory, change the `typedSlugCreator` closure from:

```swift
            typedSlugCreator: { siteID, typeID, title, slug, onProgress in
                await native.createTyped(
                    siteID: siteID,
                    typeID: typeID,
                    title: title,
                    slug: slug,
                    onProgress: onProgress
                )
            },
```

to:

```swift
            typedSlugCreator: { siteID, typeID, title, slug, fieldValues, onProgress in
                await native.createTyped(
                    siteID: siteID,
                    typeID: typeID,
                    title: title,
                    slug: slug,
                    fieldValues: fieldValues,
                    onProgress: onProgress
                )
            },
```

Change the explicit-slug `createTyped` overload from:

```swift
    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?,
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result: ContentCreateResult
        if let typedSlugCreator {
            result = await typedSlugCreator(siteID, typeID, title, slug, onProgress)
        } else {
```

to:

```swift
    /// `fieldValues` carries values collected before the write (required `.url` fields — #916). It
    /// reaches `NativeContentOperations` only through `typedSlugCreator`; the `operations` fallback
    /// is the title-only `ContentOperationsService` witness and necessarily drops them.
    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?,
        fieldValues: [String: String] = [:],
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result: ContentCreateResult
        if let typedSlugCreator {
            result = await typedSlugCreator(siteID, typeID, title, slug, fieldValues, onProgress)
        } else {
```

Leave the rest of the method body unchanged.

Finally, fix the one pre-existing test closure that now has the wrong arity — in `createTypedRefreshesGraphAndKnowledgeIndex` (~line 161), change:

```swift
            typedSlugCreator: { siteID, typeID, title, slug, _ in
```

to:

```swift
            typedSlugCreator: { siteID, typeID, title, slug, _, _ in
```

- [ ] **Step 4: Run the full core suite to verify it passes**

```bash
swift test --package-path .
```

Expected: PASS, whole package. This is the first point where every core-side change is in place, so run the full suite rather than a filter.

Do not run this concurrently with another agent's `swift test` — parallel full-suite runs cause spurious FoundationModels failures and hangs.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentCreationWorkflow.swift Tests/AnglesiteCoreTests/ContentCreationWorkflowTests.swift
git commit -m "feat(core): thread field values through the create workflow (#916)"
```

---

### Task 7: Collect the URLs in the New Collection sheet

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (`createCollectionEntry`, ~line 1049)
- Modify: `Sources/AnglesiteApp/NewContentSheets.swift` (`NewCollectionEntrySheet`, lines 156–254)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (the `newCollectionPresented` sheet closure, ~line 700)

**Interfaces:**
- Consumes: `ContentCreationWorkflow.createTyped(…fieldValues:)` (Task 6), `ContentFieldValidation.isAbsoluteURL` (Task 1), `ContentTypeDescriptor.titleField` / `.requiredURLFields` (Task 2).
- Produces: nothing consumed by later tasks.

There is no CI-runnable test target for the app (hosted `xcodebuild test` can't launch a macOS-27 `.app` on CI runners — see `CLAUDE.md` ▸ Build), so this task is verified by a compiling build plus the manual GUI check in Step 6.

- [ ] **Step 1: Widen the model's pass-through**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, change `createCollectionEntry` from:

```swift
    func createCollectionEntry(
        title: String,
        slug: String?,
        descriptor: ContentTypeDescriptor
    ) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.createTyped(
            siteID: site.id,
            typeID: descriptor.id,
            title: title,
            slug: slug
        )
```

to:

```swift
    func createCollectionEntry(
        title: String,
        slug: String?,
        descriptor: ContentTypeDescriptor,
        fieldValues: [String: String] = [:]
    ) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.createTyped(
            siteID: site.id,
            typeID: descriptor.id,
            title: title,
            slug: slug,
            fieldValues: fieldValues
        )
```

Leave the rest of the method (the `.created` refresh + undo registration) unchanged.

- [ ] **Step 2: Widen the sheet's callback and add URL state**

In `Sources/AnglesiteApp/NewContentSheets.swift`, change `NewCollectionEntrySheet`'s stored properties and initializer from:

```swift
struct NewCollectionEntrySheet: View {
    let descriptors: [ContentTypeDescriptor]
    let onCreate: (String, String?, ContentTypeDescriptor) async -> ContentCreateResult

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var slug = ""
    @State private var selectedID: String
    @State private var isCreating = false
    @State private var errorMessage: String?

    init(
        descriptors: [ContentTypeDescriptor],
        onCreate: @escaping (String, String?, ContentTypeDescriptor) async -> ContentCreateResult
    ) {
```

to:

```swift
struct NewCollectionEntrySheet: View {
    let descriptors: [ContentTypeDescriptor]
    let onCreate: (String, String?, ContentTypeDescriptor, [String: String]) async -> ContentCreateResult

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var slug = ""
    @State private var selectedID: String
    /// Values for the selected type's required `.url` fields, keyed by field name. A bookmark,
    /// reply, or like is schema-invalid without one, so these are collected before the write rather
    /// than scaffolded empty (#916).
    @State private var urlValues: [String: String] = [:]
    @State private var isCreating = false
    @State private var errorMessage: String?

    init(
        descriptors: [ContentTypeDescriptor],
        onCreate: @escaping (String, String?, ContentTypeDescriptor, [String: String]) async -> ContentCreateResult
    ) {
```

- [ ] **Step 3: Render the URL rows and make Title conditional**

Still in `NewCollectionEntrySheet`, change the `Section("Collection Entry")` block from:

```swift
                    Section("Collection Entry") {
                        Picker("Type", selection: $selectedID) {
                            ForEach(descriptors) { descriptor in
                                Text(descriptor.displayName).tag(descriptor.id)
                            }
                        }
                        TextField("Title", text: $title)
                        TextField("Slug", text: $slug, prompt: Text("optional"))
                    }
```

to:

```swift
                    Section("Collection Entry") {
                        Picker("Type", selection: $selectedID) {
                            ForEach(descriptors) { descriptor in
                                Text(descriptor.displayName).tag(descriptor.id)
                            }
                        }
                        // A reply or like has no title field — it is identified by its target URL,
                        // so asking for a title would collect a value the entry never stores (#916).
                        if selectedDescriptor?.titleField != nil {
                            TextField("Title", text: $title)
                        }
                        // Field names match the inspector's labels in `TypedEntryForm`.
                        ForEach(requiredURLFields, id: \.name) { field in
                            TextField(
                                field.name,
                                text: urlBinding(field.name),
                                prompt: Text(verbatim: "https://example.com/post"))
                        }
                        TextField("Slug", text: $slug, prompt: Text("optional"))
                        if hasMalformedURL {
                            Text("Enter an absolute URL, e.g. https://example.com/post")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .onChange(of: selectedID) { urlValues = [:] }
```

Add these computed helpers immediately after the existing `selectedCollection` property:

```swift
    private var requiredURLFields: [ContentTypeField] {
        selectedDescriptor?.requiredURLFields ?? []
    }

    private func urlBinding(_ name: String) -> Binding<String> {
        Binding(get: { urlValues[name] ?? "" }, set: { urlValues[name] = $0 })
    }

    private func trimmedURL(_ name: String) -> String {
        (urlValues[name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Every required `.url` field holds a value the write boundary will accept.
    private var urlFieldsAreValid: Bool {
        requiredURLFields.allSatisfy { ContentFieldValidation.isAbsoluteURL(trimmedURL($0.name)) }
    }

    /// A field the user has started typing into that isn't a valid URL yet — drives the hint below
    /// the fields. Empty fields don't nag; they just leave Create disabled.
    private var hasMalformedURL: Bool {
        requiredURLFields.contains {
            let value = trimmedURL($0.name)
            return !value.isEmpty && !ContentFieldValidation.isAbsoluteURL(value)
        }
    }

    /// Types without a title field impose no title requirement.
    private var titleIsSatisfied: Bool {
        selectedDescriptor?.titleField == nil
            || !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
```

- [ ] **Step 4: Gate Create on the URLs and pass them through**

Still in `NewCollectionEntrySheet`, change the confirmation toolbar item's `.disabled` modifier from:

```swift
                    .disabled(isCreating || selectedCollection == nil || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
```

to:

```swift
                    .disabled(isCreating || selectedCollection == nil || !titleIsSatisfied || !urlFieldsAreValid)
```

and change `create()` from:

```swift
    private func create() {
        guard let descriptor = selectedDescriptor, selectedCollection != nil else { return }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSlug = slug.trimmingCharacters(in: .whitespacesAndNewlines)
        isCreating = true
        errorMessage = nil
        Task {
            let result = await onCreate(cleanTitle, cleanSlug.isEmpty ? nil : cleanSlug, descriptor)
```

to:

```swift
    private func create() {
        guard let descriptor = selectedDescriptor, selectedCollection != nil else { return }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSlug = slug.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanURLs = requiredURLFields.reduce(into: [String: String]()) { values, field in
            values[field.name] = trimmedURL(field.name)
        }
        isCreating = true
        errorMessage = nil
        Task {
            let result = await onCreate(
                cleanTitle, cleanSlug.isEmpty ? nil : cleanSlug, descriptor, cleanURLs)
```

Leave the rest of `create()` (the `MainActor.run` result switch) unchanged.

- [ ] **Step 5: Update the call site**

In `Sources/AnglesiteApp/SiteWindow.swift`, change the `newCollectionPresented` sheet closure from:

```swift
            ) { title, slug, descriptor in
                await model.createCollectionEntry(title: title, slug: slug, descriptor: descriptor)
            }
```

to:

```swift
            ) { title, slug, descriptor, fieldValues in
                await model.createCollectionEntry(
                    title: title, slug: slug, descriptor: descriptor, fieldValues: fieldValues)
            }
```

- [ ] **Step 6: Build and verify manually**

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Expected: `** BUILD SUCCEEDED **`.

If the project file is missing or stale (a fresh worktree, or `project.yml` changed), run `xcodegen generate` first. If the build fails with `vendor-node.sh: Operation not permitted`, the generated project picked up `ENABLE_USER_SCRIPT_SANDBOXING=YES` — re-run `xcodegen generate` and decline Xcode's "recommended settings" prompt. If it fails on "Check container resources", `rsync` `Resources/container-{image,kernel,initfs}` from the main checkout.

Then run the app and check **File ▸ New ▸ Collection Entry…**:

1. Select **Like** — the Title row is gone, an `likeOf` row is present, Create is disabled.
2. Type `example.com` into `likeOf` — the "Enter an absolute URL" hint appears, Create stays disabled.
3. Type `https://example.com/blog/hello-world` — the hint clears, Create enables.
4. Create it. The new file is `src/content/likes/<today>-example-com-hello-world.md` and its frontmatter has a live `likeOf: "https://example.com/blog/hello-world"`.
5. Switch the Picker to **Bookmark** — the Title row reappears and the `likeOf` value is cleared, replaced by an empty `bookmarkOf` row.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/NewContentSheets.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(ui): collect required URLs in the New Collection sheet (#916)"
```

---

### Task 8: Localization catalog and final verification

**Files:**
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (generated)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

Task 7 adds one new user-visible literal — `"Enter an absolute URL, e.g. https://example.com/post"` — and removes none (the `"Title"` row is conditionally hidden, not deleted). The catalog merge only happens in the Xcode IDE, so a CLI-only build needs the manual sync from `CONTRIBUTING.md`.

- [ ] **Step 1: Build, then sync the catalog**

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find ~/Library/Developer/Xcode/DerivedData/Anglesite-*/Build/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64 -name "*.stringsdata") \
  --skip-marking-strings-stale
```

`--skip-marking-strings-stale` is mandatory: without it, `sync` deletes any key absent from the given `.stringsdata` set, which can empty the whole 700+-key catalog.

- [ ] **Step 2: Review the catalog diff**

```bash
git diff --stat Sources/AnglesiteApp/Localizable.xcstrings
git diff Sources/AnglesiteApp/Localizable.xcstrings | head -60
```

Expected: a small diff adding the `"Enter an absolute URL, e.g. https://example.com/post"` key. If the diff is large or removes keys, discard it (`git checkout -- Sources/AnglesiteApp/Localizable.xcstrings`), run a clean build (`xcodebuild … clean build`), and re-sync before committing.

- [ ] **Step 3: Run the full verification set**

```bash
swift test --package-path .
```

Expected: PASS, whole package.

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Expected: `** BUILD SUCCEEDED **`.

```bash
scripts/check-localization-catalog.sh
```

Expected: PASS.

The JS overlay (`JS/edit-overlay/`) and `Resources/Template/` are untouched by this change, so their suites don't need running.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(l10n): sync string catalog for the URL hint (#916)"
```

- [ ] **Step 5: Open the PR**

Build the PR body from `.github/PULL_REQUEST_TEMPLATE.md`'s actual headings — **Summary**, **Paired PR check**, **Test plan** — not a generic Summary/Test-plan shape. Under **Paired PR check**, state that this is app-only: no MCP schema change and no `Resources/Template/` change, so no sibling PR in `Anglesite/anglesite` is needed.

```bash
git push -u origin claude/issue-916-beb1c1
gh issue edit 916 --remove-label "🛠️ In Progress"
```

Open the PR only after the push succeeds — an unpushed commit isn't in the PR.

---

## Notes for the implementer

- **`MicropubContentCommitter`** (`Sources/AnglesiteCore/MicropubContentCommitter.swift:118`) calls `renderEntry` with no `fieldValues`. It is deliberately left alone: the default `[:]` preserves its current output exactly. Micropub's own required-URL handling is a separate concern.
- **The `ContentOperationsService` protocol is not widened.** Its `createTyped(siteID:typeID:title:onProgress:)` witness stays title-only. After Task 5, calling *that* witness for a bookmark/reply/like returns `.failed` — which is correct (it can't supply a valid URL) and is what `createTypedRejectsMissingRequiredURL` locks in.
- **Collision behavior is unchanged.** Two replies to the same URL on the same day still hit the existing "A replies entry already exists at …" failure, which the sheet surfaces; the user types an explicit slug. Auto-suffixing was considered and left out of scope.
