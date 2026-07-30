# #714 Slice 3 — Unified Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the window `.inspector` the app's only inspector — a Pages-style tabbed (**Metadata | Style**) panel that follows the current selection: an HTML element (Component Editor canvas), the page itself, or a collection (feed-bearing directory).

**Architecture:** Three stored selection sources on `SiteWindowModel` (`inspectorContext` for pages — existing; `componentEditor` — hoisted from `ComponentEditorView`'s view-local `@State`; `collectionInspection` — new) unified by a computed `inspectorSelection`. A new `SiteInspectorView` renders the tabbed shell; the Component Editor's in-pane `HSplitView` inspector column is removed and its sections are extracted into standalone panes hosted by the window inspector. The per-selection code zone (`ComponentEditorCodePane`) is dropped — Design/Source mode covers source editing.

**Tech Stack:** Swift 6.4 / SwiftUI (macOS 27+), Swift Testing, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-website-design-window-cleanup-design.md` §4 (amended 2026-07-30) and §6.

## Global Constraints

- Read `CONTRIBUTING.md` in this worktree before starting; re-check before every commit.
- Work happens in a git worktree (this one). Run `xcodegen generate` before any app build.
- Conventional commits, subject ≤72 chars, issue number in subject: e.g. `feat(app): … (#714)`.
- Apple frameworks only; plain SwiftUI + `@Observable`, no third-party state.
- All user-visible strings are extracted to `Sources/AnglesiteApp/Localizable.xcstrings` — Task 7 runs the CLI catalog sync per CONTRIBUTING (worktree-scoped `BUILD_DIR`, `--skip-marking-strings-stale`).
- Full `swift test --package-path .` (with `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` if the default toolchain is stale) must pass before push. Don't run two `swift test` invocations concurrently.
- Before starting: claim the issue — `gh issue edit 714 --add-label "🛠️ In Progress"` (remove when the PR opens).

## File Structure

| File | Role |
|---|---|
| `Sources/AnglesiteCore/SiteFileTree.swift` (modify) | + `DetectedFeed` + `detectedFeeds(siteRoot:collection:)` probe |
| `Sources/AnglesiteCore/CollectionInspection.swift` (create) | Read-mostly value the collection inspector renders |
| `Sources/AnglesiteApp/SiteNavigatorModel.swift` (modify) | + `node(for:)` accessor |
| `Sources/AnglesiteApp/SiteWindowModel.swift` (modify) | + `collectionInspection`, `componentEditor`, `inspectorSelection`, `ensureComponentEditorLoaded()`, transition clears |
| `Sources/AnglesiteApp/InspectorContext.swift` (modify) | + `InspectorSelection` enum |
| `Sources/AnglesiteApp/ComponentEditorView.swift` (modify) | Receives hoisted model; loses model creation, inspector column, transient inspector state |
| `Sources/AnglesiteApp/MainPaneEditorView.swift` (modify) | `componentEditor`/`onCanvasWebView` threading |
| `Sources/AnglesiteApp/SiteWindow.swift` (modify) | Inspector gate → `inspectorSelection`; `.task` activation key; canvas webView handle; drops inline `ComponentEditorContext` construction |
| `Sources/AnglesiteApp/ComponentEditBannerViews.swift` (create) | Conflict + write-error banners shared by both component panes |
| `Sources/AnglesiteApp/ComponentMetadataInspectorPane.swift` (create) | Metadata tab: selected node attrs + Props form |
| `Sources/AnglesiteApp/ComponentStyleInspectorPane.swift` (create) | Style tab: Styles + Computed groups |
| `Sources/AnglesiteApp/SiteInspectorView.swift` (create) | Tabbed shell + `CollectionInspectorForm` |
| `Sources/AnglesiteApp/ComponentEditorInspectorPane.swift` (delete, Task 6) | Superseded by the extracted panes |
| `Sources/AnglesiteApp/ComponentEditorCodePane.swift` (delete, Task 6) | Code zone dropped from the inspector |
| `Tests/AnglesiteCoreTests/SiteFileTreeTests.swift` (modify) | `detectedFeeds` fixtures |
| `Tests/AnglesiteAppTests/SiteWindowModelTests.swift` (modify) | Collection context + component-editor lifecycle + `inspectorSelection` gating |

Model-level behavior gets unit tests; SwiftUI view structs follow this repo's convention of compile-coverage via `swift test` plus the app build (no view unit tests).

---

### Task 1: `SiteFileTree.DetectedFeed` + `detectedFeeds` probe

**Files:**
- Modify: `Sources/AnglesiteCore/SiteFileTree.swift` (append below `feedCollections`, ~line 92)
- Test: `Tests/AnglesiteCoreTests/SiteFileTreeTests.swift`

**Interfaces:**
- Consumes: existing `SiteFileTree.layout(for:fileManager:)`.
- Produces: `SiteFileTree.DetectedFeed` (`kind: Kind` [`.rss`/`.atom`/`.json`], `collection: String`, computed `route: String`, `id: String`) and `static func detectedFeeds(siteRoot: URL, collection: String, fileManager: FileManager = .default) -> [DetectedFeed]`. Task 2's `CollectionInspection.feeds` is `[SiteFileTree.DetectedFeed]`.

- [ ] **Step 1: Write the failing tests**

Append to the `SiteFileTreeTests` suite (mirror the existing `feedCollections` tests at lines 68–85, which build fixture trees under `FileManager.default.temporaryDirectory`; reuse the file's existing fixture helper if one exists — otherwise create dirs/files inline as below):

```swift
@Test("detectedFeeds reports each feed route the collection ships, in rss/atom/json order")
func detectedFeeds() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("sft-feeds-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let notes = root.appendingPathComponent("src/pages/notes")
    try FileManager.default.createDirectory(at: notes, withIntermediateDirectories: true)
    try Data().write(to: notes.appendingPathComponent("rss.xml.ts"))
    try Data().write(to: notes.appendingPathComponent("feed.json.ts"))

    let feeds = SiteFileTree.detectedFeeds(siteRoot: root, collection: "notes")
    #expect(feeds.map(\.kind) == [.rss, .json])
    #expect(feeds.map(\.route) == ["/notes/rss.xml", "/notes/feed.json"])
}

@Test("detectedFeeds is empty for a collection with no feed routes or a missing directory")
func detectedFeedsEmpty() throws {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("sft-feeds-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(
        at: root.appendingPathComponent("src/pages/plain"), withIntermediateDirectories: true)

    #expect(SiteFileTree.detectedFeeds(siteRoot: root, collection: "plain").isEmpty)
    #expect(SiteFileTree.detectedFeeds(siteRoot: root, collection: "absent").isEmpty)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteFileTreeTests`
Expected: compile FAILURE — `detectedFeeds`/`DetectedFeed` not defined. (Note: `--filter` still compiles the whole package.)

- [ ] **Step 3: Implement**

Append inside `enum SiteFileTree` in `Sources/AnglesiteCore/SiteFileTree.swift`, directly below `feedCollections`:

```swift
    /// One feed route a collection ships — `/notes/rss.xml` etc. `Kind.rawValue` is the route's
    /// filename so probe path and preview route can't drift apart.
    public struct DetectedFeed: Sendable, Equatable, Identifiable {
        public enum Kind: String, Sendable, CaseIterable {
            case rss = "rss.xml"
            case atom = "atom.xml"
            case json = "feed.json"
        }
        public let kind: Kind
        public let collection: String
        public var route: String { "/\(collection)/\(kind.rawValue)" }
        public var id: String { route }

        public init(kind: Kind, collection: String) {
            self.kind = kind
            self.collection = collection
        }
    }

    /// All feed routes one collection ships, probed the way `feedCollections` probes RSS: the
    /// template materializes `src/pages/<collection>/{rss.xml,atom.xml,feed.json}.ts` per
    /// feed-bearing collection, so existence of the `.ts` route module is the signal (#714 §6).
    public static func detectedFeeds(
        siteRoot: URL, collection: String, fileManager: FileManager = .default
    ) -> [DetectedFeed] {
        let dir = layout(for: siteRoot, fileManager: fileManager)
            .sourceDir.appendingPathComponent("src/pages").appendingPathComponent(collection)
        return DetectedFeed.Kind.allCases.compactMap { kind in
            let module = dir.appendingPathComponent("\(kind.rawValue).ts")
            return fileManager.fileExists(atPath: module.path(percentEncoded: false))
                ? DetectedFeed(kind: kind, collection: collection)
                : nil
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteFileTreeTests`
Expected: PASS (all suite tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteFileTree.swift Tests/AnglesiteCoreTests/SiteFileTreeTests.swift
git commit -m "feat(core): probe a collection's rss/atom/json feed routes (#714)"
```

---

### Task 2: Collection context on `SiteWindowModel`

**Files:**
- Create: `Sources/AnglesiteCore/CollectionInspection.swift`
- Modify: `Sources/AnglesiteApp/SiteNavigatorModel.swift` (near `target(for:)`, line 101)
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (property block ~line 212; `applyNavigatorSelection` `.route`/`.directory` branches ~lines 840–883; `openFile` ~line 941; the five pane-transition methods lines 300–352; `handleSiteChanged` ~line 502; `close` ~line 549)
- Test: `Tests/AnglesiteAppTests/SiteWindowModelTests.swift`

**Interfaces:**
- Consumes: Task 1's `SiteFileTree.detectedFeeds(siteRoot:collection:)`; existing `ContentTypeRegistry.default.descriptor(forCollection:)` (`.displayName`, `.projections.microformat`); `SiteContentGraph.posts(for:)`; `URLTreeNode` (`title`, `children`).
- Produces: `CollectionInspection` (public struct, fields below); `SiteWindowModel.collectionInspection: CollectionInspection?`; `SiteNavigatorModel.node(for id: String) -> URLTreeNode?`. Task 3's `inspectorSelection` reads `collectionInspection`; Task 6's `CollectionInspectorForm` renders `CollectionInspection`.

- [ ] **Step 1: Create the value type**

`Sources/AnglesiteCore/CollectionInspection.swift`:

```swift
import Foundation

/// What the unified inspector shows for a selected directory/collection sidebar row (#714 §6) —
/// assembled by the site window from the navigator node, the content graph, the feed probe, and
/// the content-type registry. Read-mostly v1: pure display data, no write-back.
public struct CollectionInspection: Sendable, Equatable {
    public let title: String
    public let route: String
    /// The `src/content` collection name; nil for a plain nested page folder.
    public let collection: String?
    /// Entries in the collection (graph posts), or child pages for a plain folder.
    public let entryCount: Int
    public let feeds: [SiteFileTree.DetectedFeed]
    /// Registered content type's `displayName` (e.g. "Notes"); nil when unregistered.
    public let contentTypeName: String?
    /// Root microformats2 class the type projects (e.g. "h-entry") — the template's static
    /// dispatch picks the matching layout, so this names the template in use.
    public let microformat: String?

    public init(
        title: String, route: String, collection: String?, entryCount: Int,
        feeds: [SiteFileTree.DetectedFeed], contentTypeName: String?, microformat: String?
    ) {
        self.title = title
        self.route = route
        self.collection = collection
        self.entryCount = entryCount
        self.feeds = feeds
        self.contentTypeName = contentTypeName
        self.microformat = microformat
    }
}
```

- [ ] **Step 2: Add the navigator node accessor**

In `Sources/AnglesiteApp/SiteNavigatorModel.swift`, directly below `func target(for id: String) -> NavigatorTarget? { nodesByID[id]?.target }` (line 101):

```swift
    /// The tree node for a row id — the `.directory` selection path reads its title/children to
    /// assemble the inspector's collection context (#714 slice 3).
    func node(for id: String) -> URLTreeNode? { nodesByID[id] }
```

- [ ] **Step 3: Write the failing tests**

In `Tests/AnglesiteAppTests/SiteWindowModelTests.swift`, extend the existing `applyNavigatorSelectionDirectoryNavigatesPreview` test: after its existing final assertions, it currently expects `model.inspectorContext == nil` — keep that, and append:

```swift
        // #714 slice 3: a directory selection populates the collection context.
        while model.collectionInspection == nil { await Task.yield() }
        let inspection = try #require(model.collectionInspection)
        #expect(inspection.collection == "notes")
        #expect(inspection.route == "/notes/")
        #expect(inspection.entryCount == 1)
        #expect(inspection.contentTypeName
            == ContentTypeRegistry.default.descriptor(forCollection: "notes")?.displayName)
```

(If the test's directory route literal differs — assert against the route the test already selected, not a new literal. Mark the test `throws` if it isn't already.)

Then add a new test to the same suite (reuse its `makeSitePackage`/`makeModel` helpers and the navigator setup pattern from `applyNavigatorSelectionWebsiteSettingsOpensInfoPlist`):

```swift
    @Test("the collection context carries probed feed routes, and a route selection clears it")
    func collectionInspectionFeedsAndClearing() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a",
            pages: [SiteContentGraph.Page(
                id: "site-a:page:/about", siteID: "site-a", route: "/about",
                filePath: "src/pages/about.md", title: "About", lastModified: Date()
            )],
            posts: [SiteContentGraph.Post(
                id: "site-a:post:hello", siteID: "site-a", collection: "notes", slug: "hello",
                title: "Hello", draft: false, publishDate: nil, tags: [],
                filePath: "src/content/notes/hello.md", lastModified: Date()
            )],
            images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        // Materialize two of the three feed route modules the probe looks for.
        let notesPages = package.sourceURL.appendingPathComponent("src/pages/notes")
        try FileManager.default.createDirectory(at: notesPages, withIntermediateDirectories: true)
        try Data().write(to: notesPages.appendingPathComponent("rss.xml.ts"))
        try Data().write(to: notesPages.appendingPathComponent("atom.xml.ts"))

        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(
            site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL),
            websiteTitle: "Test")
        while navModel.nodes.isEmpty { await Task.yield() }
        model.navigator = navModel
        let dirID = try #require(navModel.nodes.first(where: {
            if case .directory = $0.kind { return true } else { return false }
        })?.id)

        model.applyNavigatorSelection(dirID)
        while model.collectionInspection == nil { await Task.yield() }
        #expect(model.collectionInspection?.feeds.map(\.kind) == [.rss, .atom])

        // Selecting a routed page again clears the collection context.
        model.applyNavigatorSelection("site-a:page:/about")
        while model.collectionInspection != nil { await Task.yield() }
        #expect(model.collectionInspection == nil)
    }
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteWindowModelTests`
Expected: compile FAILURE — `collectionInspection` not defined.

- [ ] **Step 5: Implement on `SiteWindowModel`**

(a) Add the stored property directly below `var inspectorContext: InspectorContext?` (~line 212):

```swift
    /// The inspector's collection context — set by a `.directory` navigator selection, cleared by
    /// every other selection/pane transition. Only surfaces while the main pane shows the preview
    /// (see `inspectorSelection`, added with the component case in this slice).
    var collectionInspection: CollectionInspection?
```

(b) In `applyNavigatorSelection`, `.route` branch — add one line right after `inspectorContext = await makeInspectorContext(forNavigatorID: id)` (line 847):

```swift
                collectionInspection = nil
```

(c) Replace the `.directory` branch (lines 873–883) with:

```swift
        case .directory(let collection, let route):
            // #714 slice 3 (§6): a directory shows its route in the preview and its properties
            // (type, entries, feeds, template) in the inspector's collection context.
            Task {
                guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
                activeEditor = nil
                inspectorContext = nil
                mainPaneMode = .preview
                preview.navigate(toRoute: route)
                collectionInspection = await makeCollectionInspection(
                    collection: collection, route: route, navigatorID: id)
            }
```

(d) Add the builder below `makeInspectorContext` (~line 1064):

```swift
    /// Assembles the collection context for a `.directory` selection: title/children from the
    /// navigator node, entry count from the graph, feed routes from the (off-main) probe, and
    /// type/template identity from the registry. Read-mostly v1 (#714 §6).
    private func makeCollectionInspection(
        collection: String?, route: String, navigatorID: String
    ) async -> CollectionInspection? {
        guard let site else { return nil }
        let node = navigator?.node(for: navigatorID)
        let entryCount: Int
        if let collection {
            entryCount = await contentGraph.posts(for: site.id)
                .filter { $0.collection == collection }.count
        } else {
            entryCount = node?.children?.count ?? 0
        }
        let feeds: [SiteFileTree.DetectedFeed]
        if let collection {
            let packageURL = site.packageURL
            feeds = await Task.detached {
                SiteFileTree.detectedFeeds(siteRoot: packageURL, collection: collection)
            }.value
        } else {
            feeds = []
        }
        let descriptor = collection.flatMap { ContentTypeRegistry.default.descriptor(forCollection: $0) }
        return CollectionInspection(
            title: node?.title ?? route, route: route, collection: collection,
            entryCount: entryCount, feeds: feeds,
            contentTypeName: descriptor?.displayName,
            microformat: descriptor?.projections.microformat)
    }
```

(If `contentGraph.posts(for:)` has a different signature than `(for siteID: String)`, match the call `SiteNavigatorModel.refresh` already makes.)

(e) Clear the context everywhere `inspectorContext = nil` marks a pane/selection transition. Add `collectionInspection = nil` on the line after `inspectorContext = nil` in each of: `showGraph()` (line 308), `presentCleanup()` (319), `presentReader()` (330), `presentFollowers()` (341), `presentCommunities()` (352), `openFile(_:)` (941), `handleSiteChanged()` (~502), and `close(suddenTerminationLease:)` (~549). Do **not** add it to `deleteCleanupCandidate`/`closeSurfaces` — deletes target files, and directory rows aren't deletable.

- [ ] **Step 6: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteWindowModelTests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/CollectionInspection.swift Sources/AnglesiteApp/SiteNavigatorModel.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteAppTests/SiteWindowModelTests.swift
git commit -m "feat(app): collection context for directory selections (#714)"
```

---

### Task 3: Hoist `ComponentEditorModel` + `InspectorSelection`

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift`
- Modify: `Sources/AnglesiteApp/InspectorContext.swift`
- Test: `Tests/AnglesiteAppTests/SiteWindowModelTests.swift`

**Interfaces:**
- Consumes: `ComponentEditorModel(file:context:)`, `ComponentEditorContext` (`Sources/AnglesiteApp/ComponentEditorModel.swift:11`), `EditorKind.resolve(for:)`, `PreviewModel` (`readyURL`, `mcpClient()`, `editRouter`), `CurrentSite(_: SiteStore.Site)`, `duplicateComponent(relativePath:)`.
- Produces: `SiteWindowModel.componentEditor: ComponentEditorModel?` (private(set)); `func ensureComponentEditorLoaded() async`; `enum InspectorSelection { case page(InspectorContext), component(ComponentEditorModel), collection(CollectionInspection) }`; computed `SiteWindowModel.inspectorSelection: InspectorSelection?`. Task 4 calls `ensureComponentEditorLoaded()` from a `.task`; Tasks 5–6 render the selection.

- [ ] **Step 1: Write the failing tests**

Add to `SiteWindowModelTests` (reuse `makeSitePackage`/`makeModel`):

```swift
    @Test("ensureComponentEditorLoaded creates the hoisted editor for a component file, idempotently, and rebuilds for a different file")
    func ensureComponentEditorLifecycle() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)

        await model.ensureComponentEditorLoaded()
        let first = try #require(model.componentEditor)
        #expect(first.file.id == card.id)

        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor === first)

        let badge = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Badge.astro"),
            group: .components, name: "Badge.astro")
        model.activeEditor = .text(FileEditorModel(file: badge))
        model.mainPaneMode = .editor(badge)
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor !== first)
        #expect(model.componentEditor?.file.id == badge.id)
    }

    @Test("ensureComponentEditorLoaded clears the hoisted editor for a non-component file")
    func ensureComponentEditorClearsForNonComponent() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor != nil)

        let style = FileRef(
            url: package.sourceURL.appendingPathComponent("src/styles/global.css"),
            group: .styles, name: "global.css")
        model.activeEditor = .text(FileEditorModel(file: style))
        model.mainPaneMode = .editor(style)
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor == nil)
    }

    @Test("inspectorSelection surfaces the component editor only while its file is the open editor pane")
    func inspectorSelectionComponentGating() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)
        await model.ensureComponentEditorLoaded()

        guard case .component = model.inspectorSelection else {
            Issue.record("expected .component while the component file is the open editor")
            return
        }
        // The model survives the Preview toggle (same lifetime as the editor buffer) but stops
        // surfacing as the inspector's subject.
        model.mainPaneMode = .preview
        #expect(model.componentEditor != nil)
        #expect(model.inspectorSelection == nil)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteWindowModelTests`
Expected: compile FAILURE — `componentEditor`/`ensureComponentEditorLoaded`/`inspectorSelection` not defined.

- [ ] **Step 3: Add `InspectorSelection`**

Append to `Sources/AnglesiteApp/InspectorContext.swift`:

```swift
/// The unified inspector's current subject (#714 slice 3): the page selected in the navigator,
/// the component open in the main pane, or the collection (directory) row selected in the
/// sidebar. Derived on `SiteWindowModel` (`inspectorSelection`) from the three stored sources.
@MainActor
enum InspectorSelection {
    case page(InspectorContext)
    case component(ComponentEditorModel)
    case collection(CollectionInspection)
}
```

- [ ] **Step 4: Implement on `SiteWindowModel`**

(a) Stored property, below `collectionInspection`:

```swift
    /// The hoisted Component Editor model (#714 slice 3) — created by `ensureComponentEditorLoaded()`
    /// when the active editor file is an `.astro` component, so the window inspector can host its
    /// Metadata/Style panes. Survives the Preview/Editor toggle (same lifetime as `activeEditor`'s
    /// buffer) but only *surfaces* while its file is the open editor pane — see `inspectorSelection`.
    private(set) var componentEditor: ComponentEditorModel?
```

(b) Computed selection, below the property:

```swift
    /// What the window inspector is inspecting, in precedence order. Component and collection are
    /// gated on the pane mode they belong to, so a stale value from an earlier selection can never
    /// shadow the current one after a pane toggle.
    var inspectorSelection: InspectorSelection? {
        if case .editor(let file) = mainPaneMode, let componentEditor,
           componentEditor.file.id == file.id {
            return .component(componentEditor)
        }
        if case .preview = mainPaneMode, let collectionInspection {
            return .collection(collectionInspection)
        }
        if let inspectorContext { return .page(inspectorContext) }
        return nil
    }
```

(c) Context factory + lifecycle methods (place next to `makeCollectionInspection`). The context construction moves here verbatim from `SiteWindow.mainPaneContent` (lines 797–813) — same `editRouter` reuse rationale:

```swift
    /// Builds the Component Editor's context from current preview state. Mirrors what
    /// `SiteWindow.mainPaneContent` used to construct inline: `editRouter` is deliberately
    /// `preview.editRouter` — the registered, chat-history-wired router the preview canvas uses —
    /// so edits made through either canvas behave identically.
    private func makeComponentEditorContext(site: SiteStore.Site) -> ComponentEditorContext {
        ComponentEditorContext(
            baseURL: preview.readyURL,
            modelClient: ComponentModelClient(mcpClient: { [preview] in await preview.mcpClient() }),
            sourceRoot: site.sourceDirectory,
            site: CurrentSite(site),
            editRouter: preview.editRouter,
            onOpenFile: { [weak self] file in self?.openFile(file) },
            duplicateComponent: { [weak self] relativePath in
                await self?.duplicateComponent(relativePath: relativePath) ?? .siteNotFound
            }
        )
    }

    /// (Re)builds the hoisted component editor for the active editor file when it is an `.astro`
    /// component — keyed on (file, dev-server baseURL) exactly like `ComponentEditorView`'s old
    /// view-local `LoadKey`: a nil→non-nil `readyURL` transition rebuilds the model so the harness
    /// canvas can load; anything else is idempotent. Clears the editor for non-component files.
    @MainActor
    func ensureComponentEditorLoaded() async {
        guard let site, let file = activeEditorFile,
              EditorKind.resolve(for: file) == .component else {
            componentEditor = nil
            return
        }
        if let existing = componentEditor, existing.file.id == file.id,
           existing.context.baseURL == preview.readyURL {
            return
        }
        let editor = ComponentEditorModel(file: file, context: makeComponentEditorContext(site: site))
        componentEditor = editor
        await editor.load()
    }
```

(d) Teardown: in `handleSiteChanged()` and `close(suddenTerminationLease:)`, add `componentEditor = nil` beside the `collectionInspection = nil` added in Task 2. In `deleteCleanupCandidate` (after the `activeEditor = nil` at line ~1026): 

```swift
        if componentEditor?.file.url == deletedURL {
            componentEditor = nil
        }
```

Component writes are immediate MCP ops (no save-on-leave), so no flush is needed anywhere `leaveCurrentEditor` runs; in-progress props/code drafts are discarded on teardown exactly as the old view-local model was.

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteWindowModelTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/InspectorContext.swift Tests/AnglesiteAppTests/SiteWindowModelTests.swift
git commit -m "feat(app): hoist ComponentEditorModel to SiteWindowModel (#714)"
```

---

### Task 4: Thread the hoisted model through the views

**Files:**
- Modify: `Sources/AnglesiteApp/ComponentEditorView.swift`
- Modify: `Sources/AnglesiteApp/MainPaneEditorView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (`mainPaneContent`, lines 790–821)

**Interfaces:**
- Consumes: Task 3's `model.componentEditor` / `ensureComponentEditorLoaded()`.
- Produces: `ComponentEditorView(model:fileEditor:)` (file/context read off the model); `MainPaneEditorView(model:componentEditor:)`. The in-pane inspector column still renders in this task — behavior is unchanged; only ownership moved.

- [ ] **Step 1: Rework `ComponentEditorView`**

In `Sources/AnglesiteApp/ComponentEditorView.swift`:
- Replace the stored inputs and model state:

```swift
struct ComponentEditorView: View {
    @Bindable var model: ComponentEditorModel
    @Bindable var fileEditor: FileEditorModel
```

  (delete `let file: FileRef`, `let context: ComponentEditorContext`, `@State private var model: ComponentEditorModel?`, the memberwise `init`, the `LoadKey` struct, the `loadKey` property, and the `.task(id: loadKey) { … }` modifier — creation/reload is `SiteWindowModel.ensureComponentEditorLoaded`'s job now, driven by Step 3's `.task` in `SiteWindow`.)
- Add convenience accessors so the body reads unchanged:

```swift
    private var file: FileRef { model.file }
    private var context: ComponentEditorContext { model.context }
```

- The six transient inspector `@State`s (`codeZone`, `newRuleSelector`, `newRuleMedia`, `collapsedMediaKeys`, `newAttrName`, `newAttrValue`) **stay in this task** (the in-pane inspector still uses them; Task 6 removes them).
- In `body`, `designPane`, `sourcePane`, and the `.onChange`/`.sheet` closures: remove the now-unneeded `if let model` / `guard let model` unwraps and optional chaining (`model?.selectedNodeID` → `model.selectedNodeID`, `model?.loadErrorReason` → `model.loadErrorReason`); `designPane`'s outer `if let model { … } else { ProgressView() }` collapses to its non-nil body. `highlightInCanvas` drops `let model` from its guard.

- [ ] **Step 2: Rework `MainPaneEditorView`**

Replace `var componentContext: ComponentEditorContext? = nil` (line 15) with:

```swift
    /// The window-owned Component Editor model (#714 slice 3); non-nil once
    /// `SiteWindowModel.ensureComponentEditorLoaded()` has run for this file. `nil` falls back to
    /// the plain text editor (first frame before activation, or no site window wiring, e.g.
    /// previews).
    var componentEditor: ComponentEditorModel? = nil
```

and the `.component` case body with:

```swift
                    case .component:
                        if let componentEditor {
                            ComponentEditorView(model: componentEditor, fileEditor: model)
                        } else {
                            TextEditor(text: $model.text)
                                .font(.system(.body, design: .monospaced))
                                .scrollContentBackground(.hidden)
                        }
```

- [ ] **Step 3: Rework `SiteWindow.mainPaneContent`**

Replace the `.editor` / `.text` branch (lines 794–814) — the inline `ComponentEditorContext` construction is deleted (it moved to `SiteWindowModel.makeComponentEditorContext` in Task 3):

```swift
        case .editor:
            if case .text(let editorModel) = model.activeEditor {
                MainPaneEditorView(model: editorModel, componentEditor: model.componentEditor)
                    // Re-fires on file change AND on the dev server becoming ready (nil→non-nil
                    // readyURL) — the same identity the old view-local LoadKey watched — so the
                    // hoisted model rebuilds exactly when the old @State model did.
                    .task(id: ComponentEditorActivationKey(
                        baseURL: model.preview.readyURL?.absoluteString,
                        fileID: editorModel.file.id
                    )) {
                        await model.ensureComponentEditorLoaded()
                    }
            } else if case .plist(let plistEditorModel) = model.activeEditor {
```

(the `.plist` and fallback branches are unchanged). Add next to `mainPaneContent`:

```swift
    /// Task identity for component-editor activation — see the `.task` above.
    private struct ComponentEditorActivationKey: Hashable {
        let baseURL: String?
        let fileID: String
    }
```

- [ ] **Step 4: Verify — build + full test**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` (run `xcodegen generate` first if this worktree hasn't)
Expected: BUILD SUCCEEDED.
Run: `swift test --package-path .`
Expected: PASS — in particular every `ComponentEditorModel*Tests` suite (draft state, drag-drop, structure, code edits) still passes untouched; they construct the model directly and never depended on view ownership.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/ComponentEditorView.swift Sources/AnglesiteApp/MainPaneEditorView.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "refactor(app): component editor uses the window-owned model (#714)"
```

---

### Task 5: Extract the component inspector panes

**Files:**
- Create: `Sources/AnglesiteApp/ComponentEditBannerViews.swift`
- Create: `Sources/AnglesiteApp/ComponentMetadataInspectorPane.swift`
- Create: `Sources/AnglesiteApp/ComponentStyleInspectorPane.swift`

**Interfaces:**
- Consumes: `ComponentEditorModel` draft accessors/commit methods (unchanged), `ComponentStyleGrouping`, `CSSColor`.
- Produces: `ComponentMetadataInspectorPane(model:)` and `ComponentStyleInspectorPane(model:webView:)` — self-contained (own transient `@State`), hosted by Task 6's `SiteInspectorView`. Unreferenced until Task 6 (they compile; the old pane keeps rendering until then).

The code below is moved from `ComponentEditorInspectorPane.swift` — when in doubt, diff against that file: logic must be identical, only state ownership changes (the `@Binding`s become local `@State`).

- [ ] **Step 1: Create the shared banners**

`Sources/AnglesiteApp/ComponentEditBannerViews.swift`:

```swift
import SwiftUI

/// The two dismissible write-status banners shared by the unified inspector's component panes
/// (#714 slice 3) — extracted from the retired `ComponentEditorInspectorPane` so the Metadata and
/// Style tabs can each surface them beside the controls that trigger writes.
///
/// "This component changed outside Anglesite" — the edit that triggered a stale-write refusal was
/// never applied; `ComponentEditorModel.applyComponentStyleEdit` already reloaded the latest
/// version, so this just informs the user why their change didn't stick.
struct ComponentConflictBanner: View {
    @Bindable var model: ComponentEditorModel

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(.orange)
            Text("This component changed outside Anglesite — your edit wasn't applied, reloaded the latest version.")
                .font(.caption)
            Spacer()
            Button {
                model.conflict = false
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(8)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// Transient, non-fatal banner for a write op that failed for a reason other than staleness
/// (invalid value, drifted `ruleSpan`, transient MCP error). Scoped to the inspector panes so a
/// routine write failure never takes over the whole editor (see `ComponentEditorModel.writeError`).
struct ComponentWriteErrorBanner: View {
    @Bindable var model: ComponentEditorModel
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
            Text(message).font(.caption)
            Spacer()
            Button {
                model.writeError = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(8)
        .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }
}
```

- [ ] **Step 2: Create the Metadata pane**

`Sources/AnglesiteApp/ComponentMetadataInspectorPane.swift` — `selectionGroup`, `attrValueBinding`, and `propsForm` move verbatim from `ComponentEditorInspectorPane` (lines 51–140); `newAttrName`/`newAttrValue` become local `@State`:

```swift
import SwiftUI
import AnglesiteCore

/// Metadata tab of the unified inspector while a component is open (#714 slice 3): the selected
/// node's attributes and the component-level Props form. Extracted from the retired in-pane
/// `ComponentEditorInspectorPane`; the transient add-attribute form state is owned here.
struct ComponentMetadataInspectorPane: View {
    @Bindable var model: ComponentEditorModel
    @State private var newAttrName: String = ""
    @State private var newAttrValue: String = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.conflict {
                    ComponentConflictBanner(model: model)
                }
                if let writeError = model.writeError {
                    ComponentWriteErrorBanner(model: model, message: writeError)
                }
                if let node = model.selectedNode {
                    selectionGroup(node: node)
                } else {
                    Text("Select an element in the canvas")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                propsForm
            }
            .padding(10)
        }
    }

    // MARK: - Selection / attributes

    private func selectionGroup(node: ComponentModel.Node) -> some View {
        GroupBox("Selection") {
            LabeledContent("Kind", value: node.kind.rawValue)
            if let tag = node.tag { LabeledContent("Tag", value: tag) }
            ForEach(node.attrs, id: \.name) { attr in
                HStack(spacing: 4) {
                    Text(attr.name).font(.system(.caption, design: .monospaced)).frame(width: 90, alignment: .leading)
                    TextField("value", text: attrValueBinding(node: node, name: attr.name))
                        .font(.system(.caption, design: .monospaced))
                        .textFieldStyle(.plain)
                        .onSubmit { model.commitAttr(node: node, name: attr.name) }
                    Button(role: .destructive) {
                        model.removeAttr(node: node, name: attr.name)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack {
                TextField("New attribute name", text: $newAttrName)
                    .font(.system(.caption, design: .monospaced))
                TextField("value", text: $newAttrValue)
                    .font(.system(.caption, design: .monospaced))
                Button("Add") {
                    let name = newAttrName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    Task {
                        await model.setAttr(nodeId: node.id, name: name, value: newAttrValue)
                        newAttrName = ""
                        newAttrValue = ""
                    }
                }
                .disabled(newAttrName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func attrValueBinding(node: ComponentModel.Node, name: String) -> Binding<String> {
        Binding(
            get: { model.attrValueDraft(node: node, name: name) },
            set: { model.setAttrValueDraft($0, node: node, name: name) }
        )
    }

    // MARK: - Props form

    /// Structured Props form (component-editor design spec §4.3): the component's `Props`
    /// interface as name/type/optional/default rows, independent of outline selection — props
    /// belong to the component as a whole, not to any one template node. Edits accumulate in
    /// `model.propsDraft` and commit together via "Save Props".
    private var propsForm: some View {
        GroupBox("Props") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach($model.propsDraft) { $prop in
                    HStack(spacing: 4) {
                        TextField("name", text: $prop.name)
                            .font(.system(.caption, design: .monospaced))
                            .frame(width: 80)
                        TextField("type", text: $prop.type)
                            .font(.system(.caption, design: .monospaced))
                            .frame(width: 70)
                        Toggle("optional", isOn: $prop.optional)
                            .labelsHidden()
                            .help("Optional")
                        TextField("default", text: $prop.defaultValue)
                            .font(.system(.caption, design: .monospaced))
                        Button(role: .destructive) {
                            model.propsDraft.removeAll { $0.id == prop.id }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack {
                    Button("Add Prop") {
                        model.propsDraft.append(ComponentEditorModel.PropDraft(name: "", type: "string", optional: false, defaultValue: ""))
                    }
                    .font(.caption2)
                    .buttonStyle(.plain)
                    Spacer()
                    Button("Save Props") {
                        Task { await model.savePropsDraft() }
                    }
                    .disabled(!model.propsDraftDirty)
                }
            }
        }
    }
}
```

- [ ] **Step 3: Create the Style pane**

`Sources/AnglesiteApp/ComponentStyleInspectorPane.swift` — `stylesGroup` through `computedGroup` move verbatim from `ComponentEditorInspectorPane` (lines 188–364); `newRuleSelector`/`newRuleMedia`/`collapsedMediaKeys` become local `@State`:

```swift
import SwiftUI
import WebKit
import AnglesiteCore

/// Style tab of the unified inspector while a component is open (#714 slice 3): the component's
/// scoped style rules (grouped by media, editable) and the selected element's computed values.
/// Extracted from the retired in-pane `ComponentEditorInspectorPane`; the transient add-rule and
/// collapse state is owned here.
///
/// `webView` is read-only — the harness canvas's live handle, used only to push a live scrub
/// preview while a `ColorPicker` drags; the model has no webview handle of its own.
struct ComponentStyleInspectorPane: View {
    @Bindable var model: ComponentEditorModel
    var webView: WKWebView?
    @State private var newRuleSelector: String = ""
    @State private var newRuleMedia: String = ""
    @State private var collapsedMediaKeys: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.conflict {
                    ComponentConflictBanner(model: model)
                }
                if let writeError = model.writeError {
                    ComponentWriteErrorBanner(model: model, message: writeError)
                }
                stylesGroup
                computedGroup
            }
            .padding(10)
        }
    }

    // MARK: - Styles panel

    private var stylesGroup: some View {
        GroupBox("Styles") {
            if let styles = model.model?.styles, !styles.isEmpty {
                let groups = ComponentStyleGrouping.groups(from: styles)
                ForEach(Array(groups.enumerated()), id: \.offset) { groupIndex, group in
                    DisclosureGroup(isExpanded: mediaExpandedBinding(for: group.media)) {
                        ForEach(Array(group.rules.enumerated()), id: \.element.index) { position, indexed in
                            ruleRow(ruleIndex: indexed.index, rule: indexed.rule)
                            if position < group.rules.count - 1 {
                                Divider()
                            }
                        }
                    } label: {
                        Text(group.media.map { "@media \($0)" } ?? "Base styles")
                            .font(.caption).bold()
                    }
                    if groupIndex < groups.count - 1 {
                        Divider()
                    }
                }
            } else {
                Text("No scoped styles").foregroundStyle(.secondary)
            }
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    TextField("New selector, e.g. .card-footer", text: $newRuleSelector)
                        .font(.system(.caption, design: .monospaced))
                    TextField("Condition, e.g. (min-width: 768px)", text: $newRuleMedia)
                        .font(.system(.caption, design: .monospaced))
                }
                Button("Add rule") {
                    let selector = newRuleSelector.trimmingCharacters(in: .whitespaces)
                    guard !selector.isEmpty else { return }
                    let media = ComponentStyleGrouping.normalizeMediaCondition(newRuleMedia)
                    Task {
                        await model.addStyleRule(selector: selector, media: media.isEmpty ? nil : media, declarations: [])
                        newRuleSelector = ""
                        newRuleMedia = ""
                    }
                }
                .disabled(newRuleSelector.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    /// Stable dictionary/Set key for a media group — `""` for the unscoped "Base styles" group,
    /// the media condition string otherwise. Mirrors `ComponentStyleGrouping.groups`' own
    /// `key.isEmpty ? nil : key` convention so the two stay in sync.
    private func mediaGroupKey(_ media: String?) -> String { media ?? "" }

    /// Expand/collapse binding for one media group's `DisclosureGroup`, backed by
    /// `collapsedMediaKeys` — defaults to expanded (absent from the set) so the panel reads the
    /// same as the old always-expanded flat list until the user explicitly collapses a section.
    private func mediaExpandedBinding(for media: String?) -> Binding<Bool> {
        let key = mediaGroupKey(media)
        return Binding(
            get: { !collapsedMediaKeys.contains(key) },
            set: { expanded in
                if expanded {
                    collapsedMediaKeys.remove(key)
                } else {
                    collapsedMediaKeys.insert(key)
                }
            }
        )
    }

    /// One rule's editable selector + declaration rows, grouped by media above.
    @ViewBuilder
    private func ruleRow(ruleIndex: Int, rule: ComponentModel.StyleRule) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("selector", text: selectorBinding(for: rule))
                .font(.system(.caption, design: .monospaced))
                .textFieldStyle(.plain)
                .bold()
                .onSubmit { model.commitSelector(rule: rule) }
            ForEach(rule.declarations, id: \.property) { decl in
                HStack(spacing: 4) {
                    TextField("property", text: propertyBinding(for: decl))
                        .font(.system(.caption, design: .monospaced))
                        .textFieldStyle(.plain)
                        .frame(width: 110)
                        .onSubmit { Task { await model.commitDeclaration(ruleIndex: ruleIndex, rule: rule, decl: decl) } }
                    Text(":")
                    declarationValueField(ruleIndex: ruleIndex, rule: rule, decl: decl)
                    Button(role: .destructive) {
                        model.removeDeclaration(rule: rule, decl: decl)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                }
            }
            Button("Add declaration") {
                let newProperty = "new-property-\(UUID().uuidString.prefix(8))"
                Task { await model.setStyleProperty(ruleSpan: [rule.span.start, rule.span.end], property: newProperty, value: "") }
            }
            .font(.caption2)
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private func selectorBinding(for rule: ComponentModel.StyleRule) -> Binding<String> {
        Binding(
            get: { model.selectorDraft(for: rule) },
            set: { model.setSelectorDraft($0, for: rule) }
        )
    }

    private func propertyBinding(for decl: ComponentModel.Declaration) -> Binding<String> {
        Binding(
            get: { model.propertyDraft(for: decl) },
            set: { model.setPropertyDraft($0, for: decl) }
        )
    }

    @ViewBuilder
    private func declarationValueField(
        ruleIndex: Int,
        rule: ComponentModel.StyleRule,
        decl: ComponentModel.Declaration
    ) -> some View {
        let valueBinding = Binding(
            get: { model.valueDraft(for: decl) },
            set: { model.setValueDraft($0, for: decl) }
        )
        HStack(spacing: 4) {
            TextField("value", text: valueBinding)
                .font(.system(.caption, design: .monospaced))
                .textFieldStyle(.plain)
                .onSubmit { Task { await model.commitDeclaration(ruleIndex: ruleIndex, rule: rule, decl: decl) } }
            if CSSColor.colorProperties.contains(decl.property),
               let color = CSSColor.parse(valueBinding.wrappedValue) {
                ColorPicker("", selection: Binding(
                    get: { color },
                    set: { newColor in
                        let formatted = CSSColor.format(newColor)
                        model.setValueDraft(formatted, for: decl)
                        webView?.evaluateJavaScript(
                            "window.anglesiteCanvas?.scrub?.(\(jsStringLiteral(rule.selector)), \(jsStringLiteral(decl.property)), \(jsStringLiteral(formatted)))"
                        )
                        model.debounceColorCommit(ruleIndex: ruleIndex, rule: rule, decl: decl) {
                            Task { _ = try? await webView?.evaluateJavaScript("window.anglesiteCanvas?.clearScrub?.()") }
                        }
                    }
                ))
                .labelsHidden()
            }
        }
    }

    /// Escapes a Swift string into a double-quoted JS string literal for
    /// interpolation into `evaluateJavaScript` call sites.
    private func jsStringLiteral(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    // MARK: - Computed

    private var computedGroup: some View {
        GroupBox("Computed") {
            if model.computedStyles.isEmpty {
                Text("Select an element in the canvas").foregroundStyle(.secondary)
            } else {
                ForEach(model.computedStyles.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                    LabeledContent(key, value: value)
                        .font(.system(.caption, design: .monospaced))
                }
            }
        }
    }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `swift test --package-path . --filter SiteWindowModelTests`
Expected: PASS (compiles the whole AnglesiteAppCore target including the three new files; the panes are intentionally unreferenced until Task 6).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/ComponentEditBannerViews.swift Sources/AnglesiteApp/ComponentMetadataInspectorPane.swift Sources/AnglesiteApp/ComponentStyleInspectorPane.swift
git commit -m "feat(app): extract component inspector panes (#714)"
```

---

### Task 6: `SiteInspectorView` — flip the window inspector to the unified selection

**Files:**
- Create: `Sources/AnglesiteApp/SiteInspectorView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (focused value lines 163–167; inspector lines 262–275; toolbar `inspector` item line ~524)
- Modify: `Sources/AnglesiteApp/ComponentEditorView.swift` (drop the inspector column + transient state; forward the webView)
- Modify: `Sources/AnglesiteApp/MainPaneEditorView.swift` (thread `onCanvasWebView`)
- Delete: `Sources/AnglesiteApp/ComponentEditorInspectorPane.swift`, `Sources/AnglesiteApp/ComponentEditorCodePane.swift`

**Interfaces:**
- Consumes: `InspectorSelection` (Task 3), `ComponentMetadataInspectorPane`/`ComponentStyleInspectorPane` (Task 5), `CollectionInspection` (Task 2), existing `PageInspectorView`.
- Produces: `SiteInspectorView(selection:canvasWebView:previewBaseURL:)`; `MainPaneEditorView(model:componentEditor:onCanvasWebView:)`; `ComponentEditorView(model:fileEditor:onWebView:)`.

- [ ] **Step 1: Create the tabbed shell + collection form**

`Sources/AnglesiteApp/SiteInspectorView.swift`:

```swift
import SwiftUI
import WebKit
import AnglesiteCore

/// Which unified-inspector tab is showing. `String` raw value for `@SceneStorage` persistence.
enum SiteInspectorTab: String {
    case metadata, style
}

/// The window's one inspector (#714 slice 3): a Pages-style Metadata | Style tab pair over the
/// current selection — the routed page, the open component, or the selected collection. Content
/// per (selection, tab) follows the spec §4 table; the tab choice persists per window.
struct SiteInspectorView: View {
    let selection: InspectorSelection
    /// The component harness canvas's live webview (nil outside component mode) — threaded to the
    /// Style pane for the ColorPicker scrub preview.
    var canvasWebView: WKWebView?
    /// Dev-server origin for the collection form's feed preview links; nil until the server is up.
    var previewBaseURL: URL?
    @SceneStorage("siteInspector.tab") private var tab: SiteInspectorTab = .metadata

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector Tab", selection: $tab) {
                Text("Metadata").tag(SiteInspectorTab.metadata)
                Text("Style").tag(SiteInspectorTab.style)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            Divider()
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch (selection, tab) {
        case (.page(let context), .metadata):
            PageInspectorView(context: context)
        case (.component(let model), .metadata):
            ComponentMetadataInspectorPane(model: model)
        case (.component(let model), .style):
            ComponentStyleInspectorPane(model: model, webView: canvasWebView)
        case (.collection(let inspection), .metadata):
            CollectionInspectorForm(inspection: inspection, previewBaseURL: previewBaseURL)
        case (.page, .style), (.collection, .style):
            // Element-level styling needs an element selection, which only the component canvas
            // provides today; preview-page element selection is the next-phase design (spec §4).
            ContentUnavailableView(
                "Select something on the page", systemImage: "cursorarrow.rays")
        }
    }
}

/// Read-mostly collection properties (spec §6): type, entries, feeds, template, sitemap status.
struct CollectionInspectorForm: View {
    let inspection: CollectionInspection
    var previewBaseURL: URL?

    var body: some View {
        Form {
            LabeledContent("Route", value: inspection.route)
            if let contentTypeName = inspection.contentTypeName {
                LabeledContent("Content Type", value: contentTypeName)
            }
            LabeledContent("Entries", value: "\(inspection.entryCount)")
            if let microformat = inspection.microformat {
                LabeledContent("Template", value: Self.templateDisplayName(microformat))
            }
            Section("Feeds") {
                if inspection.feeds.isEmpty {
                    Text("No feeds").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(inspection.feeds) { feed in
                        if let base = previewBaseURL,
                           let url = URL(string: feed.route, relativeTo: base) {
                            Link(destination: url) {
                                LabeledContent(Self.feedKindLabel(feed.kind), value: feed.route)
                            }
                        } else {
                            LabeledContent(Self.feedKindLabel(feed.kind), value: feed.route)
                        }
                    }
                }
            }
            Section {
                LabeledContent("Sitemap", value: "Not configured")
            }
        }
        .formStyle(.grouped)
    }

    private static func feedKindLabel(_ kind: SiteFileTree.DetectedFeed.Kind) -> String {
        switch kind {
        case .rss: "RSS"
        case .atom: "Atom"
        case .json: "JSON Feed"
        }
    }

    /// "h-entry" → "Hentry" — the template's static-dispatch layout naming (Hentry.astro etc.).
    private static func templateDisplayName(_ microformat: String) -> String {
        let parts = microformat.split(separator: "-")
        guard parts.first == "h", parts.count > 1 else { return microformat }
        return "H" + parts.dropFirst().joined()
    }
}
```

- [ ] **Step 2: Point the window inspector at the selection**

In `Sources/AnglesiteApp/SiteWindow.swift`:

(a) Focused value (lines 163–167) — replace both `model.inspectorContext != nil` checks:

```swift
            .focusedSceneValue(\.inspectorPanel, InspectorPanelActions(
                isShown: inspectorShown && model.inspectorSelection != nil,
                isAvailable: model.inspectorSelection != nil,
                toggle: { inspectorShown.toggle() }
            ))
```

(b) The `.inspector` block (lines 262–275):

```swift
        .inspector(isPresented: Binding(
            get: { inspectorShown && model.inspectorSelection != nil },
            set: { newValue in
                // Only persist an explicit show/hide while there is something to inspect.
                // When the selection is nil the panel is auto-hidden; ignore that write so
                // it doesn't clobber the remembered preference (the bug: inspector never returns).
                if model.inspectorSelection != nil { inspectorShown = newValue }
            }
        )) {
            if let selection = model.inspectorSelection {
                SiteInspectorView(
                    selection: selection,
                    canvasWebView: componentCanvasWebView,
                    previewBaseURL: model.preview.readyURL
                )
                .inspectorColumnWidth(min: 260, ideal: 300, max: 420)
            }
        }
```

(c) Toolbar `inspector` item (~line 524): `.disabled(model.inspectorContext == nil)` → `.disabled(model.inspectorSelection == nil)`.

(d) Add the canvas handle state next to the other `@State`/`@SceneStorage` declarations (~line 24), and `import WebKit` at the top if the file doesn't already have it:

```swift
    /// The component harness canvas's live webview, bubbled up through
    /// `MainPaneEditorView`/`ComponentEditorView` so the window inspector's Style pane can drive
    /// the ColorPicker scrub preview (#714 slice 3). A UI resource handle — view state, not model
    /// state.
    @State private var componentCanvasWebView: WKWebView?
```

(e) In `mainPaneContent`'s `.editor`/`.text` branch (Task 4's version), thread the callback:

```swift
                MainPaneEditorView(
                    model: editorModel,
                    componentEditor: model.componentEditor,
                    onCanvasWebView: { componentCanvasWebView = $0 }
                )
```

- [ ] **Step 3: Thread the webView callback and drop the in-pane column**

(a) `Sources/AnglesiteApp/MainPaneEditorView.swift` — add below `componentEditor`:

```swift
    /// Bubbles the component harness canvas's webview up to the window (for the inspector's
    /// scrub preview). nil when unused (previews/tests).
    var onCanvasWebView: ((WKWebView?) -> Void)? = nil
```

(add `import WebKit` if missing) and pass it in the `.component` case:

```swift
                            ComponentEditorView(
                                model: componentEditor, fileEditor: model,
                                onWebView: onCanvasWebView)
```

(b) `Sources/AnglesiteApp/ComponentEditorView.swift`:
- Add the property below `fileEditor`:

```swift
    /// Forwards the canvas webview to the host window (for the unified inspector's scrub
    /// preview) in addition to this view's own `webView` state (used for highlight pushes).
    var onWebView: ((WKWebView?) -> Void)? = nil
```

- In `designPane`, the canvas pane's callback becomes:

```swift
                    ComponentEditorCanvasPane(
                        model: model,
                        context: context,
                        viewportPreset: $viewportPreset,
                        onWebView: { webView = $0; onWebView?($0) }
                    )
                    .frame(minWidth: 320).layoutPriority(1)
```

- Delete the `ComponentEditorInspectorPane(...)` third column from the `HSplitView` (lines 182–192) — the split keeps outline + canvas only.
- Delete the now-unused transient `@State`s: `codeZone`, `newRuleSelector`, `newRuleMedia`, `collapsedMediaKeys`, `newAttrName`, `newAttrValue` (lines 34–45).

(c) Delete the superseded files:

```bash
git rm Sources/AnglesiteApp/ComponentEditorInspectorPane.swift Sources/AnglesiteApp/ComponentEditorCodePane.swift
```

The code zone is dropped from the inspector by design (spec §4): Design/Source mode covers source editing. `ComponentEditorModel`'s `codeDrafts`/`setScriptZone` machinery and its tests stay — the model API remains the seam for a future surface.

If anything else still references `ComponentEditorCodePane` (check: `grep -rn "ComponentEditorCodePane" Sources Tests`), the build in Step 4 will say so — the only expected reference was the deleted pane; a `CodeZone` UI-label extension living in `ComponentEditorCodePane.swift` (per `ComponentEditorModel.CodeZone`'s doc comment) dies with the file since `CodeZone` itself lives on the model.

- [ ] **Step 4: Verify — build + full test**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.
Run: `swift test --package-path .`
Expected: PASS.

- [ ] **Step 5: Manual smoke (app run)**

Launch the built app with a test site and verify:
1. Selecting a page shows the inspector with Metadata (today's forms) and a Style placeholder.
2. Selecting a collection (blog/notes) shows Route/Content Type/Entries/Template/Feeds/Sitemap in Metadata.
3. Opening a component shows the editor as outline + canvas (no third column); the window inspector shows Selection/Props under Metadata and Styles/Computed under Style; clicking a canvas element updates both; a ColorPicker drag scrubs the canvas live.
4. The tab choice survives switching selections and window relaunch; View ▸ Show/Hide Inspector and the toolbar toggle work in all three modes.

- [ ] **Step 6: Commit**

```bash
git add -A Sources/AnglesiteApp
git commit -m "feat(app): unified tabbed window inspector (#714)"
```

---

### Task 7: Localization catalog + final verification

**Files:**
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (generated sync)

- [ ] **Step 1: Sync the string catalog**

New user-visible strings (tab labels, placeholder, collection form labels/values, feed labels) and removed ones (code pane labels) must reach the catalog. Per CONTRIBUTING (worktree-scoped, never a bare DerivedData glob):

```bash
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

Review `git diff Sources/AnglesiteApp/Localizable.xcstrings`: only keys this branch added/touched may appear ("Metadata", "Style", "Select something on the page", "Route", "Content Type", "Entries", "Template", "Feeds", "No feeds", "Sitemap", "Not configured", "RSS", "Atom", "JSON Feed", "Inspector Tab", banner text). If keys from unrelated branches appear, discard and re-run scoped per CONTRIBUTING.

- [ ] **Step 2: Full verification**

```bash
scripts/check-localization-catalog.sh
swift test --package-path .
```

Expected: both pass. (Template untouched, so no template-coupled suites should be affected — but the full run confirms.)

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(app): sync localization catalog for the unified inspector (#714)"
```

---

## Self-Review Notes (spec → tasks)

- Spec §4 table row "element" → Tasks 5–6 (Metadata: selection+props; Style: styles+computed+banners; banners appear in both panes — a deliberate superset of the spec so attr-write failures are visible on the Metadata tab too).
- Spec §4 "page" row → Task 6 (`PageInspectorView` unchanged under Metadata; placeholder under Style).
- Spec §4 "collection" row + §6 → Tasks 1, 2, 6.
- Spec §4 "model hoisting" → Tasks 3–4. "Presentation gate" → Task 6 Step 2. "Code zone dropped" → Task 6 Step 3. "In-pane column removed" → Task 6 Step 3.
- `@SceneStorage("siteInspector.tab")` → Task 6 Step 1.
- Spec testing bullets (gate, lifecycle, directory context, route restore) → Tasks 2–3 tests.
- Known accepted behavior changes: (1) one-frame plain-text flash before `ensureComponentEditorLoaded` lands (old code showed a ProgressView built by the view-local task); (2) inspector width 260–420pt vs the old in-pane 220–260pt (spec risk, cosmetic); (3) in-progress component props/code drafts are discarded when the window closes — identical to the old view-local teardown.
