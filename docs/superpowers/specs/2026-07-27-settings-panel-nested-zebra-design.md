# Site Settings panel — tab bar fix + nested/zebra-striped content — design

**Date:** 2026-07-27
**Status:** Approved (brainstorm 2026-07-27)
**Repo:** `Anglesite/Anglesite-app` (app-only; no MCP or worker-catalog schema changes)
**Issue:** #1040

## Context

The per-site Settings panel (`PlistEditorView`, hosted from `SiteWindow.swift:778`; not to
be confused with the unrelated app-level `SettingsView.swift` Preferences window) shows a
row of 7 tabs — Website, Analytics, Redirects, Crawlers, Email Security, Security Reports,
Workers — followed by that tab's content in a scroll view.

Two problems were reported, with an Xcode "Signing & Capabilities" screenshot as the
reference for the desired look:

1. **Tab bar misalignment.** The tabs are a native `Picker` with `.pickerStyle(.segmented)`
   capped at `.frame(maxWidth: 520)` (`PlistEditorView.swift:97-104`). AppKit gives every
   segment of a segmented control *equal* width regardless of label length, so `"Website"`
   gets padding while `"Email Security"`/`"Security Reports"` clip. This is a control-shape
   problem, not a sizing problem — Xcode's own tab strip (General / Signing & Capabilities /
   …) isn't a segmented control either; it's independently-sized tab buttons.
2. **Flat, inconsistent content.** Every tab except Workers lays out its fields with
   `Grid`/`GridRow`; Workers hand-rolls `HStack` rows with a fixed-width label
   (`workerRow(_:)`, `PlistEditorView.swift:683-709`) — an existing inconsistency in the
   file. Nothing is grouped into nested sections or zebra-striped the way Xcode nests
   capabilities (Signing (Debug) / App Sandbox) and zebra-stripes literal list/table
   content (the File Access table).

## Decisions (from the brainstorm)

1. **Tab bar → custom natural-width tab strip**, not a sidebar. The 7 items stay a
   horizontal row (per the original wording, "the settings **tabs**"); the fix is
   replacing the equal-width segmented control with independently-sized tab buttons, each
   carrying an SF Symbol + label.
2. **SF Symbols apply to the 7 top-level tabs only**, not to individual Workers toggle
   rows. Worker rows are `WorkerDescriptor`s fetched from a remote catalog
   (`WorkerCatalogFetcher` → `WorkerCatalog.swift`) with no icon field in the schema;
   adding one would be a cross-repo catalog schema change (`davidwkeith/workers`), which
   is out of scope here per `CONTRIBUTING.md`'s catalog-coordination note. Group headers
   (Discovery/Identity/…) also get no icon, matching how Xcode's own capability-box
   headers (`Signing (Debug)`, `App Sandbox`) are bold text only, no icon.
3. **"Nested" applies panel-wide; "zebra-striped" applies only to genuinely list-shaped
   content.** In the Xcode reference, the Team/Bundle Identifier/Provisioning Profile form
   rows are *not* striped — only the literal File Access table is. Force-striping every
   2-row form would look odd and doesn't match the reference. So:
   - Every tab's content is wrapped in one or more nested `SettingsBox` containers
     (rounded-rect border, subtle fill, bold header) — this is the "nested" part, mirroring
     how Xcode nests Network/Hardware/App Data/File Access inside the App Sandbox box.
   - List-shaped content (Workers' toggle rows, Crawlers' Content Signals rows) moves from
     hand-rolled `HStack`s into a native SwiftUI `Table`, which auto-zebra-stripes on macOS
     — exactly Xcode's File Access widget, and already proven to work well in this file by
     the existing Redirects tab (`PlistEditorView.swift:295-317`).
   - Simple 2-4 row forms (Website, Analytics, MTA-STS fields, Security Reports fields)
     stay as `Grid`-in-a-`SettingsBox`, unstriped.
4. **No MCP or worker-catalog schema changes.** Everything here is `PlistEditorView.swift`
   and new small SwiftUI helper views in `AnglesiteApp`. No paired PR needed.

## Goals

- Tabs never clip regardless of label length; each has a distinct, recognizable SF Symbol.
- All 7 tabs share one consistent nested-box visual language instead of three divergent
  layout patterns (`Grid`, ad hoc `HStack`, ad hoc `.background(Color.secondary.opacity(...))`
  callouts).
- List-shaped rows (Workers, Crawlers Content Signals) get native macOS zebra striping.
- No behavior change: every existing binding, save-on-tab-change, validation banner, and
  error-message affordance keeps working exactly as today — this is a visual/structural
  refactor only.

## Non-goals

- No change to the *sidebar* app navigation, the app-level Preferences window
  (`SettingsView.swift`), or any other window.
- No conversion of the top tab bar into a vertical/nested sidebar — it stays a horizontal
  strip, per decision 1.
- No per-worker-row icons (see decision 2) — that needs a catalog schema change, tracked
  separately if ever pursued.
- No behavioral/data changes to redirects, crawler policy, MTA-STS, security reporting, or
  worker activation logic.

## Architecture

### 1. Tab bar (`PlistEditorView.swift`)

Replace the `SettingsTab` segmented `Picker` (lines 97-104) with a custom tab strip:

- A private `SettingsTabBar` view: `HStack(spacing: 4)` of per-tab buttons. Each button
  shows `Label(tab.title, systemImage: tab.symbolName)` in a `.labelStyle(.titleAndIcon)`
  (or vertical icon-over-title, matching a quick visual check against the Xcode reference
  during implementation), sized to fit its own content (no shared `frame(maxWidth:)`),
  horizontal padding, and a bottom-border/background highlight when `tab == selectedTab`.
  Not a native `Picker`/`Menu` — a plain `Button` per tab keeps per-item sizing and
  selection styling under our control, same as Table already being used for per-item
  control in this file.
- Icon assignment, added to the `SettingsTab` enum as a computed `symbolName`:

  | Tab | SF Symbol |
  |---|---|
  | Website | `globe` |
  | Analytics | `chart.bar.xaxis` |
  | Redirects | `arrow.triangle.turn.up.right.diamond.fill` |
  | Crawlers | `text.magnifyingglass` |
  | Email Security | `envelope.badge.shield.half.filled` |
  | Security Reports | `doc.text.magnifyingglass` |
  | Workers | `bolt.fill` |

  `globe` and `chart.bar.xaxis` reuse symbols already used elsewhere in this file for the
  same concepts (`hasWebsiteIcons` fallback at line 175; Workers' "Analytics" dashboard
  button at line 649) — kept for visual consistency rather than picking fresh symbols for
  the same idea.
- All existing `.onChange(of: selectedTab)` save-on-leave logic (lines 39-51) is untouched
  — it only depends on the `selectedTab` state value, not on how it's set.

### 2. `SettingsBox` — nested section container

New small reusable view (new file, `Sources/AnglesiteApp/SettingsBox.swift`, or inline
private view in `PlistEditorView.swift` if it stays under ~30 lines — decide at
implementation time based on final size):

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

This formalizes a pattern that already exists ad hoc twice in the file today (the MTA-STS
"Required DNS records" callout at lines 452-477, and the Security Reports GitHub callout
at lines 537-613 both hand-build `.padding(10)` + `.background(Color.secondary.opacity(0.06))`
+ rounded-rect clip) — those two call sites are replaced with `SettingsBox` too, removing
the duplication rather than adding a third variant of the same box.

### 3. Per-tab mapping

| Tab | Boxes | Zebra-striped? |
|---|---|---|
| Website | One box ("Website"): existing `Grid` (Title, Icons) | No — 2-row form |
| Analytics | One box ("Analytics"): existing `Grid` (Cloudflare, Custom) | No — 2-row form |
| Redirects | One box ("Redirects") wrapping the existing `Table` | Already yes — native `Table` default |
| Crawlers | Two boxes: "AI Training" (existing toggle+description), "Content Signals" (Search/AI Answers/AI Training rows) | Content Signals box: yes — convert `contentSignalRow` from `VStack`/`HStack` to a `Table` with columns (Purpose, Setting, Description) |
| Email Security | Two boxes: "MTA-STS" (existing `Grid`), "Required DNS Records" (existing conditional callout, now via `SettingsBox`) | No — forms/prose |
| Security Reports | Two boxes: "Vulnerability Reports" (existing `Grid`), "GitHub" (existing callout, now via `SettingsBox`) | No — forms/prose |
| Workers | One `SettingsBox` per `model.workerGroups` entry (Discovery/Identity/Publishing/Social/Storage), title = `group.name.capitalized` (unchanged manifest-owned free text) | Yes — rows inside each box become a `Table` (Name, Status) replacing `workerRow(_:)`'s hand-rolled `HStack` |

Worker/Content-Signals `Table` columns carry the same controls already in use today
(`Toggle`, `WorkerAffectedPagesButton`, segmented `Picker`) — only the row container
changes, not the controls inside it, so no behavior changes.

### 4. Testing

This is a pure SwiftUI view refactor with no changes to `PlistEditorModel`,
`WorkerCatalog`, or any persistence/save logic, so:

- No new unit tests are needed — existing `PlistEditorModel`/`WorkerCatalog`-level tests
  are unaffected since their public surface doesn't change.
- Verify by hand in the running app (per this repo's UI-change convention): open a site's
  Settings panel, confirm all 7 tabs render untruncated with icons, click through each tab
  and confirm existing fields still bind/save/validate correctly, and confirm the Workers
  and Crawlers Content Signals tables render with alternating row backgrounds.
- Run `swift test --package-path .` and `xcodebuild … build` per `CONTRIBUTING.md` to
  confirm the refactor doesn't break compilation or any existing suite.

## Open questions for implementation time

- Exact `SettingsTabBar` button styling (title+icon side-by-side vs. icon-over-title,
  underline vs. filled-background selection indicator) — implementer should eyeball both
  against the Xcode reference screenshot and pick whichever reads cleanest at the panel's
  actual width; not worth over-specifying here.
- Whether `SettingsBox` becomes its own file or stays a private type in
  `PlistEditorView.swift` — decide based on final line count.
