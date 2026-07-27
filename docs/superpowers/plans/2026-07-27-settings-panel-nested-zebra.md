# Settings Panel Tab Bar + Nested/Zebra-Striped Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the clipped/misaligned Settings tab bar in `PlistEditorView` (per-site Settings
panel) by replacing the equal-width segmented `Picker` with a natural-width tab strip
carrying SF Symbols, and restructure every tab's content into nested, Xcode-Signing-&-
Capabilities-style boxes with native zebra striping on genuinely list-shaped content.

**Architecture:** One new small reusable `SettingsBox` container view, one new computed
tab-strip view on `PlistEditorView`, and a per-tab restructuring of existing `Grid`/`HStack`
content into `SettingsBox`-wrapped sections — converting the two truly list-shaped sections
(Workers toggle rows, Crawlers Content Signals rows) from hand-rolled `HStack`s into native
`Table`s, which auto-zebra-stripe on macOS. No model, persistence, or catalog changes.

**Tech Stack:** Swift 6.4, SwiftUI (macOS 27+), SwiftPM (`AnglesiteApp` library target).

**Spec:** [`docs/superpowers/specs/2026-07-27-settings-panel-nested-zebra-design.md`](../specs/2026-07-27-settings-panel-nested-zebra-design.md)

## Global Constraints

- **Worktree:** All work happens in
  `/Users/dwk/Developer/github.com/Anglesite/Anglesite-app/.claude/worktrees/anglesite-newsletter-services-bb47fd`
  on branch `claude/settings-tabs-alignment-styling-e1a2a7`. Every dispatched subagent must
  `cd` there first, and must read `CONTRIBUTING.md` and `CLAUDE.md` in that worktree before
  making any change (per this repo's `CLAUDE.md` ▸ "Worktrees" / "Contribution workflow").
- **File under change:** `Sources/AnglesiteApp/PlistEditorView.swift` for every task except
  Task 2 (new file). Because every task edits this same file sequentially, tasks locate code
  by the unique surrounding snippet shown in each step (via the `Edit` tool's exact-match
  `old_string`), not by line number — line numbers drift after each task's edit and are not
  trustworthy across tasks.
- **No model/persistence/catalog changes.** Every `Task { await model.… }` call, every
  `Binding`, every validation/error banner keeps its exact existing behavior — only the
  surrounding `View` structure changes. Do not touch `PlistEditorModel.swift`,
  `WorkerCatalog.swift`, or any `AnglesiteCore` file.
- **No MCP or `davidwkeith/workers` catalog schema changes** — this whole plan is
  `Sources/AnglesiteApp` only. No paired PR.
- **Testing convention for this plan:** `Tests/AnglesiteAppTests` has seven
  `PlistEditorModel*Tests.swift` files but **zero** tests targeting `PlistEditorView` itself
  (confirmed by inspection before writing this plan) — this codebase's established
  convention is that pure-SwiftUI-layout code is verified by compilation + manual GUI
  check, not unit tests. Following that convention: each task's "test" step is a
  **compile check** (`swift build --package-path .`), not a new unit test. The final task
  (Task 11) runs the full `CONTRIBUTING.md` verification (`swift test --package-path .`,
  `xcodebuild … build`) plus a manual GUI pass through all 7 tabs.
- **SF Symbol tab icons** (used in Task 3, table repeated here for reference):

  | Tab | SF Symbol |
  |---|---|
  | Website | `globe` |
  | Analytics | `chart.bar.xaxis` |
  | Redirects | `arrow.triangle.turn.up.right.diamond.fill` |
  | Crawlers | `text.magnifyingglass` |
  | Email Security | `envelope.badge.shield.half.filled` |
  | Security Reports | `doc.text.magnifyingglass` |
  | Workers | `bolt.fill` |

- **`SettingsBox` shape** (built in Task 2, used by every later task):

  ```swift
  struct SettingsBox<Content: View>: View {
      let title: String
      @ViewBuilder let content: () -> Content

      var body: some View {
          VStack(alignment: .leading, spacing: 8) {
              Text(title).font(.headline)
              content()
          }
          .padding(10)
          .background(Color.secondary.opacity(0.06))
          .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
          .overlay {
              RoundedRectangle(cornerRadius: 8, style: .continuous)
                  .stroke(Color.secondary.opacity(0.15))
          }
      }
  }
  ```

  Group headers inside boxes are bold text only, no icon (matches Xcode's own
  capability-box headers, e.g. "App Sandbox").

---

### Task 1: Claim a tracking issue

Per `CONTRIBUTING.md` ▸ "Discuss big changes first" and `CLAUDE.md` ▸ "Issue-in-flight
signaling" — this touches all 7 Settings tabs, so it needs a tracked issue before code
changes land.

**Files:** none (GitHub only)

- [ ] **Step 1: Check nothing already claims this work**

  ```bash
  gh issue list --repo Anglesite/Anglesite-app --label "🛠️ In Progress" --search "settings tabs"
  ```

  Expected: no result referring to the Settings tab bar / nested-zebra redesign. If one
  exists, stop and use that issue number instead of creating a new one.

- [ ] **Step 2: Create the issue**

  ```bash
  gh issue create --repo Anglesite/Anglesite-app \
    --title "Site Settings panel: fix tab bar alignment, add SF Symbols, nested/zebra-striped content" \
    --label "🎯 UI" \
    --body "Fixes the clipped/misaligned Settings tab bar (segmented \`Picker\` gives every tab equal width regardless of label length) and restructures each tab's content into nested, Xcode-Signing-&-Capabilities-style boxes with native zebra striping on list-shaped content (Workers toggles, Crawlers Content Signals). Design: docs/superpowers/specs/2026-07-27-settings-panel-nested-zebra-design.md"
  ```

  Note the printed issue number (referred to as `<ISSUE>` below).

- [ ] **Step 3: Claim it**

  ```bash
  gh issue edit <ISSUE> --repo Anglesite/Anglesite-app --add-label "🛠️ In Progress"
  ```

- [ ] **Step 4: Reference it in the design doc's frontmatter**

  Edit `docs/superpowers/specs/2026-07-27-settings-panel-nested-zebra-design.md`, change:

  ```markdown
  **Repo:** `Anglesite/Anglesite-app` (app-only; no MCP or worker-catalog schema changes)
  ```

  to:

  ```markdown
  **Repo:** `Anglesite/Anglesite-app` (app-only; no MCP or worker-catalog schema changes)
  **Issue:** #<ISSUE>
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add docs/superpowers/specs/2026-07-27-settings-panel-nested-zebra-design.md
  git commit -m "docs: link Settings panel redesign spec to issue #<ISSUE>"
  ```

---

### Task 2: Create `SettingsBox`

**Files:**
- Create: `Sources/AnglesiteApp/SettingsBox.swift`

**Interfaces:**
- Produces: `struct SettingsBox<Content: View>: View { init(title: String, @ViewBuilder content: @escaping () -> Content) }` — used by every subsequent task as `SettingsBox(title: "…") { … }`.

- [ ] **Step 1: Write the file**

  ```swift
  import SwiftUI

  /// A nested, bordered settings section — mirrors Xcode's Signing & Capabilities
  /// boxes (e.g. "Signing (Debug)", "App Sandbox"): bold header, no icon, subtle fill.
  struct SettingsBox<Content: View>: View {
      let title: String
      @ViewBuilder let content: () -> Content

      var body: some View {
          VStack(alignment: .leading, spacing: 8) {
              Text(title).font(.headline)
              content()
          }
          .padding(10)
          .background(Color.secondary.opacity(0.06))
          .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
          .overlay {
              RoundedRectangle(cornerRadius: 8, style: .continuous)
                  .stroke(Color.secondary.opacity(0.15))
          }
      }
  }

  #Preview {
      SettingsBox(title: "Preview Box") {
          Text("Box content")
      }
      .padding()
  }
  ```

- [ ] **Step 2: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add Sources/AnglesiteApp/SettingsBox.swift
  git commit -m "feat(app): add SettingsBox nested-section container view"
  ```

---

### Task 3: Tab bar — SF Symbols + natural-width tab strip

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (the `SettingsTab` enum and the tab
  bar rendering inside `content`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SettingsTab.symbolName: String`, `PlistEditorView.tabBar: some View` — no
  other task depends on these directly, but Task 3 must land before Tasks 4-10 change
  `content`'s surrounding structure only incidentally (they don't touch the tab bar).

- [ ] **Step 1: Add `symbolName` to `SettingsTab`**

  Find:

  ```swift
      private enum SettingsTab: String, CaseIterable, Identifiable {
          case website = "Website"
          case analytics = "Analytics"
          case redirects = "Redirects"
          case crawlers = "Crawlers"
          case emailSecurity = "Email Security"
          case securityReports = "Security Reports"
          case workers = "Workers"
          var id: Self { self }
      }
  ```

  Replace with:

  ```swift
      private enum SettingsTab: String, CaseIterable, Identifiable {
          case website = "Website"
          case analytics = "Analytics"
          case redirects = "Redirects"
          case crawlers = "Crawlers"
          case emailSecurity = "Email Security"
          case securityReports = "Security Reports"
          case workers = "Workers"
          var id: Self { self }

          var symbolName: String {
              switch self {
              case .website: return "globe"
              case .analytics: return "chart.bar.xaxis"
              case .redirects: return "arrow.triangle.turn.up.right.diamond.fill"
              case .crawlers: return "text.magnifyingglass"
              case .emailSecurity: return "envelope.badge.shield.half.filled"
              case .securityReports: return "doc.text.magnifyingglass"
              case .workers: return "bolt.fill"
              }
          }
      }
  ```

- [ ] **Step 2: Replace the segmented `Picker` with a natural-width tab strip**

  Find (inside `content`, right after `ScrollView { VStack(alignment: .leading, spacing: 10) {`):

  ```swift
                      Picker("Settings", selection: $selectedTab) {
                          ForEach(SettingsTab.allCases) { tab in
                              Text(tab.rawValue).tag(tab)
                          }
                      }
                      .pickerStyle(.segmented)
                      .labelsHidden()
                      .frame(maxWidth: 520)
  ```

  Replace with:

  ```swift
                      tabBar
  ```

- [ ] **Step 3: Add the `tabBar` computed property**

  Find (the end of `header` immediately followed by the start of `content`):

  ```swift
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
  ```

  Replace with (inserting the new `tabBar` property between them):

  ```swift
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(SettingsTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Label(tab.rawValue, systemImage: tab.symbolName)
                        .font(.callout)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(tab == selectedTab ? Color.accentColor.opacity(0.15) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .foregroundStyle(tab == selectedTab ? Color.accentColor : Color.primary)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == selectedTab ? [.isSelected] : [])
            }
        }
    }

    @ViewBuilder
    private var content: some View {
  ```

- [ ] **Step 4: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "fix(app): replace equal-width segmented Settings tabs with natural-width tab strip"
  ```

---

### Task 4: Website tab → `SettingsBox`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`websiteTab`)

- [ ] **Step 1: Wrap the Grid in a `SettingsBox`**

  Find:

  ```swift
      private var websiteTab: some View {
          VStack(alignment: .leading, spacing: 10) {
              Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                  GridRow {
                      Text("Title")
                          .frame(minWidth: 160, alignment: .leading)
                      TextField("Title", text: $model.websiteTitle)
                          .focused($titleFocused)
                          .onSubmit { Task { await saveWebsiteTitle() } }
                          .frame(minWidth: 220)
                  }
                  GridRow {
                      Text("Icons")
                          .frame(minWidth: 160, alignment: .leading)
                      HStack(spacing: 8) {
                          Image(systemName: model.hasWebsiteIcons ? "checkmark.circle.fill" : "globe")
                              .foregroundStyle(model.hasWebsiteIcons ? .green : .secondary)
                              .frame(width: 18)
                          Text(model.hasWebsiteIcons ? "Installed" : "Not Set")
                              .foregroundStyle(.secondary)
                              .frame(minWidth: 72, alignment: .leading)
                          Button {
                              chooseWebsiteIcon()
                          } label: {
                              Label(model.hasWebsiteIcons ? "Change Image" : "Choose Image",
                                    systemImage: "photo.badge.plus")
                          }
                          .disabled(model.isInstallingIcons)
                          if model.isInstallingIcons {
                              ProgressView()
                                  .controlSize(.small)
                          }
                      }
                  }
              }
              .textFieldStyle(.roundedBorder)
              if let iconError = model.iconError {
                  Label(iconError, systemImage: "exclamationmark.triangle.fill")
                      .foregroundStyle(.orange)
                      .font(.callout)
              }
          }
      }
  ```

  Replace with:

  ```swift
      private var websiteTab: some View {
          VStack(alignment: .leading, spacing: 10) {
              SettingsBox(title: "Website") {
                  Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                      GridRow {
                          Text("Title")
                              .frame(minWidth: 160, alignment: .leading)
                          TextField("Title", text: $model.websiteTitle)
                              .focused($titleFocused)
                              .onSubmit { Task { await saveWebsiteTitle() } }
                              .frame(minWidth: 220)
                      }
                      GridRow {
                          Text("Icons")
                              .frame(minWidth: 160, alignment: .leading)
                          HStack(spacing: 8) {
                              Image(systemName: model.hasWebsiteIcons ? "checkmark.circle.fill" : "globe")
                                  .foregroundStyle(model.hasWebsiteIcons ? .green : .secondary)
                                  .frame(width: 18)
                              Text(model.hasWebsiteIcons ? "Installed" : "Not Set")
                                  .foregroundStyle(.secondary)
                                  .frame(minWidth: 72, alignment: .leading)
                              Button {
                                  chooseWebsiteIcon()
                              } label: {
                                  Label(model.hasWebsiteIcons ? "Change Image" : "Choose Image",
                                        systemImage: "photo.badge.plus")
                              }
                              .disabled(model.isInstallingIcons)
                              if model.isInstallingIcons {
                                  ProgressView()
                                      .controlSize(.small)
                              }
                          }
                      }
                  }
                  .textFieldStyle(.roundedBorder)
              }
              if let iconError = model.iconError {
                  Label(iconError, systemImage: "exclamationmark.triangle.fill")
                      .foregroundStyle(.orange)
                      .font(.callout)
              }
          }
      }
  ```

- [ ] **Step 2: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Website tab fields in a SettingsBox"
  ```

---

### Task 5: Analytics tab → `SettingsBox`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`analyticsTab`)

- [ ] **Step 1: Wrap the Grid in a `SettingsBox`**

  Find:

  ```swift
      private var analyticsTab: some View {
          VStack(alignment: .leading, spacing: 10) {
              Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                  GridRow {
                      Text("Cloudflare")
                          .frame(minWidth: 160, alignment: .leading)
                      HStack(spacing: 8) {
                          Toggle("Cloudflare", isOn: cloudflareAnalyticsBinding)
                              .toggleStyle(.switch)
                              .labelsHidden()
                              .disabled(model.isConfiguringCloudflareAnalytics)
                          Text(model.cloudflareAnalyticsEnabled ? "On" : "Off")
                              .foregroundStyle(.secondary)
                              .frame(minWidth: 28, alignment: .leading)
                          if model.isConfiguringCloudflareAnalytics {
                              ProgressView()
                                  .controlSize(.small)
                          }
                          Link(destination: WebsiteAnalyticsAsset.dashboardURL) {
                              Label("Open Dashboard", systemImage: "arrow.up.right.square")
                          }
                      }
                  }
                  GridRow(alignment: .top) {
                      HStack(spacing: 6) {
                          Text("Custom")
                          Button {
                              showingCustomAnalyticsHelp = true
                          } label: {
                              Image(systemName: "questionmark.circle")
                          }
                          .buttonStyle(.plain)
                          .help("About custom analytics")
                      }
                      .frame(minWidth: 160, alignment: .leading)
                      .padding(.top, 4)
                      HTMLSnippetEditor(text: $model.analyticsSettings.customHeadTag) {
                          Task { await model.saveAnalytics() }
                      }
                          .frame(minWidth: 360, minHeight: 90)
                          .overlay {
                              RoundedRectangle(cornerRadius: 6)
                                  .stroke(customAnalyticsMessage == nil ? Color.secondary.opacity(0.25) : Color.orange)
                          }
                  }
              }
              .textFieldStyle(.roundedBorder)
              HStack(spacing: 8) {
                  if model.isSavingAnalytics {
                      ProgressView()
                          .controlSize(.small)
                  }
                  if let customAnalyticsMessage {
                      Label(customAnalyticsMessage, systemImage: "exclamationmark.triangle.fill")
                          .foregroundStyle(.orange)
                          .font(.callout)
                  }
              }
          }
          .popover(isPresented: $showingCustomAnalyticsHelp, arrowEdge: .trailing) {
              VStack(alignment: .leading, spacing: 8) {
                  Text("Custom Analytics")
                      .font(.headline)
                  Text("Paste the HTML code from another analytics provider here, such as Google Analytics, Plausible, Fathom, or a conversion tag.")
                      .font(.callout)
                      .foregroundStyle(.secondary)
                      .frame(width: 280, alignment: .leading)
              }
              .padding()
          }
      }
  ```

  Replace with:

  ```swift
      private var analyticsTab: some View {
          VStack(alignment: .leading, spacing: 10) {
              SettingsBox(title: "Analytics") {
                  Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                      GridRow {
                          Text("Cloudflare")
                              .frame(minWidth: 160, alignment: .leading)
                          HStack(spacing: 8) {
                              Toggle("Cloudflare", isOn: cloudflareAnalyticsBinding)
                                  .toggleStyle(.switch)
                                  .labelsHidden()
                                  .disabled(model.isConfiguringCloudflareAnalytics)
                              Text(model.cloudflareAnalyticsEnabled ? "On" : "Off")
                                  .foregroundStyle(.secondary)
                                  .frame(minWidth: 28, alignment: .leading)
                              if model.isConfiguringCloudflareAnalytics {
                                  ProgressView()
                                      .controlSize(.small)
                              }
                              Link(destination: WebsiteAnalyticsAsset.dashboardURL) {
                                  Label("Open Dashboard", systemImage: "arrow.up.right.square")
                              }
                          }
                      }
                      GridRow(alignment: .top) {
                          HStack(spacing: 6) {
                              Text("Custom")
                              Button {
                                  showingCustomAnalyticsHelp = true
                              } label: {
                                  Image(systemName: "questionmark.circle")
                              }
                              .buttonStyle(.plain)
                              .help("About custom analytics")
                          }
                          .frame(minWidth: 160, alignment: .leading)
                          .padding(.top, 4)
                          HTMLSnippetEditor(text: $model.analyticsSettings.customHeadTag) {
                              Task { await model.saveAnalytics() }
                          }
                              .frame(minWidth: 360, minHeight: 90)
                              .overlay {
                                  RoundedRectangle(cornerRadius: 6)
                                      .stroke(customAnalyticsMessage == nil ? Color.secondary.opacity(0.25) : Color.orange)
                              }
                      }
                  }
                  .textFieldStyle(.roundedBorder)
              }
              HStack(spacing: 8) {
                  if model.isSavingAnalytics {
                      ProgressView()
                          .controlSize(.small)
                  }
                  if let customAnalyticsMessage {
                      Label(customAnalyticsMessage, systemImage: "exclamationmark.triangle.fill")
                          .foregroundStyle(.orange)
                          .font(.callout)
                  }
              }
          }
          .popover(isPresented: $showingCustomAnalyticsHelp, arrowEdge: .trailing) {
              VStack(alignment: .leading, spacing: 8) {
                  Text("Custom Analytics")
                      .font(.headline)
                  Text("Paste the HTML code from another analytics provider here, such as Google Analytics, Plausible, Fathom, or a conversion tag.")
                      .font(.callout)
                      .foregroundStyle(.secondary)
                      .frame(width: 280, alignment: .leading)
              }
              .padding()
          }
      }
  ```

- [ ] **Step 2: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Analytics tab fields in a SettingsBox"
  ```

---

### Task 6: Redirects tab → `SettingsBox`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`redirectsTab`)

- [ ] **Step 1: Wrap the existing content in a `SettingsBox`**

  Find:

  ```swift
      private var redirectsTab: some View {
          VStack(alignment: .leading, spacing: 10) {
              if model.redirectEntries.isEmpty {
                  Text("No redirects yet. Add one below.")
                      .foregroundStyle(.secondary)
              } else {
                  Table(redirectRows) {
                      TableColumn("Source") { row in
                          TextField("/old-path", text: sourceBinding(at: row.id))
                      }
                      TableColumn("Destination") { row in
                          TextField("/new-path", text: destinationBinding(at: row.id))
                      }
                      TableColumn("Type") { row in
                          Picker("Type", selection: codeBinding(at: row.id)) {
                              Text("301").tag(RedirectsStore.RedirectEntry.Code.permanent)
                              Text("302").tag(RedirectsStore.RedirectEntry.Code.temporary)
                          }
                          .labelsHidden()
                      }
                      TableColumn("") { row in
                          Button(role: .destructive) {
                              model.redirectEntries.remove(at: row.id)
                          } label: {
                              Image(systemName: "trash")
                          }
                          .buttonStyle(.plain)
                      }
                  }
                  .frame(minHeight: 120)
              }
              HStack(spacing: 8) {
                  Button {
                      model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "", destination: "", code: .permanent))
                  } label: {
                      Label("Add Redirect", systemImage: "plus")
                  }
                  if model.isSavingRedirects {
                      ProgressView().controlSize(.small)
                  }
              }
          }
      }
  ```

  Replace with:

  ```swift
      private var redirectsTab: some View {
          SettingsBox(title: "Redirects") {
              VStack(alignment: .leading, spacing: 10) {
                  if model.redirectEntries.isEmpty {
                      Text("No redirects yet. Add one below.")
                          .foregroundStyle(.secondary)
                  } else {
                      Table(redirectRows) {
                          TableColumn("Source") { row in
                              TextField("/old-path", text: sourceBinding(at: row.id))
                          }
                          TableColumn("Destination") { row in
                              TextField("/new-path", text: destinationBinding(at: row.id))
                          }
                          TableColumn("Type") { row in
                              Picker("Type", selection: codeBinding(at: row.id)) {
                                  Text("301").tag(RedirectsStore.RedirectEntry.Code.permanent)
                                  Text("302").tag(RedirectsStore.RedirectEntry.Code.temporary)
                              }
                              .labelsHidden()
                          }
                          TableColumn("") { row in
                              Button(role: .destructive) {
                                  model.redirectEntries.remove(at: row.id)
                              } label: {
                                  Image(systemName: "trash")
                              }
                              .buttonStyle(.plain)
                          }
                      }
                      .frame(minHeight: 120)
                  }
                  HStack(spacing: 8) {
                      Button {
                          model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "", destination: "", code: .permanent))
                      } label: {
                          Label("Add Redirect", systemImage: "plus")
                      }
                      if model.isSavingRedirects {
                          ProgressView().controlSize(.small)
                      }
                  }
              }
          }
      }
  ```

- [ ] **Step 2: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Redirects tab in a SettingsBox"
  ```

---

### Task 7: Crawlers tab → two `SettingsBox`es + Content Signals `Table`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`crawlersTab`, `contentSignalRow`)

**Interfaces:**
- Produces: `private struct ContentSignalRow: Identifiable` and
  `private var contentSignalRows: [ContentSignalRow]` — used only inside `crawlersTab`.

- [ ] **Step 1: Replace `crawlersTab` and delete the now-unused `contentSignalRow` function**

  Find:

  ```swift
      private var crawlersTab: some View {
          VStack(alignment: .leading, spacing: 14) {
              VStack(alignment: .leading, spacing: 6) {
                  Toggle("Block AI Training Crawlers", isOn: $model.crawlerPolicySettings.blockAI)
                      .toggleStyle(.switch)
                  Text("Adds robots.txt rules refusing known AI-training crawlers (GPTBot, ClaudeBot, and others). This reduces your site's visibility to AI assistants and AI-generated search summaries — it does not affect traditional search engines.")
                      .font(.callout)
                      .foregroundStyle(.secondary)
              }

              Divider()

              VStack(alignment: .leading, spacing: 10) {
                  Text("Content Signals")
                      .font(.headline)
                  Text("Cloudflare's Content Signals Policy states a usage preference per purpose in robots.txt. It's a signal that well-behaved crawlers honor, not an enforced block.")
                      .font(.callout)
                      .foregroundStyle(.secondary)

                  contentSignalRow(
                      title: "Search",
                      help: "Show this content in traditional search results.",
                      value: $model.crawlerPolicySettings.search
                  )
                  contentSignalRow(
                      title: "AI Answers",
                      help: "Let AI assistants use this content to answer a live question (e.g. retrieval-augmented generation).",
                      value: $model.crawlerPolicySettings.aiInput
                  )
                  contentSignalRow(
                      title: "AI Training",
                      help: "Let AI systems use this content to train models.",
                      value: $model.crawlerPolicySettings.aiTrain
                  )
              }

              if model.isSavingCrawlerPolicy {
                  ProgressView().controlSize(.small)
              }
          }
      }
  ```

  Replace with:

  ```swift
      private struct ContentSignalRow: Identifiable {
          let id: String
          let title: String
          let help: String
          let value: Binding<CrawlerPolicyAsset.ContentSignalValue>
      }

      private var contentSignalRows: [ContentSignalRow] {
          [
              ContentSignalRow(
                  id: "search",
                  title: "Search",
                  help: "Show this content in traditional search results.",
                  value: $model.crawlerPolicySettings.search
              ),
              ContentSignalRow(
                  id: "aiInput",
                  title: "AI Answers",
                  help: "Let AI assistants use this content to answer a live question (e.g. retrieval-augmented generation).",
                  value: $model.crawlerPolicySettings.aiInput
              ),
              ContentSignalRow(
                  id: "aiTrain",
                  title: "AI Training",
                  help: "Let AI systems use this content to train models.",
                  value: $model.crawlerPolicySettings.aiTrain
              ),
          ]
      }

      private var crawlersTab: some View {
          VStack(alignment: .leading, spacing: 14) {
              SettingsBox(title: "AI Training") {
                  VStack(alignment: .leading, spacing: 6) {
                      Toggle("Block AI Training Crawlers", isOn: $model.crawlerPolicySettings.blockAI)
                          .toggleStyle(.switch)
                      Text("Adds robots.txt rules refusing known AI-training crawlers (GPTBot, ClaudeBot, and others). This reduces your site's visibility to AI assistants and AI-generated search summaries — it does not affect traditional search engines.")
                          .font(.callout)
                          .foregroundStyle(.secondary)
                  }
              }

              SettingsBox(title: "Content Signals") {
                  VStack(alignment: .leading, spacing: 10) {
                      Text("Cloudflare's Content Signals Policy states a usage preference per purpose in robots.txt. It's a signal that well-behaved crawlers honor, not an enforced block.")
                          .font(.callout)
                          .foregroundStyle(.secondary)

                      Table(contentSignalRows) {
                          TableColumn("Purpose") { row in
                              Text(row.title)
                          }
                          TableColumn("Setting") { row in
                              Picker(row.title, selection: row.value) {
                                  Text("Unspecified").tag(CrawlerPolicyAsset.ContentSignalValue.unset)
                                  Text("Allow").tag(CrawlerPolicyAsset.ContentSignalValue.yes)
                                  Text("Disallow").tag(CrawlerPolicyAsset.ContentSignalValue.no)
                              }
                              .labelsHidden()
                              .pickerStyle(.segmented)
                          }
                          TableColumn("Description") { row in
                              Text(row.help)
                                  .font(.caption)
                                  .foregroundStyle(.secondary)
                          }
                      }
                      .frame(minHeight: 130)
                  }
              }

              if model.isSavingCrawlerPolicy {
                  ProgressView().controlSize(.small)
              }
          }
      }
  ```

- [ ] **Step 2: Delete the now-unused `contentSignalRow` function**

  Find and delete entirely:

  ```swift
      private func contentSignalRow(
          title: String,
          help: String,
          value: Binding<CrawlerPolicyAsset.ContentSignalValue>
      ) -> some View {
          VStack(alignment: .leading, spacing: 2) {
              HStack {
                  Text(title)
                      .frame(minWidth: 160, alignment: .leading)
                  Picker(title, selection: value) {
                      Text("Unspecified").tag(CrawlerPolicyAsset.ContentSignalValue.unset)
                      Text("Allow").tag(CrawlerPolicyAsset.ContentSignalValue.yes)
                      Text("Disallow").tag(CrawlerPolicyAsset.ContentSignalValue.no)
                  }
                  .labelsHidden()
                  .pickerStyle(.segmented)
                  .frame(maxWidth: 260)
              }
              Text(help)
                  .font(.caption)
                  .foregroundStyle(.secondary)
          }
      }

  ```

- [ ] **Step 3: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Crawlers tab in SettingsBoxes, table-ize Content Signals"
  ```

---

### Task 8: Email Security tab → two `SettingsBox`es

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`emailSecurityTab`)

- [ ] **Step 1: Replace `emailSecurityTab`**

  Find:

  ```swift
      private var emailSecurityTab: some View {
          VStack(alignment: .leading, spacing: 14) {
              VStack(alignment: .leading, spacing: 6) {
                  Text("MTA-STS")
                      .font(.headline)
                  Text("Require TLS for mail delivered to this domain. Start in testing mode and only switch to enforce after your mail provider is working cleanly.")
                      .font(.callout)
                      .foregroundStyle(.secondary)
              }

              Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                  GridRow {
                      Text("Mode").frame(minWidth: 160, alignment: .leading)
                      Picker("Mode", selection: $model.mtaStsSettings.mode) {
                          Text("Off").tag(MTAStsPolicyAsset.Mode.disabled)
                          Text("Testing").tag(MTAStsPolicyAsset.Mode.testing)
                          Text("Enforce").tag(MTAStsPolicyAsset.Mode.enforce)
                      }
                      .labelsHidden()
                      .frame(width: 160, alignment: .leading)
                  }
                  GridRow {
                      Text("Mail domain").frame(minWidth: 160, alignment: .leading)
                      TextField("example.com", text: $model.mtaStsSettings.domain)
                          .frame(minWidth: 260)
                  }
                  GridRow(alignment: .top) {
                      Text("Allowed MX hosts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                      VStack(alignment: .leading, spacing: 6) {
                          TextEditor(text: $model.mtaStsSettings.mxHosts)
                              .font(.body.monospaced())
                              .frame(minWidth: 260, minHeight: 72)
                              .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                              .accessibilityLabel("Allowed MX hosts")
                          Button("Use MX Records from DNS") { Task { await model.detectMtaStsMXHosts() } }
                              .disabled(MTAStsPolicyAsset.normalizedDomain(model.mtaStsSettings.domain).isEmpty || model.isPublishingMtaStsDNS)
                      }
                  }
                  GridRow {
                      Text("TLS report mailbox").frame(minWidth: 160, alignment: .leading)
                      TextField("Optional: tls-reports@example.com", text: $model.mtaStsSettings.reportMailbox)
                          .frame(minWidth: 260)
                  }
              }
              .textFieldStyle(.roundedBorder)

              if model.mtaStsSettings.mode != .disabled {
                  VStack(alignment: .leading, spacing: 6) {
                      Label("Required DNS records", systemImage: "dns")
                          .font(.headline)
                      Text("Point mta-sts.\(displayDomain) at this deployed site and ensure it has a valid HTTPS certificate. Add these TXT records automatically, or copy them into Website → Manage Domain. The MTA-STS ID changes automatically when this policy changes.")
                          .font(.callout)
                          .foregroundStyle(.secondary)
                      if mtaStsDNSRecords.isEmpty {
                          Text("Enter a valid mail domain and at least one MX host to prepare the DNS records.")
                              .font(.callout)
                              .foregroundStyle(.orange)
                      } else {
                          ForEach(mtaStsDNSRecords, id: \.name) { record in
                              HStack(alignment: .firstTextBaseline, spacing: 8) {
                                  Text("TXT \(record.name)").font(.callout.monospaced().weight(.medium))
                                  Text(record.content).font(.callout.monospaced()).textSelection(.enabled)
                              }
                          }
                          Button("Publish DNS Records") { Task { await model.publishMtaStsDNSRecords() } }
                              .buttonStyle(.borderedProminent)
                              .disabled(model.isPublishingMtaStsDNS)
                      }
                  }
                  .padding(10)
                  .background(Color.secondary.opacity(0.06))
                  .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
              }

              if model.isSavingMtaSts || model.isPublishingMtaStsDNS {
                  ProgressView().controlSize(.small)
              }
          }
      }
  ```

  Replace with:

  ```swift
      private var emailSecurityTab: some View {
          VStack(alignment: .leading, spacing: 14) {
              SettingsBox(title: "MTA-STS") {
                  VStack(alignment: .leading, spacing: 10) {
                      Text("Require TLS for mail delivered to this domain. Start in testing mode and only switch to enforce after your mail provider is working cleanly.")
                          .font(.callout)
                          .foregroundStyle(.secondary)

                      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                          GridRow {
                              Text("Mode").frame(minWidth: 160, alignment: .leading)
                              Picker("Mode", selection: $model.mtaStsSettings.mode) {
                                  Text("Off").tag(MTAStsPolicyAsset.Mode.disabled)
                                  Text("Testing").tag(MTAStsPolicyAsset.Mode.testing)
                                  Text("Enforce").tag(MTAStsPolicyAsset.Mode.enforce)
                              }
                              .labelsHidden()
                              .frame(width: 160, alignment: .leading)
                          }
                          GridRow {
                              Text("Mail domain").frame(minWidth: 160, alignment: .leading)
                              TextField("example.com", text: $model.mtaStsSettings.domain)
                                  .frame(minWidth: 260)
                          }
                          GridRow(alignment: .top) {
                              Text("Allowed MX hosts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                              VStack(alignment: .leading, spacing: 6) {
                                  TextEditor(text: $model.mtaStsSettings.mxHosts)
                                      .font(.body.monospaced())
                                      .frame(minWidth: 260, minHeight: 72)
                                      .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                                      .accessibilityLabel("Allowed MX hosts")
                                  Button("Use MX Records from DNS") { Task { await model.detectMtaStsMXHosts() } }
                                      .disabled(MTAStsPolicyAsset.normalizedDomain(model.mtaStsSettings.domain).isEmpty || model.isPublishingMtaStsDNS)
                              }
                          }
                          GridRow {
                              Text("TLS report mailbox").frame(minWidth: 160, alignment: .leading)
                              TextField("Optional: tls-reports@example.com", text: $model.mtaStsSettings.reportMailbox)
                                  .frame(minWidth: 260)
                          }
                      }
                      .textFieldStyle(.roundedBorder)
                  }
              }

              if model.mtaStsSettings.mode != .disabled {
                  SettingsBox(title: "Required DNS Records") {
                      VStack(alignment: .leading, spacing: 6) {
                          Text("Point mta-sts.\(displayDomain) at this deployed site and ensure it has a valid HTTPS certificate. Add these TXT records automatically, or copy them into Website → Manage Domain. The MTA-STS ID changes automatically when this policy changes.")
                              .font(.callout)
                              .foregroundStyle(.secondary)
                          if mtaStsDNSRecords.isEmpty {
                              Text("Enter a valid mail domain and at least one MX host to prepare the DNS records.")
                                  .font(.callout)
                                  .foregroundStyle(.orange)
                          } else {
                              ForEach(mtaStsDNSRecords, id: \.name) { record in
                                  HStack(alignment: .firstTextBaseline, spacing: 8) {
                                      Text("TXT \(record.name)").font(.callout.monospaced().weight(.medium))
                                      Text(record.content).font(.callout.monospaced()).textSelection(.enabled)
                                  }
                              }
                              Button("Publish DNS Records") { Task { await model.publishMtaStsDNSRecords() } }
                                  .buttonStyle(.borderedProminent)
                                  .disabled(model.isPublishingMtaStsDNS)
                          }
                      }
                  }
              }

              if model.isSavingMtaSts || model.isPublishingMtaStsDNS {
                  ProgressView().controlSize(.small)
              }
          }
      }
  ```

- [ ] **Step 2: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Email Security tab in SettingsBoxes"
  ```

---

### Task 9: Security Reports tab → two `SettingsBox`es

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`securityReportsTab`, `securityReportsGitHubCallout`)

- [ ] **Step 1: Replace `securityReportsTab`**

  Find:

  ```swift
      private var securityReportsTab: some View {
          VStack(alignment: .leading, spacing: 16) {
              VStack(alignment: .leading, spacing: 6) {
                  Text("Vulnerability reports")
                      .font(.headline)
                  Text("Publish where security researchers should report problems with this site. Anglesite writes an RFC 9116 security.txt from these settings; the first contact is the one researchers should try first.")
                      .font(.callout)
                      .foregroundStyle(.secondary)
              }

              Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                  GridRow {
                      Text("Publishing").frame(minWidth: 160, alignment: .leading)
                      Picker("Publishing", selection: $model.securityReportingSettings.mode) {
                          Text("Generated by Anglesite").tag(SecurityReportingAsset.Mode.generated)
                          Text("Hand-authored").tag(SecurityReportingAsset.Mode.manual)
                          Text("Off").tag(SecurityReportingAsset.Mode.disabled)
                      }
                      .labelsHidden()
                      .frame(width: 220, alignment: .leading)
                  }
                  GridRow(alignment: .top) {
                      Text("Contacts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                      VStack(alignment: .leading, spacing: 6) {
                          TextEditor(text: $model.securityReportingSettings.contacts)
                              .font(.body.monospaced())
                              .frame(minWidth: 260, minHeight: 72)
                              .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                              .accessibilityLabel("Security contacts")
                          Text("One per line, most preferred first. An email address, or an https:// page where reports are accepted.")
                              .font(.caption)
                              .foregroundStyle(.secondary)
                      }
                  }
              }

              securityReportsGitHubCallout

              if let securityReportingError = model.securityReportingError {
                  Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                      .foregroundStyle(.orange)
                      .font(.callout)
              }

              if model.isSavingSecurityReporting || model.isCheckingRepoSecurity {
                  ProgressView().controlSize(.small)
              }
          }
          .task { await model.refreshRepoSecurityState() }
      }
  ```

  Replace with:

  ```swift
      private var securityReportsTab: some View {
          VStack(alignment: .leading, spacing: 16) {
              SettingsBox(title: "Vulnerability Reports") {
                  VStack(alignment: .leading, spacing: 10) {
                      Text("Publish where security researchers should report problems with this site. Anglesite writes an RFC 9116 security.txt from these settings; the first contact is the one researchers should try first.")
                          .font(.callout)
                          .foregroundStyle(.secondary)

                      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                          GridRow {
                              Text("Publishing").frame(minWidth: 160, alignment: .leading)
                              Picker("Publishing", selection: $model.securityReportingSettings.mode) {
                                  Text("Generated by Anglesite").tag(SecurityReportingAsset.Mode.generated)
                                  Text("Hand-authored").tag(SecurityReportingAsset.Mode.manual)
                                  Text("Off").tag(SecurityReportingAsset.Mode.disabled)
                              }
                              .labelsHidden()
                              .frame(width: 220, alignment: .leading)
                          }
                          GridRow(alignment: .top) {
                              Text("Contacts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                              VStack(alignment: .leading, spacing: 6) {
                                  TextEditor(text: $model.securityReportingSettings.contacts)
                                      .font(.body.monospaced())
                                      .frame(minWidth: 260, minHeight: 72)
                                      .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                                      .accessibilityLabel("Security contacts")
                                  Text("One per line, most preferred first. An email address, or an https:// page where reports are accepted.")
                                      .font(.caption)
                                      .foregroundStyle(.secondary)
                              }
                          }
                      }
                  }
              }

              securityReportsGitHubCallout

              if let securityReportingError = model.securityReportingError {
                  Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                      .foregroundStyle(.orange)
                      .font(.callout)
              }

              if model.isSavingSecurityReporting || model.isCheckingRepoSecurity {
                  ProgressView().controlSize(.small)
              }
          }
          .task { await model.refreshRepoSecurityState() }
      }
  ```

- [ ] **Step 2: Replace `securityReportsGitHubCallout`**

  Find:

  ```swift
      @ViewBuilder
      private var securityReportsGitHubCallout: some View {
          if let repo = model.securityReportingRepo {
              VStack(alignment: .leading, spacing: 6) {
                  Label("GitHub", systemImage: "shield.lefthalf.filled")
                      .font(.headline)
                  if model.securityReportingSettings.mode == .manual {
                      // Manual mode: `planSecurityTxt` never generates security.txt for this site
                      // (the owner hand-maintains it), so offering to route reports here — and
                      // enabling PVR to back a contact Anglesite won't publish — would tell the
                      // owner reports go somewhere they don't. Show the address to copy into their
                      // own file instead, and offer no action.
                      Text("Publishing is set to Hand-authored, so Anglesite isn't generating security.txt for this site. Add this address to your own file if you want to route reports to GitHub:")
                          .font(.callout)
                      Text(SecurityReportingAsset.advisoryURL(for: repo).absoluteString)
                          .font(.callout.monospaced())
                          .textSelection(.enabled)
                  } else {
                      switch model.securityReportingReadiness {
                      case .alreadyConfigured:
                          Text("Reports go to \(repo.owner)/\(repo.name)'s private advisory form.")
                              .font(.callout)
                          Link("Open the advisory form", destination: SecurityReportingAsset.advisoryURL(for: repo))
                              .font(.callout)
                          if model.securityReportingStateIsKnown {
                              if model.securityReportingRepoIsPrivate {
                                  Label("\(repo.owner)/\(repo.name) is now private, so researchers outside it can't reach this form. Make the repository public, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                                      .font(.callout)
                                      .foregroundStyle(.orange)
                              }
                              if !model.securityReportingPVREnabled {
                                  Label("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so this form can't accept reports yet. Turn it on, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                                      .font(.callout)
                                      .foregroundStyle(.orange)
                                  Button("Enable Private Reporting") { isConfirmingEnablePVRForConfiguredRepo = true }
                                      .buttonStyle(.bordered)
                                      .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                              }
                          } else {
                              // A check has never succeeded for this repo (first-ever check failed, or
                              // the remote just changed) — `securityReportingRepoIsPrivate`/
                              // `securityReportingPVREnabled` are still unpopulated `false` defaults, so
                              // rendering either warning above would assert state nobody actually
                              // observed. The "couldn't check" error banner below already explains why.
                              Text("Couldn't confirm \(repo.owner)/\(repo.name)'s visibility or private-reporting status on the last check.")
                                  .font(.callout)
                                  .foregroundStyle(.secondary)
                          }
                      case .ready:
                          Text("\(repo.owner)/\(repo.name) accepts private vulnerability reports. Routing reports there keeps them out of public issues and off your inbox.")
                              .font(.callout)
                          Button("Route Reports to GitHub") { Task { await model.adoptAdvisoryForm() } }
                              .buttonStyle(.borderedProminent)
                              .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                      case .needsPVR:
                          Text("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so its advisory form can't accept reports yet. Anglesite can turn it on for you.")
                              .font(.callout)
                          Button("Enable Private Reporting and Route Reports") { isConfirmingEnablePVR = true }
                              .buttonStyle(.borderedProminent)
                              .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                      case .repoPrivate:
                          Text("\(repo.owner)/\(repo.name) is a private repository, so its advisory form isn't reachable by anyone outside it. Make the repository public to route reports there.")
                              .font(.callout)
                      case .unknown:
                          // The check hasn't completed, or it failed. `securityReportingError`
                          // (rendered by the tab below) carries the reason; don't offer an action
                          // we can't back up.
                          Text("Checking whether \(repo.owner)/\(repo.name) can accept private vulnerability reports…")
                              .font(.callout)
                              .foregroundStyle(.secondary)
                      case .notGitHub:
                          EmptyView()
                      }
                  }
              }
              .padding(10)
              .background(Color.secondary.opacity(0.06))
              .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
              .confirmationDialog(
                  "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                  isPresented: $isConfirmingEnablePVR,
                  titleVisibility: .visible
              ) {
                  Button("Turn On and Route Reports") { Task { await model.adoptAdvisoryForm() } }
                  Button("Cancel", role: .cancel) {}
              } message: {
                  Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
              }
              .confirmationDialog(
                  "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                  isPresented: $isConfirmingEnablePVRForConfiguredRepo,
                  titleVisibility: .visible
              ) {
                  Button("Turn On") { Task { await model.enablePrivateVulnerabilityReportingForConfiguredRepo() } }
                  Button("Cancel", role: .cancel) {}
              } message: {
                  Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
              }
          }
      }
  ```

  Replace with:

  ```swift
      @ViewBuilder
      private var securityReportsGitHubCallout: some View {
          if let repo = model.securityReportingRepo {
              SettingsBox(title: "GitHub") {
                  VStack(alignment: .leading, spacing: 6) {
                      if model.securityReportingSettings.mode == .manual {
                          // Manual mode: `planSecurityTxt` never generates security.txt for this site
                          // (the owner hand-maintains it), so offering to route reports here — and
                          // enabling PVR to back a contact Anglesite won't publish — would tell the
                          // owner reports go somewhere they don't. Show the address to copy into their
                          // own file instead, and offer no action.
                          Text("Publishing is set to Hand-authored, so Anglesite isn't generating security.txt for this site. Add this address to your own file if you want to route reports to GitHub:")
                              .font(.callout)
                          Text(SecurityReportingAsset.advisoryURL(for: repo).absoluteString)
                              .font(.callout.monospaced())
                              .textSelection(.enabled)
                      } else {
                          switch model.securityReportingReadiness {
                          case .alreadyConfigured:
                              Text("Reports go to \(repo.owner)/\(repo.name)'s private advisory form.")
                                  .font(.callout)
                              Link("Open the advisory form", destination: SecurityReportingAsset.advisoryURL(for: repo))
                                  .font(.callout)
                              if model.securityReportingStateIsKnown {
                                  if model.securityReportingRepoIsPrivate {
                                      Label("\(repo.owner)/\(repo.name) is now private, so researchers outside it can't reach this form. Make the repository public, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                                          .font(.callout)
                                          .foregroundStyle(.orange)
                                  }
                                  if !model.securityReportingPVREnabled {
                                      Label("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so this form can't accept reports yet. Turn it on, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                                          .font(.callout)
                                          .foregroundStyle(.orange)
                                      Button("Enable Private Reporting") { isConfirmingEnablePVRForConfiguredRepo = true }
                                          .buttonStyle(.bordered)
                                          .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                                  }
                              } else {
                                  // A check has never succeeded for this repo (first-ever check failed, or
                                  // the remote just changed) — `securityReportingRepoIsPrivate`/
                                  // `securityReportingPVREnabled` are still unpopulated `false` defaults, so
                                  // rendering either warning above would assert state nobody actually
                                  // observed. The "couldn't check" error banner below already explains why.
                                  Text("Couldn't confirm \(repo.owner)/\(repo.name)'s visibility or private-reporting status on the last check.")
                                      .font(.callout)
                                      .foregroundStyle(.secondary)
                              }
                          case .ready:
                              Text("\(repo.owner)/\(repo.name) accepts private vulnerability reports. Routing reports there keeps them out of public issues and off your inbox.")
                                  .font(.callout)
                              Button("Route Reports to GitHub") { Task { await model.adoptAdvisoryForm() } }
                                  .buttonStyle(.borderedProminent)
                                  .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                          case .needsPVR:
                              Text("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so its advisory form can't accept reports yet. Anglesite can turn it on for you.")
                                  .font(.callout)
                              Button("Enable Private Reporting and Route Reports") { isConfirmingEnablePVR = true }
                                  .buttonStyle(.borderedProminent)
                                  .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                          case .repoPrivate:
                              Text("\(repo.owner)/\(repo.name) is a private repository, so its advisory form isn't reachable by anyone outside it. Make the repository public to route reports there.")
                                  .font(.callout)
                          case .unknown:
                              // The check hasn't completed, or it failed. `securityReportingError`
                              // (rendered by the tab below) carries the reason; don't offer an action
                              // we can't back up.
                              Text("Checking whether \(repo.owner)/\(repo.name) can accept private vulnerability reports…")
                                  .font(.callout)
                                  .foregroundStyle(.secondary)
                          case .notGitHub:
                              EmptyView()
                          }
                      }
                  }
              }
              .confirmationDialog(
                  "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                  isPresented: $isConfirmingEnablePVR,
                  titleVisibility: .visible
              ) {
                  Button("Turn On and Route Reports") { Task { await model.adoptAdvisoryForm() } }
                  Button("Cancel", role: .cancel) {}
              } message: {
                  Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
              }
              .confirmationDialog(
                  "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                  isPresented: $isConfirmingEnablePVRForConfiguredRepo,
                  titleVisibility: .visible
              ) {
                  Button("Turn On") { Task { await model.enablePrivateVulnerabilityReportingForConfiguredRepo() } }
                  Button("Cancel", role: .cancel) {}
              } message: {
                  Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
              }
          }
      }
  ```

- [ ] **Step 3: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Security Reports tab in SettingsBoxes"
  ```

---

### Task 10: Workers tab → per-group `SettingsBox` + `Table`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`workersTab`, `workerRow`)

**Interfaces:**
- Consumes: `PlistEditorModel.WorkerGroup` (`id`, `name`, `rows: [WorkerRow]`),
  `PlistEditorModel.WorkerRow` (`Identifiable` via `descriptor.id`, `descriptor`, `status:
  Status` where `Status` is `.componentTied(affectedPages: [SiteGraphNode])` or
  `.settingsActivated(isOn: Bool)`) — both already defined in `PlistEditorModel.swift:80-99`,
  unchanged by this plan.
- Produces: `private func workersGroupTable(_ rows: [PlistEditorModel.WorkerRow]) -> some
  View`, `private func workerStatus(_ row: PlistEditorModel.WorkerRow) -> some View` — used
  only inside `workersTab`.

- [ ] **Step 1: Replace `workersTab` and `workerRow`**

  Find:

  ```swift
      private var workersTab: some View {
          VStack(alignment: .leading, spacing: 14) {
              HStack(spacing: 8) {
                  Button {
                      NSWorkspace.shared.open(model.workerDashboardLogsURL)
                  } label: {
                      Label("Production Logs", systemImage: "text.alignleft")
                  }
                  .disabled(!model.workerDashboardEnabled)
                  Button {
                      NSWorkspace.shared.open(model.workerDashboardAnalyticsURL)
                  } label: {
                      Label("Analytics", systemImage: "chart.bar.xaxis")
                  }
                  .disabled(!model.workerDashboardEnabled)
                  if model.isLoadingWorkers {
                      ProgressView().controlSize(.small)
                  }
              }
              if !model.workerDashboardEnabled {
                  Text("Logs and analytics become available after the first deploy that includes a worker.")
                      .font(.caption)
                      .foregroundStyle(.secondary)
              }

              if let workersError = model.workersError {
                  Label(workersError, systemImage: "exclamationmark.triangle.fill")
                      .foregroundStyle(.orange)
                      .font(.callout)
              }

              ForEach(model.workerGroups) { group in
                  VStack(alignment: .leading, spacing: 8) {
                      // Group keys are manifest-owned free text (design doc §3) — display-cased,
                      // never localized or enumerated here.
                      Text(group.name.capitalized)
                          .font(.headline)
                      ForEach(group.rows) { row in
                          workerRow(row)
                      }
                  }
              }
          }
          .task { await model.loadWorkers() }
      }

      private func workerRow(_ row: PlistEditorModel.WorkerRow) -> some View {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(row.descriptor.displayName)
                  .frame(minWidth: 160, alignment: .leading)
                  .help(row.descriptor.description)
              switch row.status {
              case .componentTied(let affectedPages):
                  if affectedPages.isEmpty {
                      Text("Inactive — not used")
                          .foregroundStyle(.secondary)
                  } else {
                      WorkerAffectedPagesButton(pages: affectedPages)
                  }
              case .settingsActivated(let isOn):
                  Toggle(row.descriptor.displayName, isOn: Binding(
                      get: { isOn },
                      set: { newValue in
                          Task { await model.setWorkerActive(row.id, isOn: newValue) }
                      }))
                      .toggleStyle(.switch)
                      .labelsHidden()
                  Text(isOn ? "On" : "Off")
                      .foregroundStyle(.secondary)
                      .frame(minWidth: 28, alignment: .leading)
              }
          }
      }
  ```

  Replace with:

  ```swift
      private var workersTab: some View {
          VStack(alignment: .leading, spacing: 14) {
              HStack(spacing: 8) {
                  Button {
                      NSWorkspace.shared.open(model.workerDashboardLogsURL)
                  } label: {
                      Label("Production Logs", systemImage: "text.alignleft")
                  }
                  .disabled(!model.workerDashboardEnabled)
                  Button {
                      NSWorkspace.shared.open(model.workerDashboardAnalyticsURL)
                  } label: {
                      Label("Analytics", systemImage: "chart.bar.xaxis")
                  }
                  .disabled(!model.workerDashboardEnabled)
                  if model.isLoadingWorkers {
                      ProgressView().controlSize(.small)
                  }
              }
              if !model.workerDashboardEnabled {
                  Text("Logs and analytics become available after the first deploy that includes a worker.")
                      .font(.caption)
                      .foregroundStyle(.secondary)
              }

              if let workersError = model.workersError {
                  Label(workersError, systemImage: "exclamationmark.triangle.fill")
                      .foregroundStyle(.orange)
                      .font(.callout)
              }

              ForEach(model.workerGroups) { group in
                  // Group keys are manifest-owned free text (design doc §3) — display-cased,
                  // never localized or enumerated here.
                  SettingsBox(title: group.name.capitalized) {
                      workersGroupTable(group.rows)
                  }
              }
          }
          .task { await model.loadWorkers() }
      }

      private func workersGroupTable(_ rows: [PlistEditorModel.WorkerRow]) -> some View {
          Table(rows) {
              TableColumn("Name") { row in
                  Text(row.descriptor.displayName)
                      .help(row.descriptor.description)
              }
              TableColumn("Status") { row in
                  workerStatus(row)
              }
          }
          .frame(minHeight: max(60, CGFloat(rows.count) * 28 + 32))
      }

      private func workerStatus(_ row: PlistEditorModel.WorkerRow) -> some View {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
              switch row.status {
              case .componentTied(let affectedPages):
                  if affectedPages.isEmpty {
                      Text("Inactive — not used")
                          .foregroundStyle(.secondary)
                  } else {
                      WorkerAffectedPagesButton(pages: affectedPages)
                  }
              case .settingsActivated(let isOn):
                  Toggle(row.descriptor.displayName, isOn: Binding(
                      get: { isOn },
                      set: { newValue in
                          Task { await model.setWorkerActive(row.id, isOn: newValue) }
                      }))
                      .toggleStyle(.switch)
                      .labelsHidden()
                  Text(isOn ? "On" : "Off")
                      .foregroundStyle(.secondary)
                      .frame(minWidth: 28, alignment: .leading)
              }
          }
      }
  ```

- [ ] **Step 2: Build to verify it compiles**

  ```bash
  swift build --package-path . --target AnglesiteApp 2>&1 | tail -30
  ```

  Expected: `Build complete!` with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add Sources/AnglesiteApp/PlistEditorView.swift
  git commit -m "refactor(app): nest Workers tab groups in SettingsBoxes with zebra-striped tables"
  ```

---

### Task 11: Full verification + manual GUI pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift test suite**

  ```bash
  swift test --package-path . 2>&1 | tail -60
  ```

  Expected: all suites pass, including the seven `PlistEditorModel*Tests` (unaffected —
  no model changes in this plan) and `AnglesiteAppTests` (build succeeds; no
  `PlistEditorView`-level tests exist to run, per Global Constraints).

- [ ] **Step 2: Build the app target**

  ```bash
  xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -60
  ```

  Expected: `** BUILD SUCCEEDED **`. If `Anglesite.xcodeproj` is missing or stale in this
  worktree, run `xcodegen generate` first (per `CLAUDE.md` ▸ "Worktrees").

- [ ] **Step 3: Manual GUI verification**

  Launch the built app, open (or create) any site, open its Settings panel, and confirm:
  - All 7 tabs (Website, Analytics, Redirects, Crawlers, Email Security, Security Reports,
    Workers) render fully — no clipped or truncated labels — and each shows its assigned
    SF Symbol.
  - Clicking each tab switches content correctly and preserves the existing save-on-leave
    behavior (edit a field, switch tabs, switch back — the edit persisted).
  - Website, Analytics, Redirects, Email Security, and Security Reports tabs each render
    inside one or more bordered `SettingsBox` sections.
  - Crawlers' "Content Signals" section and the Workers tab's per-group tables render as
    native `Table`s with visibly alternating (zebra-striped) row backgrounds.
  - Toggling a Worker's switch and editing a Crawlers content-signal Picker still calls
    through to the model exactly as before (no regressions in persisted state).

  Record the outcome in the PR description's Test plan section (per `CONTRIBUTING.md`'s PR
  template requirement) — this manual pass is the test plan for this change, since there is
  no automated view-level test for it.

- [ ] **Step 4: Remove the in-progress label**

  ```bash
  gh issue edit <ISSUE> --repo Anglesite/Anglesite-app --remove-label "🛠️ In Progress"
  ```

  (Per `CLAUDE.md` ▸ "Issue-in-flight signaling" — do this once the PR is about to open,
  since the PR becomes the up-to-date signal from then on.)

---

## After this plan

Once all 11 tasks are complete and verified, use the `superpowers:finishing-a-development-branch`
skill to open the PR — remember `CLAUDE.md`'s requirement to build the PR body from
`.github/PULL_REQUEST_TEMPLATE.md`'s actual headings (Summary, Paired PR check, Test plan),
not a generic Summary/Test-plan shape, and to reference issue `#<ISSUE>` from Task 1.
