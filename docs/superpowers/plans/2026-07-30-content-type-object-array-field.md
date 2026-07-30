# Repeating Structured-Group Field Kind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `ContentTypeField.Kind` case representing a repeating group of small structured records (e.g. an h-resume `experience` entry: title/org/start/end/description) so it round-trips through YAML frontmatter, the generic SwiftUI content editor, and the Zod-drift test — with no new content type or Astro rendering (that's issue #964's job once this primitive exists).

**Architecture:** Three existing layers each gain one new case, bottom-up:
1. `FrontmatterValue` (raw YAML shape) gains `.objectArray([[FrontmatterRecordField]])` — an ordered list of ordered name/value records. `FrontmatterDocument` gains parse/render support for the corresponding block-YAML shape (`  - field: value` / `    field2: value2`).
2. `ContentTypeField.Kind` gains `.objectArray(fields: [ContentTypeField])` — the schema: an ordered list of member fields, each an existing scalar `Kind`. This requires dropping `Kind`'s `String` raw-value backing (confirmed unused via `.rawValue`/`Kind(rawValue:)` grep — nothing depends on it), since Swift enums cannot mix raw values with associated values.
3. `TypedContentEditor.FieldValue` (UI-bound shape) gains `.records([[String: FieldValue]])`. `defaultValue`/`decode`/`encode` bridge all three layers using `Kind.objectArray`'s member-field list to know each record field's name and sub-`Kind`.

Every other exhaustive `switch`/`if case` over `ContentTypeField.Kind` (`ContentScaffold.renderEntry`/`renderSingleton`, `MicropubContentSync.fieldValue`, `TypedEntryEditorView.control(for:)`, and the test-only `ContentConfigDriftTests.zod(for:)`) gets a matching arm so the module keeps compiling. No built-in `ContentTypeDescriptor` declares `.objectArray` yet — this is pure plumbing; #964 registers the first real use.

**Tech Stack:** Swift 6.4, Swift Testing (`@Test`/`#expect`), SwiftUI (macOS 27+ `Form`).

## Global Constraints

- **No raw-value regression**: `ContentTypeField.Kind` drops `: String` — confirmed nothing reads `.rawValue` or calls `Kind(rawValue:)` anywhere in `Sources/`/`Tests/` (grepped). If a build error surfaces a use this plan missed, stop and re-grep before proceeding.
- **Member fields are scalar-only by convention, not by the type system**: `.objectArray(fields:)`'s `fields` should never itself contain `.stringArray`, `.imageArray`, `.markdown`, or a nested `.objectArray`. This is documented in a doc comment, matching this codebase's existing preference for convention-enforced invariants over new type machinery (e.g. `ContentTypeProjections`'s "object-valued property contract").
- **No Astro/rendering work** (`Resources/Template/src/layouts/`, mf2 output, JSON-LD) — out of scope per the issue; that's #964.
- **No new `ContentTypeDescriptor`** (no h-resume type) — out of scope per the issue; that's #964.
- **No changes to `Resources/Template/src/content.config.ts` / `content-schemas.ts`** — there is no new collection to declare (no descriptor uses `.objectArray` yet), so there is nothing to add to those files. The issue's mention of "the matching `z.array(z.object({...}))` shape" is satisfied by `ContentConfigDriftTests.zod(for:)` (Task 7) staying exhaustive and correct — that helper *is* this codebase's Swift-side stand-in for "what the hand-authored Zod schema should look like," since the Swift descriptor and the TS schema are independently hand-maintained (per the file's own doc comment) and there is no real collection yet to add a Zod block for.
- **`Frontmatter.parse` (the lightweight `list_content` scanner) is NOT updated** — its docstring already scopes it to "exactly" `title`/`slug`/`draft`/`publishDate`/`date`/`tags`, none of which will ever be `.objectArray`. Verified (Task 2) that an object-array field present in a scanned file degrades gracefully: the scanner's outer loop already skips indented continuation lines as non-top-level, so a misread `experience` field can't corrupt parsing of the fields callers actually read.
- Every new production code path gets a real `@Test`, per this repo's Swift Testing convention (`Tests/AnglesiteCoreTests/*Tests.swift`, `@Suite`/`@Test`/`#expect`).
- Run `swift test --package-path .` after each task; run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` after Task 8 (the only task touching `Sources/AnglesiteApp`) and again at the end.
- Commit after each task (Conventional Commits, subject ≤72 chars, reference **#1117**).

---

### Task 1: `FrontmatterValue.objectArray` + `FrontmatterRecordField` + serialization

**Files:**
- Modify: `Sources/AnglesiteCore/Frontmatter.swift:14-24` (the `FrontmatterValue` enum)
- Modify: `Sources/AnglesiteCore/FrontmatterDocument.swift:143-166` (`render(key:value:)`)
- Test: `Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift`

**Interfaces:**
- Produces: `public struct FrontmatterRecordField: Equatable, Sendable { public let name: String; public let value: FrontmatterValue; public init(_ name: String, _ value: FrontmatterValue) }` and `FrontmatterValue.objectArray([[FrontmatterRecordField]])` — consumed by Task 2 (parsing) and Task 4 (`TypedContentEditor`).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift` (inside `struct FrontmatterDocumentTests`, after the existing `appendsNewKey` test):

```swift
    @Test("setting an object-array value renders block-mapping-list YAML")
    func setObjectArray() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.objectArray([
            [FrontmatterRecordField("title", .string("Engineer")), FrontmatterRecordField("start", .date("2020-01-01"))],
            [FrontmatterRecordField("title", .string("Intern")), FrontmatterRecordField("start", .date("2018-06-01"))],
        ]), for: "experience")
        let out = doc.serialized()
        #expect(out.contains("""
        experience:
          - title: "Engineer"
            start: 2020-01-01
          - title: "Intern"
            start: 2018-06-01
        """))
    }

    @Test("setting an empty object-array value renders an inline empty array")
    func setEmptyObjectArray() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.objectArray([]), for: "experience")
        #expect(doc.serialized().contains("experience: []"))
    }

    @Test("an object-array record with no fields renders as an empty mapping item")
    func setObjectArrayEmptyRecord() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.objectArray([[]]), for: "experience")
        #expect(doc.serialized().contains("experience:\n  - {}"))
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter FrontmatterDocumentTests`
Expected: FAIL to compile — `FrontmatterRecordField` and `FrontmatterValue.objectArray` don't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/Frontmatter.swift`, replace the `FrontmatterValue` enum (lines 14–24) with:

```swift
public enum FrontmatterValue: Equatable, Sendable {
    case string(String)
    case bool(Bool)
    case array([String])
    case number(Double)
    /// A preformatted date scalar emitted **unquoted**. `s` must be a safe bare YAML scalar — no
    /// newlines, no `: ` (colon-space) sequences — because `FrontmatterDocument.render` emits it
    /// verbatim, unescaped. It is always produced by `TypedContentEditor.format()`
    /// (`ISO8601DateFormatter` output or its 10-char date-only prefix), which satisfies that.
    case date(String)
    /// A repeating group of small structured records — e.g. h-resume `experience` entries. Each
    /// inner `[FrontmatterRecordField]` is one record's fields in declared order; the outer array
    /// is the ordered list of records. Record field values are conventionally scalar (`.string`,
    /// `.bool`, `.number`, `.date`) — never `.array`/`.objectArray` — matching
    /// `ContentTypeField.Kind.objectArray`'s member-field restriction; nothing in this codebase
    /// constructs a nested shape, so `FrontmatterDocument.render`'s scalar renderer treats one as
    /// an empty fallback rather than recursing.
    case objectArray([[FrontmatterRecordField]])
}

/// One name/value pair inside a `FrontmatterValue.objectArray` record, in declaration order.
public struct FrontmatterRecordField: Equatable, Sendable {
    public let name: String
    public let value: FrontmatterValue
    public init(_ name: String, _ value: FrontmatterValue) {
        self.name = name
        self.value = value
    }
}
```

In `Sources/AnglesiteCore/FrontmatterDocument.swift`, replace the `render(key:value:)` function (lines 143–166) with:

```swift
    private static func render(key: String, value: FrontmatterValue) -> String {
        switch value {
        case .string(let s):
            return "\(key): \(Frontmatter.doubleQuoted(s))"
        case .bool(let b):
            // Bool fields canonicalize to true/false on write. YAML also accepts yes/no/on/off/1/0,
            // but we intentionally normalize here (matching ContentScaffold) — an edited bool loses
            // a non-canonical original spelling. Verbatim is still preserved for *unedited* bools.
            return "\(key): \(b)"
        case .number(let n):
            // Numbers serialize unquoted so YAML reads them as numbers (a quoted "4" fails a
            // collection's z.number() schema). Integral values drop the decimal point; the
            // magnitude guard avoids the Int(_:) overflow trap.
            return "\(key): \(formatNumber(n))"
        case .date(let s):
            // Already-formatted date scalar, emitted unquoted (matching ContentScaffold) so YAML
            // reads it as a date — a quoted scalar fails a non-coercing date schema.
            return "\(key): \(s)"
        case .array(let items):
            if items.isEmpty { return "\(key): []" }
            return ([ "\(key):" ] + items.map { "  - \(Frontmatter.doubleQuoted($0))" }).joined(separator: "\n")
        case .objectArray(let records):
            if records.isEmpty { return "\(key): []" }
            var lines = ["\(key):"]
            for record in records {
                if let first = record.first {
                    lines.append("  - \(first.name): \(renderScalar(first.value))")
                    for field in record.dropFirst() {
                        lines.append("    \(field.name): \(renderScalar(field.value))")
                    }
                } else {
                    lines.append("  - {}")
                }
            }
            return lines.joined(separator: "\n")
        }
    }

    private static func formatNumber(_ n: Double) -> String {
        (n == n.rounded() && abs(n) < 1e15) ? String(Int(n)) : String(n)
    }

    /// Renders one record field's value the same way its top-level `render(key:value:)` counterpart
    /// would, minus the `key: ` prefix (the caller supplies that at either 2- or 4-space indent).
    /// Exhaustive over every `FrontmatterValue` case for compiler-checked totality, even though
    /// record fields are conventionally scalar-only (see `FrontmatterValue.objectArray`'s doc
    /// comment) — `.array`/`.objectArray` never actually reach here in practice.
    private static func renderScalar(_ value: FrontmatterValue) -> String {
        switch value {
        case .string(let s): return Frontmatter.doubleQuoted(s)
        case .bool(let b): return "\(b)"
        case .number(let n): return formatNumber(n)
        case .date(let s): return s
        case .array(let items):
            if items.isEmpty { return "[]" }
            return "[" + items.map { Frontmatter.doubleQuoted($0) }.joined(separator: ", ") + "]"
        case .objectArray:
            return "[]"
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter FrontmatterDocumentTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/Frontmatter.swift Sources/AnglesiteCore/FrontmatterDocument.swift Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift
git commit -m "feat(#1117): add FrontmatterValue.objectArray + serialization"
```

---

### Task 2: `FrontmatterDocument.parse` support for object-array block YAML

**Files:**
- Modify: `Sources/AnglesiteCore/FrontmatterDocument.swift:100-136` (`parse`'s block-array branch)
- Test: `Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift`, `Tests/AnglesiteCoreTests/FrontmatterTests.swift`

**Interfaces:**
- Consumes: `FrontmatterRecordField`, `FrontmatterValue.objectArray` (Task 1).
- Produces: `FrontmatterDocument.parse(_:)` now round-trips object-array YAML — consumed by Task 4's `TypedContentEditor.read`/`.write` (via the existing `FrontmatterDocument.value(for:)`/`.set(_:for:)` API, unchanged).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift`:

```swift
    @Test("reads a block object-array into ordered records")
    func readsObjectArray() {
        let src = """
        ---
        title: "Resume"
        experience:
          - title: "Engineer"
            org: "Acme"
            start: 2020-01-01
          - title: "Intern"
            org: "Other Co"
            start: 2018-06-01
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.value(for: "experience") == .objectArray([
            [FrontmatterRecordField("title", .string("Engineer")),
             FrontmatterRecordField("org", .string("Acme")),
             FrontmatterRecordField("start", .string("2020-01-01"))],
            [FrontmatterRecordField("title", .string("Intern")),
             FrontmatterRecordField("org", .string("Other Co")),
             FrontmatterRecordField("start", .string("2018-06-01"))],
        ]))
    }

    @Test("unedited object-array round-trip is the identity")
    func objectArrayIdentity() {
        let src = """
        ---
        title: "Resume"
        experience:
          - title: "Engineer"
            org: "Acme"
        ---
        Body.
        """ + "\n"
        #expect(FrontmatterDocument.parse(src).serialized() == src)
    }

    @Test("editing an object-array field re-renders only that field")
    func objectArrayEditRoundTrips() {
        let src = "---\ntitle: \"Resume\"\nexperience:\n  - title: \"Engineer\"\n    org: \"Acme\"\n---\nBody.\n"
        var doc = FrontmatterDocument.parse(src)
        doc.set(.objectArray([[FrontmatterRecordField("title", .string("Senior Engineer")),
                                FrontmatterRecordField("org", .string("Acme"))]]), for: "experience")
        let out = doc.serialized()
        #expect(out.contains("title: \"Senior Engineer\""))
        #expect(FrontmatterDocument.parse(out).value(for: "experience")
                == .objectArray([[FrontmatterRecordField("title", .string("Senior Engineer")),
                                   FrontmatterRecordField("org", .string("Acme"))]]))
    }
```

Add to `Tests/AnglesiteCoreTests/FrontmatterTests.swift` (documents the intentionally-unhandled-but-safe degradation from the Global Constraints section):

```swift
    @Test("an object-array field doesn't corrupt sibling top-level fields (Frontmatter.parse is not record-aware by design)")
    func objectArrayFieldDoesNotCorruptSiblings() {
        let src = """
        ---
        title: "Resume"
        experience:
          - title: "Engineer"
            org: "Acme"
        draft: true
        ---
        """
        let fm = Frontmatter.parse(src)
        #expect(fm["title"] == .string("Resume"))
        #expect(fm["draft"] == .bool(true))
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter FrontmatterDocumentTests`
Expected: FAIL — `readsObjectArray` gets `.array(["title: Engineer", "org: Acme", "start: 2020-01-01", "title: Intern", ...])` instead (today's flat-array misparse), and `objectArrayIdentity`/`objectArrayEditRoundTrips` fail the same way.

Run: `swift test --package-path . --filter FrontmatterTests`
Expected: PASS already (this one documents existing, unchanged behavior — confirms the Global Constraints claim before Task 2 changes anything).

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/FrontmatterDocument.swift`, replace the `if rawValue.isEmpty { ... }` branch inside `parse` (lines 119–129) with:

```swift
            if rawValue.isEmpty {
                if j + 1 < block.count,
                   let firstItemText = Frontmatter.blockArrayItem(block[j + 1]),
                   Frontmatter.splitKeyValue(firstItemText) != nil {
                    // Block array of records: `  - field: value` starts a record; deeper-indented
                    // `field: value` lines continue it. Heuristic: a flat string array item that
                    // itself looks like `word: value` would be misread as a record start — not a
                    // shape this codebase's flat arrays (tags/hours/image paths) ever produce.
                    var records: [[FrontmatterRecordField]] = []
                    var k = j + 1
                    while k < block.count, let itemText = Frontmatter.blockArrayItem(block[k]) {
                        let dashIndent = block[k].prefix(while: { $0 == " " }).count
                        var record: [FrontmatterRecordField] = []
                        if let (fieldKey, fieldRaw) = Frontmatter.splitKeyValue(itemText) {
                            record.append(FrontmatterRecordField(fieldKey, Frontmatter.parseScalarOrArray(fieldRaw)))
                        }
                        verbatim.append(block[k])
                        k += 1
                        while k < block.count {
                            let contLine = block[k]
                            let contIndent = contLine.prefix(while: { $0 == " " }).count
                            let trimmed = contLine.trimmingCharacters(in: .whitespaces)
                            guard contIndent > dashIndent, !trimmed.hasPrefix("-"),
                                  let (fieldKey, fieldRaw) = Frontmatter.splitKeyValue(trimmed)
                            else { break }
                            record.append(FrontmatterRecordField(fieldKey, Frontmatter.parseScalarOrArray(fieldRaw)))
                            verbatim.append(contLine)
                            k += 1
                        }
                        records.append(record)
                    }
                    value = .objectArray(records)
                    j = k
                } else {
                    // Possible block array on following `- item` lines.
                    var items: [String] = []
                    var k = j + 1
                    while k < block.count, let item = Frontmatter.blockArrayItem(block[k]) {
                        items.append(Frontmatter.unquote(item))
                        verbatim.append(block[k])
                        k += 1
                    }
                    value = items.isEmpty ? .string("") : .array(items)
                    j = k
                }
            } else {
                value = Frontmatter.parseScalarOrArray(rawValue)
                j += 1
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter FrontmatterDocumentTests`
Run: `swift test --package-path . --filter FrontmatterTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/FrontmatterDocument.swift Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift Tests/AnglesiteCoreTests/FrontmatterTests.swift
git commit -m "feat(#1117): parse block object-array YAML in FrontmatterDocument"
```

---

### Task 3: `ContentTypeField.Kind.objectArray(fields:)`

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift:21-33` (`Kind` enum)
- Test: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`

**Interfaces:**
- Produces: `ContentTypeField.Kind.objectArray(fields: [ContentTypeField])`, `Kind` no longer conforms to `RawRepresentable`/`String`. Consumed by Tasks 4–8.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` (inside `struct ContentTypeRegistryTests`, e.g. after `albumDescriptor`):

```swift
    @Test("objectArray kind carries its ordered member fields and compares by value")
    func objectArrayKindCarriesMemberFields() {
        let memberFields = [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("organization", .string, required: true),
            ContentTypeField("startDate", .date, required: true),
            ContentTypeField("endDate", .date),
            ContentTypeField("description", .text),
        ]
        let field = ContentTypeField("experience", .objectArray(fields: memberFields))
        guard case .objectArray(let fields) = field.kind else {
            Issue.record("expected .objectArray")
            return
        }
        #expect(fields.map(\.name) == ["title", "organization", "startDate", "endDate", "description"])
        #expect(fields.first?.kind == .string)
        #expect(fields.first?.required == true)

        // Equatable: same fields in the same order compare equal; a different order does not.
        let same = ContentTypeField("experience", .objectArray(fields: memberFields))
        #expect(field == same)
        let reordered = ContentTypeField("experience", .objectArray(fields: memberFields.reversed()))
        #expect(field != reordered)
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: FAIL to compile — `.objectArray(fields:)` doesn't exist; `Kind` is still a plain `String` raw-value enum.

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, replace the `Kind` enum (lines 21–33) with:

```swift
    public enum Kind: Sendable, Equatable {
        case string        // single-line text
        case text          // multi-line plain text
        case markdown      // multi-line rich body
        case bool
        case date          // calendar date, no time
        case datetime      // ISO 8601 date-time with time + timezone (mf2 `dt-*` properties)
        case url
        case image         // a site-relative media path
        case number
        case stringArray   // e.g. tags
        case imageArray    // an ordered list of site-relative media paths (e.g. album photos)
        /// A repeating group of small structured records (e.g. h-resume `experience`/`education`
        /// entries) — an ordered list of member fields, each an existing scalar `Kind`. By
        /// convention `fields` excludes `.markdown`, `.stringArray`, `.imageArray`, and nested
        /// `.objectArray` — enforced by review/tests, not the type system, matching this registry's
        /// existing preference for documented invariants over new type machinery. No built-in
        /// descriptor declares this yet (#964 adds the first: h-resume).
        case objectArray(fields: [ContentTypeField])
    }
```

(No raw-value backing: confirmed via grep that nothing in `Sources/`/`Tests/` reads `ContentTypeField.Kind`'s `.rawValue` or calls `Kind(rawValue:)` — every `.rawValue` hit in the codebase belongs to an unrelated `Kind` enum on a different type.)

- [ ] **Step 4: Run test to verify it passes**

Run: `swift build --package-path .` (confirms the whole module still compiles — this is the step that will surface any missed exhaustive switch; expect it to fail here with "switch must be exhaustive" errors in `TypedContentEditor.swift`, `ContentScaffold.swift`, `MicropubContentSync.swift`, `TypedEntryEditorView.swift`, and `ContentConfigDriftTests.swift` — that's expected and is exactly what Tasks 4–7 fix. For this task, filter to just the registry test:)

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: this specific test PASSES once the type exists, even though the full `swift build` won't succeed until Task 4 lands (`TypedContentEditor.swift` is in the same target). If `swift test --filter` refuses to build the target at all (likely, since it's one SwiftPM target), proceed straight to Task 4 in the same sitting before running the build/test gate — note this in the commit message.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
git commit -m "feat(#1117): add ContentTypeField.Kind.objectArray(fields:)

Drops Kind's String raw-value backing (nothing read .rawValue). The
whole-module build won't pass until the exhaustive switches in the
following tasks are updated — expected, not a regression."
```

---

### Task 4: `TypedContentEditor.FieldValue.records` + decode/encode/defaultValue

**Files:**
- Modify: `Sources/AnglesiteCore/TypedContentEditor.swift:11-17,28-36,80-102,106-119`
- Test: `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`

**Interfaces:**
- Consumes: `ContentTypeField.Kind.objectArray(fields:)` (Task 3), `FrontmatterValue.objectArray`/`FrontmatterRecordField` (Tasks 1–2).
- Produces: `TypedContentEditor.FieldValue.records([[String: FieldValue]])` — consumed by Task 8 (`TypedEntryEditorModel`/`TypedEntryEditorView`).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift` (inside `struct TypedContentEditorTests`, after `writeList`):

```swift
    @Test("write round-trips an objectArray field into block-mapping-list YAML")
    func writeObjectArray() {
        let resume = ContentTypeDescriptor(
            id: "resumeFixture", displayName: "Resume Fixture", storage: .collection("resumeFixtures"),
            fields: [
                ContentTypeField("experience", .objectArray(fields: [
                    ContentTypeField("title", .string, required: true),
                    ContentTypeField("org", .string, required: true),
                    ContentTypeField("start", .date, required: true),
                ])),
                ContentTypeField("body", .markdown),
            ],
            projections: ContentTypeProjections(microformat: "h-resume", microformatProperties: [:], schemaType: nil))

        let src = "---\nexperience: []\n---\n\nBody.\n"
        var v = TypedContentEditor.read(src, descriptor: resume)
        #expect(v["experience"] == .records([]))

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let start = iso.date(from: "2020-01-01T00:00:00.000Z")!
        v["experience"] = .records([
            ["title": .text("Engineer"), "org": .text("Acme"), "start": .date(start)],
        ])
        let out = TypedContentEditor.write(v, into: src, descriptor: resume)
        #expect(out.contains("""
        experience:
          - title: "Engineer"
            org: "Acme"
            start: 2020-01-01
        """))

        let reread = TypedContentEditor.read(out, descriptor: resume)
        #expect(reread["experience"] == .records([
            ["title": .text("Engineer"), "org": .text("Acme"), "start": .date(start)],
        ]))
    }

    @Test("objectArray record fields fall back to defaults when a record omits one")
    func objectArrayRecordFillsMissingMemberDefaults() {
        let resume = ContentTypeDescriptor(
            id: "resumeFixture2", displayName: "Resume Fixture 2", storage: .collection("resumeFixtures2"),
            fields: [
                ContentTypeField("experience", .objectArray(fields: [
                    ContentTypeField("title", .string, required: true),
                    ContentTypeField("org", .string),
                ])),
            ],
            projections: ContentTypeProjections(microformat: "h-resume", microformatProperties: [:], schemaType: nil))
        let src = "---\nexperience:\n  - title: \"Engineer\"\n---\n"
        let v = TypedContentEditor.read(src, descriptor: resume)
        #expect(v["experience"] == .records([["title": .text("Engineer"), "org": .text("")]]))
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift build --package-path .`
Expected: FAIL — non-exhaustive switches in `defaultValue(for:)`, `decode(_:kind:)`, `encode(_:kind:)` (no `.objectArray`/`.records` arm yet).

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/TypedContentEditor.swift`, add a case to `FieldValue` (after `case list([String])`, line 16):

```swift
        case records([[String: FieldValue]])
```

Add an arm to `defaultValue(for:)` (after the `.stringArray, .imageArray` arm, line 34):

```swift
        case .objectArray: return .records([])
```

Replace `decode(_:kind:)` (lines 80–102) with:

```swift
    private static func decode(_ value: FrontmatterValue, kind: ContentTypeField.Kind) -> FieldValue {
        switch kind {
        case .string, .text, .url, .image, .markdown:
            if case .string(let s) = value { return .text(s) }
            return .text("")
        case .bool:
            if case .bool(let b) = value { return .flag(b) }
            return .flag(false)
        case .date, .datetime:
            // `FrontmatterValue.date` is write-only — `Frontmatter.parse` only ever yields a date
            // scalar as `.string`, so matching `.string` here is exhaustive in practice. If that
            // invariant is ever relaxed, add a `.date` arm: the `.date(nil)` fallback would
            // otherwise silently drop a valid date.
            if case .string(let s) = value { return .date(parseDate(s)) }
            return .date(nil)
        case .number:
            if case .string(let s) = value { return .number(Double(s)) }
            return .number(nil)
        case .stringArray, .imageArray:
            if case .array(let a) = value { return .list(a) }
            return .list([])
        case .objectArray(let memberFields):
            guard case .objectArray(let records) = value else { return .records([]) }
            let decoded = records.map { record -> [String: FieldValue] in
                let raw = Dictionary(record.map { ($0.name, $0.value) }, uniquingKeysWith: { _, latest in latest })
                var dict: [String: FieldValue] = [:]
                for member in memberFields {
                    dict[member.name] = raw[member.name].map { decode($0, kind: member.kind) }
                        ?? defaultValue(for: member.kind)
                }
                return dict
            }
            return .records(decoded)
        }
    }
```

Replace `encode(_:kind:)` (lines 106–119) with:

```swift
    private static func encode(_ value: FieldValue, kind: ContentTypeField.Kind) -> FrontmatterValue? {
        switch value {
        case .text(let s): return .string(s)
        case .flag(let b): return .bool(b)
        // Dates serialize unquoted (FrontmatterValue.date) so they satisfy a non-coercing date
        // schema and stay consistent with ContentScaffold; a nil (cleared) date falls back to an
        // empty quoted scalar.
        case .date(let d): return d.map { .date(format($0, kind: kind)) } ?? .string("")
        // Numbers serialize unquoted (FrontmatterValue.number) so they satisfy a z.number() schema;
        // a nil (cleared) number falls back to an empty quoted scalar.
        case .number(let n): return n.map { .number($0) } ?? .string("")
        case .list(let a): return .array(a)
        case .records(let recordDicts):
            guard case .objectArray(let memberFields) = kind else { return nil }
            let records: [[FrontmatterRecordField]] = recordDicts.map { dict in
                memberFields.compactMap { member -> FrontmatterRecordField? in
                    guard let v = dict[member.name], let encoded = encode(v, kind: member.kind) else { return nil }
                    return FrontmatterRecordField(member.name, encoded)
                }
            }
            return .objectArray(records)
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift build --package-path .`
Expected: builds clean (no more non-exhaustive-switch errors from this file; `ContentScaffold.swift`/`MicropubContentSync.swift`/`TypedEntryEditorView.swift`/`ContentConfigDriftTests.swift` still fail until Tasks 5–7 — expected).

Run: `swift test --package-path . --filter TypedContentEditorTests`
Expected: PASS (once Tasks 5–7 also land and the target builds — if `swift test` won't build the whole target yet, defer running this filter until Task 7 is also done, and say so in the commit message).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/TypedContentEditor.swift Tests/AnglesiteCoreTests/TypedContentEditorTests.swift
git commit -m "feat(#1117): encode/decode objectArray fields in TypedContentEditor"
```

---

### Task 5: `ContentScaffold.renderEntry`/`renderSingleton` exhaustiveness

**Files:**
- Modify: `Sources/AnglesiteCore/ContentScaffold.swift:182-215,255-267`
- Test: `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift`

**Interfaces:**
- Consumes: `ContentTypeField.Kind.objectArray` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift` (match the file's existing `@Suite`/`@Test` style — check the top of the file for its exact suite name/imports before inserting):

```swift
    @Test("renderEntry scaffolds an empty array for an objectArray field")
    func renderEntryScaffoldsEmptyObjectArray() {
        let descriptor = ContentTypeDescriptor(
            id: "resumeFixture", displayName: "Resume Fixture", storage: .collection("resumeFixtures"),
            fields: [ContentTypeField("experience", .objectArray(fields: [
                ContentTypeField("title", .string, required: true),
            ]))],
            projections: ContentTypeProjections(microformat: "h-resume", microformatProperties: [:], schemaType: nil))
        let out = ContentScaffold.renderEntry(descriptor: descriptor, title: nil, now: Date())
        #expect(out.contains("experience: []"))
    }

    @Test("renderSingleton scaffolds an empty array for an objectArray field")
    func renderSingletonScaffoldsEmptyObjectArray() {
        let descriptor = ContentTypeDescriptor(
            id: "resumeSingletonFixture", displayName: "Resume Singleton Fixture", storage: .singleton("resumeFixture"),
            fields: [ContentTypeField("experience", .objectArray(fields: [
                ContentTypeField("title", .string, required: true),
            ]))],
            projections: ContentTypeProjections(microformat: "h-resume", microformatProperties: [:], schemaType: nil))
        let out = ContentScaffold.renderSingleton(descriptor: descriptor, name: nil)
        #expect(out.contains("\"experience\": []"))
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift build --package-path .`
Expected: FAIL — non-exhaustive switch in `renderEntry`/`renderSingleton`.

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/ContentScaffold.swift`, in `renderEntry`'s switch (around line 199), change:

```swift
            case .stringArray, .imageArray:
                lines.append("\(field.name): []")
```
to:
```swift
            case .stringArray, .imageArray, .objectArray:
                lines.append("\(field.name): []")
```

In `renderSingleton`'s switch (around line 262), change:

```swift
            case .stringArray, .imageArray:
                value = "[]"
```
to:
```swift
            case .stringArray, .imageArray, .objectArray:
                value = "[]"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift build --package-path .`
Run: `swift test --package-path . --filter ContentScaffoldTests`
Expected: builds; new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentScaffold.swift Tests/AnglesiteCoreTests/ContentScaffoldTests.swift
git commit -m "feat(#1117): scaffold objectArray fields as an empty array"
```

---

### Task 6: `MicropubContentSync.fieldValue` exhaustiveness

**Files:**
- Modify: `Sources/AnglesiteCore/MicropubContentSync.swift:107-135`
- Test: `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift`

**Interfaces:**
- Consumes: `ContentTypeField.Kind.objectArray` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift` (near the other `fieldValue`-adjacent tests, or in a new `// MARK: - fieldValue` section):

```swift
    @Test("fieldValue returns an empty records value for an objectArray field (no mf2 mapping exists for it)")
    func fieldValueObjectArrayIsEmptyRecords() {
        let field = ContentTypeField("experience", .objectArray(fields: [
            ContentTypeField("title", .string, required: true),
        ]))
        let result = MicropubContentSync.fieldValue(for: field, rawProperty: "experience", properties: [:])
        #expect(result == .records([]))
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift build --package-path .`
Expected: FAIL — non-exhaustive switch in `fieldValue(for:rawProperty:properties:)`.

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/MicropubContentSync.swift`, add an arm to `fieldValue`'s switch (after the `.imageArray` arm, around line 134):

```swift
        // No field in the built-in registry maps a raw mf2 property to `.objectArray` today (h-resume
        // lands in #964, and even then p-experience/p-education are nested h-event/h-card mf2
        // objects this bridge doesn't attempt to flatten back into records) — this arm exists only
        // for switch exhaustiveness, mirroring the `.bool` arm above.
        case .objectArray:
            return .records([])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift build --package-path .`
Run: `swift test --package-path . --filter MicropubContentSyncTests`
Expected: builds; new test PASSes.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/MicropubContentSync.swift Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift
git commit -m "feat(#1117): exhaustiveness arm for objectArray in MicropubContentSync"
```

---

### Task 7: `ContentConfigDriftTests.zod(for:)` exhaustiveness

**Files:**
- Modify: `Tests/AnglesiteCoreTests/ContentConfigDriftTests.swift:25-35`

**Interfaces:**
- Consumes: `ContentTypeField.Kind.objectArray` (Task 3).
- Produces: the canonical Zod-expression shape a future h-resume-era `content.config.ts` should match — `z.array(z.object({ ... }))` — satisfying the issue's "matching shape" ask without a real collection to attach it to yet (see Global Constraints).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/ContentConfigDriftTests.swift` (inside `struct ContentConfigDriftTests`, after `titleFieldPerType`-style tests — actually this suite has no such test; add near the bottom, after `parsesExportLine`):

```swift
    @Test("zod(for:) renders an objectArray field as z.array(z.object({...})) with member requiredness")
    func zodForObjectArray() {
        let kind = ContentTypeField.Kind.objectArray(fields: [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("org", .string),
        ])
        #expect(Self.zod(for: kind) == "z.array(z.object({ title: z.string(), org: z.string().optional() }))")
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift build --package-path .`
Expected: FAIL — non-exhaustive switch in `zod(for:)` (the last remaining compile error from Task 3's change).

- [ ] **Step 3: Write minimal implementation**

In `Tests/AnglesiteCoreTests/ContentConfigDriftTests.swift`, replace `zod(for kind:)` (lines 25–35) with:

```swift
    static func zod(for kind: ContentTypeField.Kind) -> String? {
        switch kind {
        case .markdown: return nil
        case .string, .text, .image: return "z.string()"
        case .url: return "z.string().url()"
        case .date, .datetime: return "z.coerce.date()"
        case .number: return "z.number()"
        case .bool: return "z.boolean()"
        case .stringArray, .imageArray: return "z.array(z.string())"
        case .objectArray(let fields):
            let memberExprs = fields.compactMap { field -> String? in
                guard let expr = zod(for: field.kind) else { return nil }
                let full = field.kind == .bool ? "\(expr).default(false)" : (field.required ? expr : "\(expr).optional()")
                return "\(field.name): \(full)"
            }
            return "z.array(z.object({ \(memberExprs.joined(separator: ", ")) }))"
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift build --package-path .`
Expected: the whole `AnglesiteCore` target (and its test target) now builds clean — this was the last non-exhaustive switch.

Run: `swift test --package-path .`
Expected: full SwiftPM suite PASSES, including every test added in Tasks 1–7.

- [ ] **Step 5: Commit**

```bash
git add Tests/AnglesiteCoreTests/ContentConfigDriftTests.swift
git commit -m "feat(#1117): zod(for:) exhaustiveness arm for objectArray"
```

---

### Task 8: SwiftUI nested-row editor (`TypedEntryEditorModel` + `TypedEntryEditorView`)

**Files:**
- Modify: `Sources/AnglesiteApp/TypedEntryEditorModel.swift:167-170` (add `recordsBinding`)
- Modify: `Sources/AnglesiteApp/TypedEntryEditorView.swift:36-65` (add `.objectArray` arm + new `ObjectArrayEditor` view)

**Interfaces:**
- Consumes: `TypedContentEditor.FieldValue.records` (Task 4), `ContentTypeField.Kind.objectArray(fields:)` (Task 3).
- No new test file: this repo has no existing direct unit tests for `TypedEntryEditorModel`'s other `Binding` accessors (`textBinding`, `listBinding`, etc. are untested directly, exercised only via `TypedContentEditor`'s own tests and manual/GUI verification) — `recordsBinding` follows the same precedent. Verified by `scripts/build-app.sh` (compiles the SwiftUI code, confirms `control(for:)` is exhaustive) — this Kind has no built-in descriptor yet (#964 adds the first), so there's no live screen to interactively click through today.

- [ ] **Step 1: Add `recordsBinding` to `TypedEntryEditorModel`**

In `Sources/AnglesiteApp/TypedEntryEditorModel.swift`, add after `listBinding` (line 167–170):

```swift
    func recordsBinding(_ name: String) -> Binding<[[String: TypedContentEditor.FieldValue]]> {
        Binding(get: { [weak self] in if case .records(let r)? = self?.values[name] { return r }; return [] },
                set: { [weak self] in self?.values[name] = .records($0) })
    }
```

- [ ] **Step 2: Run the app build to verify it fails**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: FAIL — `TypedEntryEditorView.control(for:)`'s switch is non-exhaustive (`.objectArray` has no arm), since `ContentTypeField.Kind` changed in Task 3.

- [ ] **Step 3: Add the `.objectArray` arm and the `ObjectArrayEditor` view**

In `Sources/AnglesiteApp/TypedEntryEditorView.swift`, add a case to `control(for:)`'s switch (after the `.stringArray, .imageArray` arm, before `.markdown`, around line 62):

```swift
        case .objectArray(let memberFields):
            ObjectArrayEditor(title: label, memberFields: memberFields, records: model.recordsBinding(field.name))
```

Add a new view after `StringListEditor` (end of file, after line 134):

```swift
/// An add/remove list editor for `objectArray` fields — one collapsible-free block per record, each
/// rendering its member fields inline. Rows carry stable UUID identity, mirroring `StringListEditor`,
/// so deleting a row never re-binds a surviving row's editor to the wrong record.
private struct ObjectArrayEditor: View {
    let title: String
    let memberFields: [ContentTypeField]
    @Binding var records: [[String: TypedContentEditor.FieldValue]]

    private struct Row: Identifiable, Equatable {
        let id = UUID()
        var values: [String: TypedContentEditor.FieldValue]
    }
    @State private var rows: [Row] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            ForEach($rows) { $row in
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(memberFields, id: \.name) { field in
                        memberControl(for: field, in: $row.values)
                    }
                    HStack {
                        Spacer()
                        Button(role: .destructive) { rows.removeAll { $0.id == row.id } } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary))
            }
            Button { rows.append(Row(values: emptyRecord())) } label: {
                Label("Add", systemImage: "plus.circle")
            }
            .buttonStyle(.borderless)
        }
        .onAppear { syncRowsFromRecords() }
        .onChange(of: records) { _, new in
            if new != rows.map(\.values) { rows = new.map(Row.init(values:)) }
        }
        .onChange(of: rows) { _, new in
            let mapped = new.map(\.values)
            if mapped != records { records = mapped }
        }
    }

    private func emptyRecord() -> [String: TypedContentEditor.FieldValue] {
        Dictionary(uniqueKeysWithValues: memberFields.map { ($0.name, TypedContentEditor.defaultValue(for: $0.kind)) })
    }

    private func syncRowsFromRecords() {
        if records != rows.map(\.values) { rows = records.map(Row.init(values:)) }
    }

    @ViewBuilder
    private func memberControl(for field: ContentTypeField, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> some View {
        let label = field.name + (field.required ? " *" : "")
        switch field.kind {
        case .bool:
            Toggle(label, isOn: flagBinding(field.name, in: values))
        case .date, .datetime:
            DatePicker(label, selection: dateBinding(field.name, in: values),
                       displayedComponents: field.kind == .date ? [.date] : [.date, .hourAndMinute])
        case .number:
            TextField(label, text: numberBinding(field.name, in: values))
        default:
            TextField(label, text: textBinding(field.name, in: values))
        }
    }

    private func textBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<String> {
        Binding(
            get: { if case .text(let s)? = values.wrappedValue[name] { return s }; return "" },
            set: { values.wrappedValue[name] = .text($0) }
        )
    }

    private func flagBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<Bool> {
        Binding(
            get: { if case .flag(let b)? = values.wrappedValue[name] { return b }; return false },
            set: { values.wrappedValue[name] = .flag($0) }
        )
    }

    private func dateBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<Date> {
        Binding(
            get: { if case .date(let d)? = values.wrappedValue[name] { return d ?? Date() }; return Date() },
            set: { values.wrappedValue[name] = .date($0) }
        )
    }

    private func numberBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<String> {
        Binding(
            get: {
                if case .number(let n)? = values.wrappedValue[name], let n { return String(n) }
                return ""
            },
            set: { values.wrappedValue[name] = .number(Double($0)) }
        )
    }
}
```

- [ ] **Step 4: Run the app build to verify it passes**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: builds clean.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/TypedEntryEditorModel.swift Sources/AnglesiteApp/TypedEntryEditorView.swift
git commit -m "feat(#1117): nested-row SwiftUI editor for objectArray fields"
```

---

### Task 9: Full verification and PR prep

**Files:** none (verification only).

- [ ] **Step 1: Full Swift package test suite**

Run: `swift test --package-path .`
Expected: all suites PASS, including every `@Test` added in Tasks 1–7.

- [ ] **Step 2: Full app build**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: builds clean.

- [ ] **Step 3: Check for `Resources/Template/` coupling**

Per `CONTRIBUTING.md` ▸ Testing: "If you touch `Resources/Template/`, run `swift test` too — some Swift tests couple to the template markup." This plan does not touch `Resources/Template/` (confirmed: no task modifies any file under that directory) — record this explicitly in the PR body's Test plan rather than silently omitting the check.

- [ ] **Step 4: Re-read `CONTRIBUTING.md` ▸ "Commits and pull requests" immediately before opening the PR**

Confirm: commit subjects ≤72 chars (all of Tasks 1–8's are); PR body uses `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (**Summary**, **Paired PR check**, **Test plan**); Paired PR check states this is **not** an MCP-schema change (no sidecar PR needed) — it's `Sources/AnglesiteCore`/`Sources/AnglesiteApp`-only, template-adjacent work is limited to the test-only `ContentConfigDriftTests.swift`.

- [ ] **Step 5: Remove the in-progress label and open the PR**

```bash
gh issue edit 1117 --remove-label "🛠️ In Progress"
```

Then commit is already done per-task; open the PR with `gh pr create` using the template headings from Step 4.
