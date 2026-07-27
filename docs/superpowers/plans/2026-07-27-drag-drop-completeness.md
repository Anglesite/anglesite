# Drag & drop completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sites and content items be dragged out of Anglesite (to Finder, Terminal, other apps), and give the launcher's existing drop target a visible targeted highlight.

**Architecture:** Pure SwiftUI/AppKit additions to two existing views (`SitesLauncherView`, `SiteNavigatorView`) plus one small model accessor (`SiteNavigatorModel.fileURL(for:)`) backed by a new synchronous id→URL cache built during the model's existing refresh cycle. No new files, no new dependencies, no MCP/schema changes.

**Tech Stack:** Swift 6.4, SwiftUI, `Transferable`/`.draggable(_:)`, Swift Testing.

## Global Constraints

- Swift/SwiftUI with Apple frameworks only — no new dependencies.
- Conventional commits; subject ≤72 characters; reference `#676`.
- Design doc: `docs/superpowers/specs/2026-07-27-drag-drop-completeness-design.md` — read it before starting if you need the "why", this plan covers the "how".
- Drop-highlight fidelity is intentionally simple: it lights up for **any** file-URL drag over the launcher list, not just valid `.anglesite` packages (locked decision, see design doc). Do not add content-type validation.
- Navigator drag-out only applies to `.route` targets (pages/posts) today — `.file` targets are currently unreachable (see Task 1) and `.directory`/`.websiteSettings` are explicitly out of scope.

---

### Task 1: `SiteNavigatorModel.fileURL(for:)` + `routeFileURLs` cache

**Files:**
- Modify: `Sources/AnglesiteApp/SiteNavigatorModel.swift:46` (new stored property, next to `postsByID`), `Sources/AnglesiteApp/SiteNavigatorModel.swift:252-274` (`refresh(siteID:siteRoot:)`), `Sources/AnglesiteApp/SiteNavigatorModel.swift:96` (near `target(for:)`, add the new accessor)
- Test: `Tests/AnglesiteAppTests/SiteNavigatorModelTests.swift`

**Interfaces:**
- Consumes: existing `SiteNavigatorModel.target(for id: String) -> NavigatorTarget?` (line 96), existing `refresh(siteID:siteRoot:)` locals `pages: [SiteContentGraph.Page]` and `posts: [SiteContentGraph.Post]` (both already fetched at the top of that function), `self.sourceDirectory: URL?` (set in `start(site:websiteTitle:)`), `SiteContentGraph.Page.filePath`/`.id` and `SiteContentGraph.Post.filePath`/`.id` (both `String`).
- Produces: `func fileURL(for id: String) -> URL?` — later tasks (Task 2) call this to decide whether a navigator row is draggable and with what URL.

- [ ] **Step 1: Write the failing tests**

Add these three tests inside the existing `@Suite("SiteNavigatorModel")` struct in `Tests/AnglesiteAppTests/SiteNavigatorModelTests.swift` (it already has a private top-level `flatten(_:)` helper you can reuse — do not redefine it):

```swift
    @Test("fileURL(for:) resolves a route (page) target to its sourceDirectory-relative file")
    func fileURLResolvesRouteTarget() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-1",
            pages: [SiteContentGraph.Page(
                id: "site-1:page:/about", siteID: "site-1", route: "/about",
                filePath: "src/pages/about.astro", title: "About", lastModified: Date())],
            posts: [], images: []
        )
        let model = SiteNavigatorModel(graph: graph)
        model.start(site: CurrentSite(id: "site-1", packageURL: root, sourceDirectory: root), websiteTitle: "Test")
        while model.nodes.isEmpty { await Task.yield() }
        let id = try #require(flatten(model.nodes).first { $0.title == "About" }?.id)

        #expect(model.fileURL(for: id) == root.appendingPathComponent("src/pages/about.astro"))
    }

    @Test("fileURL(for:) resolves a route (post) target to its sourceDirectory-relative file")
    func fileURLResolvesPostRouteTarget() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-1",
            pages: [],
            posts: [SiteContentGraph.Post(
                id: "site-1:post:hello", siteID: "site-1", collection: "blog", slug: "hello",
                title: "Hello", draft: false, publishDate: Date(), tags: [],
                filePath: "src/content/blog/hello.md", lastModified: Date())],
            images: []
        )
        let model = SiteNavigatorModel(graph: graph)
        model.start(site: CurrentSite(id: "site-1", packageURL: root, sourceDirectory: root), websiteTitle: "Test")
        while model.nodes.isEmpty { await Task.yield() }
        let id = try #require(flatten(model.nodes).first { $0.title == "Hello" }?.id)

        #expect(model.fileURL(for: id) == root.appendingPathComponent("src/content/blog/hello.md"))
    }

    @Test("fileURL(for:) is nil for the website-settings row")
    func fileURLNilForWebsiteSettingsRow() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-1",
            pages: [SiteContentGraph.Page(
                id: "site-1:page:/about", siteID: "site-1", route: "/about",
                filePath: "src/pages/about.astro", title: "About", lastModified: Date())],
            posts: [], images: []
        )
        let model = SiteNavigatorModel(graph: graph)
        model.start(site: CurrentSite(id: "site-1", packageURL: root, sourceDirectory: root), websiteTitle: "Test")
        while model.nodes.isEmpty { await Task.yield() }
        let id = try #require(model.nodes.first { $0.kind == .website }?.id)

        #expect(model.fileURL(for: id) == nil)
    }

    @Test("fileURL(for:) is nil for an unknown id")
    func fileURLNilForUnknownID() {
        let model = SiteNavigatorModel(graph: SiteContentGraph())
        #expect(model.fileURL(for: "nonexistent") == nil)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter SiteNavigatorModelTests`
Expected: build error — `value of type 'SiteNavigatorModel' has no member 'fileURL'`

- [ ] **Step 3: Add the `routeFileURLs` cache**

In `Sources/AnglesiteApp/SiteNavigatorModel.swift`, add a new stored property right after the existing `postsByID` declaration (currently line 46):

```swift
    private var postsByID: [String: SiteContentGraph.Post] = [:]
    private let contentTypeRegistry = ContentTypeRegistry()
    /// Synchronous id → source-file cache for `.route` (page/post) rows, rebuilt with `nodes` in
    /// `refresh()`. `.draggable(_:)`'s payload closure runs synchronously at drag-start and can't
    /// await the graph actor, so rename/delete's `graph.page(id:)`/`graph.post(id:)` pattern
    /// doesn't work here — this cache exists so `fileURL(for:)` can answer immediately (#676).
    private var routeFileURLs: [String: URL] = [:]
```

- [ ] **Step 4: Populate the cache in `refresh(siteID:siteRoot:)`**

In the same file, find `postsByID = Dictionary(uniqueKeysWithValues: posts.map { ($0.id, $0) })` inside `refresh(siteID:siteRoot:)` (currently line 268) and add the population right after it:

```swift
        postIDs = Set(posts.map(\.id))
        postsByID = Dictionary(uniqueKeysWithValues: posts.map { ($0.id, $0) })
        if let sourceDirectory {
            var fileURLs: [String: URL] = [:]
            for page in pages { fileURLs[page.id] = sourceDirectory.appendingPathComponent(page.filePath) }
            for post in posts { fileURLs[post.id] = sourceDirectory.appendingPathComponent(post.filePath) }
            routeFileURLs = fileURLs
        } else {
            routeFileURLs = [:]
        }
```

- [ ] **Step 5: Add the `fileURL(for:)` accessor**

In the same file, right after `func target(for id: String) -> NavigatorTarget? { nodesByID[id]?.target }` (currently line 96), add:

```swift
    /// The `Source/`-relative file URL backing a draggable row, or nil when the row has no single
    /// backing file (directories, website settings) or isn't a `.route` row. `NavigatorTarget` also
    /// has a `.file(FileRef)` case, but no `URLTreeNode.Kind` currently produces it — components and
    /// styles moved out of this tree in #714 slice 1 — so this only handles `.route` today; add a
    /// `.file` branch returning `ref.url` if `.file` rows come back.
    func fileURL(for id: String) -> URL? {
        guard case .route = target(for: id) else { return nil }
        return routeFileURLs[id]
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SiteNavigatorModelTests`
Expected: `Test run with 14 tests in 3 suites passed` (10 existing + 4 new)

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/SiteNavigatorModel.swift Tests/AnglesiteAppTests/SiteNavigatorModelTests.swift
git commit -m "feat(#676): add SiteNavigatorModel.fileURL(for:) route cache"
```

---

### Task 2: Wire navigator rows to drag out their source file

**Files:**
- Modify: `Sources/AnglesiteApp/SiteNavigatorView.swift:63-108` (`row(for:)`)

**Interfaces:**
- Consumes: `SiteNavigatorModel.fileURL(for id: String) -> URL?` (Task 1).
- Produces: nothing new consumed by later tasks — this is the last navigator-side change.

- [ ] **Step 1: Factor the non-editing row branch into `rowLabel(for:)` and add the drag source**

In `Sources/AnglesiteApp/SiteNavigatorView.swift`, replace the current `row(for:)` method:

```swift
    @ViewBuilder
    private func row(for node: URLTreeNode) -> some View {
        if model.editingItemID == node.id {
            TextField("Title", text: $model.draftTitle)
                .textFieldStyle(.plain)
                .focused($editingFocused)
                .onSubmit { Task { await model.commitEditing() } }
                .onExitCommand { model.cancelEditing() }   // Esc
                .onChange(of: editingFocused) { _, focused in
                    // TextField.onSubmit does not fire reliably inside a sidebar List on macOS — Return is
                    // consumed by the list and only surfaces as focus loss. So commit on focus loss
                    // (Return / Tab / click-away, Finder-style). Esc cancels first via onExitCommand,
                    // which clears editingItemID, so this guard then skips the commit.
                    if !focused && model.editingItemID == node.id {
                        Task { await model.commitEditing() }
                    }
                }
                .task { editingFocused = true }
                .tag(node.id)
        } else {
            Label { Text(node.title) } icon: { icon(for: node) }
                .tag(node.id)
                .lineLimit(1)
                .truncationMode(.middle)
                .contextMenu {
                    if model.canRename(node.id) {
                        Button("Rename") { model.beginEditing(node.id) }
                    }
                    if model.canDuplicate(node.id), let item = model.item(for: node.id) {
                        Button("Duplicate") { onDuplicateRequested(item) }
                    }
                    if model.canRepurpose(node.id), let item = model.item(for: node.id) {
                        Button("Repurpose Post…") { onRepurposeRequested(item) }
                    }
                    if model.canPublish(node.id), let item = model.item(for: node.id) {
                        Button("Publish") { onPublishRequested(item) }
                    }
                    if model.canUnpublish(node.id), let item = model.item(for: node.id) {
                        Button("Unpublish") { onUnpublishRequested(item) }
                    }
                    if model.canDelete(node.id), let item = model.item(for: node.id) {
                        Button("Delete", role: .destructive) { onDeleteRequested(item) }
                    }
                }
        }
    }
```

with:

```swift
    @ViewBuilder
    private func row(for node: URLTreeNode) -> some View {
        if model.editingItemID == node.id {
            TextField("Title", text: $model.draftTitle)
                .textFieldStyle(.plain)
                .focused($editingFocused)
                .onSubmit { Task { await model.commitEditing() } }
                .onExitCommand { model.cancelEditing() }   // Esc
                .onChange(of: editingFocused) { _, focused in
                    // TextField.onSubmit does not fire reliably inside a sidebar List on macOS — Return is
                    // consumed by the list and only surfaces as focus loss. So commit on focus loss
                    // (Return / Tab / click-away, Finder-style). Esc cancels first via onExitCommand,
                    // which clears editingItemID, so this guard then skips the commit.
                    if !focused && model.editingItemID == node.id {
                        Task { await model.commitEditing() }
                    }
                }
                .task { editingFocused = true }
                .tag(node.id)
        } else if let url = model.fileURL(for: node.id) {
            // Draggable out to Finder/another app (#676) — only rows backed by a single source
            // file (today: page/post `.route` rows) qualify; see `fileURL(for:)`.
            rowLabel(for: node).draggable(url)
        } else {
            rowLabel(for: node)
        }
    }

    private func rowLabel(for node: URLTreeNode) -> some View {
        Label { Text(node.title) } icon: { icon(for: node) }
            .tag(node.id)
            .lineLimit(1)
            .truncationMode(.middle)
            .contextMenu {
                if model.canRename(node.id) {
                    Button("Rename") { model.beginEditing(node.id) }
                }
                if model.canDuplicate(node.id), let item = model.item(for: node.id) {
                    Button("Duplicate") { onDuplicateRequested(item) }
                }
                if model.canRepurpose(node.id), let item = model.item(for: node.id) {
                    Button("Repurpose Post…") { onRepurposeRequested(item) }
                }
                if model.canPublish(node.id), let item = model.item(for: node.id) {
                    Button("Publish") { onPublishRequested(item) }
                }
                if model.canUnpublish(node.id), let item = model.item(for: node.id) {
                    Button("Unpublish") { onUnpublishRequested(item) }
                }
                if model.canDelete(node.id), let item = model.item(for: node.id) {
                    Button("Delete", role: .destructive) { onDeleteRequested(item) }
                }
            }
    }
```

- [ ] **Step 2: Build to verify it compiles**

Run: `swift test --package-path . --filter SiteNavigatorModelTests`
Expected: `Build complete!` followed by the same `Test run with 14 tests in 3 suites passed` as Task 1 (this target-wide build is how a `SiteNavigatorView.swift` compile error would surface — there's no SwiftUI view-inspection library in this repo to unit-test `.draggable` wiring directly, see the design doc's Testing section).

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/SiteNavigatorView.swift
git commit -m "feat(#676): drag navigator pages/posts out to Finder"
```

---

### Task 3: Make launcher site rows draggable

**Files:**
- Modify: `Sources/AnglesiteApp/SitesLauncherView.swift:138-161` (`siteList`, the `Button` label content)

**Interfaces:**
- Consumes: `SiteStore.Site.packageURL: URL` (already read at line 150 for display).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add `.draggable(site.packageURL)` to each row**

In `Sources/AnglesiteApp/SitesLauncherView.swift`, find this block inside `siteList` (currently lines 139-165):

```swift
            Button {
                open(site: site)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: site.isValid
                          ? "checkmark.circle.fill"
                          : "exclamationmark.triangle.fill")
                        .foregroundStyle(site.isValid ? Color.green : Color.orange)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(site.name).font(.body.monospaced())
                        Text(site.packageURL.path)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                }
                .contentShape(Rectangle())
                .padding(.vertical, 2)
            }
            .buttonStyle(.plain)
            // A dead bookmark (needsReauthorization) still lets the row respond to a click — it
            // routes to the same "Locate…" recovery as the context-menu action — rather than
            // going fully dead with no way to fix it in place (#776).
            .disabled(!site.isValid && !site.needsReauthorization)
```

and insert `.draggable(site.packageURL)` between `.buttonStyle(.plain)` and the `.disabled(...)` line (and its preceding comment):

```swift
            Button {
                open(site: site)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: site.isValid
                          ? "checkmark.circle.fill"
                          : "exclamationmark.triangle.fill")
                        .foregroundStyle(site.isValid ? Color.green : Color.orange)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(site.name).font(.body.monospaced())
                        Text(site.packageURL.path)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                }
                .contentShape(Rectangle())
                .padding(.vertical, 2)
            }
            .buttonStyle(.plain)
            // Draggable out to Finder/Terminal/another app (#676) — offers the package URL
            // regardless of validity (a dead bookmark is still a real path on disk).
            .draggable(site.packageURL)
            // A dead bookmark (needsReauthorization) still lets the row respond to a click — it
            // routes to the same "Locate…" recovery as the context-menu action — rather than
            // going fully dead with no way to fix it in place (#776).
            .disabled(!site.isValid && !site.needsReauthorization)
```

- [ ] **Step 2: Build to verify it compiles**

Run: `swift test --package-path . --filter SiteNavigatorModelTests`
Expected: `Build complete!` (this rebuilds all of `AnglesiteAppCore`, including `SitesLauncherView.swift`, as a dependency of the test target — a compile error here fails the build step even though this file has no dedicated test suite).

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/SitesLauncherView.swift
git commit -m "feat(#676): drag launcher site rows out to Finder"
```

---

### Task 4: Visible targeted highlight on the launcher drop target

**Files:**
- Modify: `Sources/AnglesiteApp/SitesLauncherView.swift:21` (new `@State`), `Sources/AnglesiteApp/SitesLauncherView.swift:189-209` (`siteList`'s `.listStyle`/`.dropDestination`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by later tasks — this is the final task.

- [ ] **Step 1: Add the targeted-state property**

In `Sources/AnglesiteApp/SitesLauncherView.swift`, add a new `@State` property right after `@State private var sites: [SiteStore.Site] = []` (currently line 21):

```swift
    @State private var sites: [SiteStore.Site] = []
    /// Drives a visible highlight while a file-URL drag hovers `siteList` (#676). Lights up for
    /// any file-URL drag, not only valid `.anglesite` packages — see the design doc's "Drop-
    /// highlight fidelity" decision. The drop itself still only accepts `.anglesite` packages,
    /// unchanged below.
    @State private var isDropTargeted = false
```

- [ ] **Step 2: Add the `isTargeted:` closure and a visible highlight overlay**

In the same file, find (currently lines 189-209):

```swift
        .listStyle(.inset)
        // Accept `.anglesite` packages dragged from Finder (#524) — same register path as
        // Finder double-click (`onOpenURL`), including the MAS bookmark mint (a user drag
        // conveys sandbox access to the dragged item).
        .dropDestination(for: URL.self) { urls, _ in
            let packages = urls.filter { $0.pathExtension == AnglesitePackage.packageExtension }
            guard !packages.isEmpty else { return false }
            Task { @MainActor in
                for url in packages {
                    do {
                        let site = try await SiteActions.registerPackage(at: url)
                        openWindow(value: site.id)
                    } catch {
                        NSAlert(error: SiteActions.ImportError(
                            folderName: url.lastPathComponent, underlying: error
                        )).runModal()
                    }
                }
            }
            return true
        }
```

and replace it with:

```swift
        .listStyle(.inset)
        // Accept `.anglesite` packages dragged from Finder (#524) — same register path as
        // Finder double-click (`onOpenURL`), including the MAS bookmark mint (a user drag
        // conveys sandbox access to the dragged item).
        .dropDestination(for: URL.self) { urls, _ in
            let packages = urls.filter { $0.pathExtension == AnglesitePackage.packageExtension }
            guard !packages.isEmpty else { return false }
            Task { @MainActor in
                for url in packages {
                    do {
                        let site = try await SiteActions.registerPackage(at: url)
                        openWindow(value: site.id)
                    } catch {
                        NSAlert(error: SiteActions.ImportError(
                            folderName: url.lastPathComponent, underlying: error
                        )).runModal()
                    }
                }
            }
            return true
        } isTargeted: { targeted in
            isDropTargeted = targeted
        }
        .overlay {
            // Explicit targeted feedback (#676) — the system's default drag highlight is subtle
            // enough that #524's drop target had no clearly visible accepted/rejected state.
            if isDropTargeted {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(Color.accentColor, lineWidth: 3)
                    .allowsHitTesting(false)
            }
        }
```

- [ ] **Step 3: Build to verify it compiles**

Run: `swift test --package-path . --filter SiteNavigatorModelTests`
Expected: `Build complete!` (same rationale as Task 3 — no dedicated test suite for this view; the highlight is decorative UI state with no independently testable logic).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/SitesLauncherView.swift
git commit -m "feat(#676): visible targeted highlight on launcher drop target"
```

---

### Task 5: Full verification pass + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Run the full SwiftPM test suite**

Run: `swift test --package-path .`
Expected: all suites pass, no failures (this also re-confirms the 4 new Task 1 tests alongside the full existing suite).

- [ ] **Step 2: Build the app target**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Manual QA (drag-and-drop has no headless test path on macOS)**

In the running app:
1. Open the Sites launcher, drag a site row to the Desktop → confirm Finder offers to copy/move the `.anglesite` package, and the file appears at the drop location.
2. Open a site window, drag a page or post row from the navigator to the Desktop → confirm the backing source file (e.g. `about.astro` or `hello.md`) copies to the drop location.
3. Drag a `.anglesite` package from Finder over the launcher list → confirm the accent-colored highlight appears while hovering, and dropping it registers/opens the site as before (#524 behavior unchanged).
4. Drag some other file (e.g. a `.txt` file) over the launcher list → confirm the same highlight appears (expected per the "simple hover highlight" decision — not a bug) but dropping it does nothing (no crash, no registration attempt).

- [ ] **Step 4: Update the issue**

Remove the in-progress label now that a PR is about to open:

```bash
gh issue edit 676 --remove-label "🛠️ In Progress"
```
