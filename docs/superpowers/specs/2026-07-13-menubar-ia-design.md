# Anglesite Menu Bar — North-Star Information Architecture

**Date:** 2026-07-13
**Status:** Approved design
**Relates to:** #518 (menu/toolbar completeness umbrella), #517 (Find + Format), #520 (search backend), #496 (Component Editor), #242 (package model), #334 (Personal Publishing OS), #459 (Claude Code removal)

## 1. Intent

This spec defines the **complete target menu bar** for Anglesite — the finished app's IA, not a
delta against today's menus. The structure is modeled on the iWork menu bar (the correct
precedent for a document-centric Apple creative app) and reconciled with Anglesite's realities:
sites are `.anglesite` packages whose `Source/` is a git repo (#72, #242), and the editing
surface is the Component Editor (#496), which is landing in slices.

**Rollout policy (decided): full skeleton, disabled items.** The entire menu structure ships in
one release. Items whose backing does not exist yet render disabled (standard dimmed state, no
explanatory suffix). Every item below carries an availability tag:

| Tag | Meaning |
|---|---|
| `shipped` | Works today (post-#518 sweep) |
| `app` | Deterministic app work; no editor dependency |
| `editor` | Requires Component Editor write path (#496 slice 2+) |
| `subsystem` | Requires a new subsystem defined in §4 |

Shortcut re-keys (§3) land **with** the skeleton so muscle memory changes only once.

## 2. Menu-by-menu IA

Top-level lineup: **Anglesite · File · Edit · Insert · Page · Format · Arrange · View ·
Website · Window · Help** (iWork reference order).

> **Menu-order deviation (decided 2026-07-13):** SwiftUI places all custom `CommandMenu`s
> between the View and Window menus, so the shipping order is *Anglesite · File · Edit ·
> View · Insert · Page · Format · Arrange · Website · Window · Help*. Achieving the exact
> iWork order needs an AppKit `NSApp.mainMenu` reordering shim that survives SwiftUI menu
> rebuilds — deferred to a follow-up spike; the SwiftUI order is accepted until then.

Global rules:

- **One command, one menu home.** Commands may also appear in context menus and the toolbar,
  never in two top-level menus.
- **Focus-scoped targets.** Edit-menu verbs (Cut/Copy/Delete/Duplicate) act on the focused
  surface — navigator selection or editor selection — via the established
  `.focusedSceneValue` → `@FocusedValue` plumbing.
- All strings go through the String Catalog (#528). Every item is reachable by keyboard and
  VoiceOver.

### 2.1 Anglesite (app menu)

| Item | Tag | Notes |
|---|---|---|
| About Anglesite | shipped | |
| Settings… ⌘, | shipped | |
| Provide Anglesite Feedback… | app | Opens `https://anglesite.dwk.io/feedback/` |
| Privacy & Analytics… | app | Opens the Settings pane governing App Store analytics consent (Keynote pattern) |
| Services ▸ / Hide / Hide Others / Show All / Quit | shipped | Standard, automatic |

### 2.2 File

Document verbs follow the **git-backed document model** (§4.1). Site-operations items
(Settings/Analytics/Logs) live in the Website menu, not File.

| Item | Tag | Notes |
|---|---|---|
| New Site… ⇧⌘N | shipped | Scaffold flow. ⌘N belongs to Page ▸ New Page… (Xcode convention: the everyday unit gets the fast key) |
| Open… ⌘O | shipped | `NSOpenPanel` on the `.anglesite` UTI |
| Open Recent ▸ | shipped | Recents registry |
| Close ⌘W | shipped | |
| Save ⌘S | shipped | |
| Duplicate ⇧⌘S | app | Copies the package with a **fresh site UUID** (#242 identity rule); registers in recents |
| Save As… (⌥ alternate of Duplicate) | app | Modern-macOS alternate item |
| Rename… | shipped | |
| Move To… | app | Relocates the package; recents registry and (MAS) security-scoped bookmark update |
| Revert To ▸ | subsystem §4.1 | Last ~10 `Source/` commits (message + date), then **Browse All Versions…** |
| Reveal in Finder | shipped | |
| Share… | shipped/app | ShareLink (#523) for deployed/preview URL; adds "Package as Single File" option (§4.2) |
| Import Site… | shipped | |
| Export To ▸ Astro Website… · Built HTML… | shipped/app | Astro Website = `Source/` copy-out (today's export). Built HTML = build in the site runtime, save `dist/` |
| Reduce File Size… | subsystem §4.3 | Git-repo size reduction (unused binary blobs) with savings report |
| Advanced ▸ Change File Type ▸ Single File · Package | subsystem §4.2 | Keynote semantics |
| Advanced ▸ Language & Region… | app | Per-site i18n setup: localized routes, hreflang, language switcher |
| Set Password… | subsystem §4.2 | iWork-style package encryption |
| Print… ⌘P | shipped | |

**Cut:** *Activity Settings…* — collaboration is v2; reserved for then.

### 2.3 Edit

| Item | Tag | Notes |
|---|---|---|
| Undo ⌘Z / Redo ⇧⌘Z | shipped | #527 |
| Cut ⌘X / Copy ⌘C / Paste ⌘V / Paste and Match Style ⌥⇧⌘V / Delete | shipped/editor | Focus-scoped |
| Duplicate ⌘D | shipped/editor | Shipped for navigator (#516); extends to editor selection ("Duplicate Selection" folds in) |
| Select All ⌘A / Deselect All ⇧⌘A | shipped/editor | |
| Select Parent ⌥⌘↑ | editor | Walks up the element/zone tree (code-editor expand-selection convention) |
| Remove Highlights and Comments | subsystem §4.4 | |
| Find ▸ Find… ⌘F · Find Next ⌘G · Find Previous ⇧⌘G · Find & Replace… ⌥⌘F · Use Selection for Find ⌘E · Search Site… | app/editor | The #517 work; Search Site… shares the #520 backend |
| Spelling and Grammar ▸ / Substitutions ▸ / Transformations ▸ / Speech ▸ | app/editor | Standard system menus. Substitutions defaults: Smart Quotes, Smart Dashes, Smart Web/Email Links, Smart @ Mention Links **on**; Smart Phone Number Links, Text Replacements off. See §4.5 for @ mentions and the zone-suppression rule |
| AutoFill ▸ / Start Dictation / Emoji & Symbols | shipped | System items |

**Cut:** *Clear All* (no standard macOS meaning; Select All + Delete covers it).

### 2.4 Insert

Every Insert item emits **semantic HTML/MDX into the page source through the Component Editor
write path** (plugin `apply-edit`, zone-aware). The whole menu is tag `editor` except where
noted. Menu items are grammar; the editor is the pen — the menu enables wholesale when the
write path lands.

- **Component ▸** Component Gallery… · New Component… · *(recently used components listed
  inline)* — *New Component… relocates from today's File ▸ New submenu (#516)*
- Article · Section · Figure
- **Heading ▸** Heading 1–6 — *renamed from "Header" to avoid collision with Page ▸ Edit
  Header (site chrome); HTML calls these headings*
- Paragraph · Horizontal Rule · Preformatted Text · Blockquote
- **List ▸** Ordered · Unordered · Association · — · List Item — *"Association" is the WHATWG
  term for `<dl>` (name–value groups), per the outline's spec reference*
- **Rich blocks (submenus; variants populated from the template's component library):**
  Table ▸ · Image ▸ · Video ▸ · Audio ▸ · Image Gallery ▸ · Form ▸ · Navigation ▸
- Highlight · Comment ⇧⌘K — draft annotations (§4.4)
- Image Playground… `app+editor` (ImagePlayground API) · Web Video… (privacy-friendly
  YouTube/Vimeo embed component) · Import from Phone ▸ (Continuity Camera: Take Photo / Scan
  Documents / Add Sketch) · Record Audio… (AVFoundation)
- Equation… ⌥⌘E — editor sheet emitting **MathML** (native browser rendering); accepts LaTeX
  input
- **Advanced ▸** — lesser-used elements: Script · Canvas · Inline Frame · Embed ·
  Details/Summary · Dialog · Custom Element… *(attribute editing is NOT here — it lives in the
  Inspector's Attributes tab, §2.8)*
- Choose… ⇧⌘V — insert any file from disk (iWork parity); media routes through the asset
  pipeline

**Cut:** *Formula ▸ (Sum/Average/…/New Formula)* — implies a formula engine over table data;
no demonstrated demand in a website builder. May revisit if data tables grow computation.

### 2.5 Page

| Item | Tag | Notes |
|---|---|---|
| New Page… ⌘N | shipped | The everyday create action gets ⌘N (relocates from File ▸ New) |
| New Post… | shipped | Typed-content creation (#516); relocates from File ▸ New |
| Edit Header / Edit Footer | editor | Opens site-chrome header/footer layout zones in the editor |
| Styles… | editor | Page/site style editor: theme tokens, type scale — the design-system surface |
| Collections ▸ New Blog… · New Podcast… · New Inventory… | app | Typed collections from the content-type registry (#335) |
| Collections ▸ Add RSS Feed to Directory / Remove RSS Feed | subsystem §4.6 | Site's public feed directory (blogroll) |

Page deletion/duplication stays in **Edit ▸ Delete / Duplicate** acting on the navigator
selection (shipped, #516) — no duplicate items here.

### 2.6 Format

Font items are **semantic elements** (`strong`/`em`/`u`/`s`/`code`), not visual styling.

| Item | Tag | Notes |
|---|---|---|
| Font ▸ Strong ⌘B · Emphasis ⌘I · Underline ⌘U · Strikethrough · Code | editor | Code has no shortcut in v1 (⌘E belongs to Use Selection for Find) |
| Text ▸ Align Left ⌘{ · Center ⌘\| · Right ⌘} · Justify · Auto-Align Table Cell · Increase Indent ⌘] · Decrease Indent ⌘[ · Reverse Text Direction | editor | Indent takes ⌘[/⌘] (see §3) |
| Table ▸ / Image ▸ | editor | Selection-typed submenus (rows/columns/header options; alt text, crop, replace). Detail deferred to Component Editor slices |
| Copy Style ⌥⌘C / Paste Style ⌥⌘V | editor | iWork shortcuts |
| Copy Animation / Paste Animation | editor | Transfers CSS animation between components |
| Add Link… ⌘K / Remove Link | editor | ⌘K claimed for links (see §3) |

**Cut:** *Conditional Highlighting…* — Numbers feature presuming the cut formula/data-table
subsystem. *Format ▸ Advanced* is also cut: lesser-used **elements** moved to Insert ▸
Advanced; **attribute** editing moved to the Inspector's Attributes tab.

### 2.7 Arrange

**Contextual:** items enable only when the selection lives in a freeform-capable context
(hero/canvas components, image overlays); disabled for flow content. Exception: **Group on
flow content = wrap selection in a container element**, enabled everywhere. All tag `editor`.

- Bring Forward · Bring to Front · Send Backward · Send to Back
- Align Objects ▸ Left / Center / Right / — / Top / Middle / Bottom
- Distribute Objects ▸ Horizontally / Vertically *(added for iWork parity — nearly free next
  to Align)*
- Flip Horizontally / Flip Vertically
- Lock ⌘L / Unlock ⌥⌘L
- Group ⌥⌘G / Ungroup ⇧⌥⌘G

### 2.8 View

| Item | Tag | Notes |
|---|---|---|
| Show Preview ⌘1 / Show Editor ⌘2 / Show Graph ⌘3 | shipped | |
| Show/Hide Chat ⌃⌘K | shipped | **Re-keyed** from ⌘K (§3) |
| Show/Hide Related Pages | shipped | |
| Inspector ▸ Style · Animation · Attributes · — · Show Next/Previous Inspector Tab · — · Hide Inspector ⌥⌘I | shipped/app | Dynamic per selection. **Attributes tab** hosts element-attribute editing (id, classes, data-*, ARIA) with advanced attributes behind disclosures |
| Show/Hide Sidebar (system default shortcut) · Customize Toolbar… | shipped | #510/#519 — shortcuts owned by SwiftUI `SidebarCommands`/`ToolbarCommands` |
| Reload ⌘R · Back ⌃⌘← · Forward ⌃⌘→ · Actual Size ⌘0 · Zoom In ⌘+ · Zoom Out ⌘− | shipped | Back/Forward **re-keyed** from ⌘[/⌘] (§3) |
| Enter Full Screen | shipped | Standard |
| Show Debug Pane ⌥⌘D | shipped | Debug hidden in Release unless enabled. Show Web Inspector ⇧⌥⌘I removed in #1099 — it only worked through private WebKit API that's compiled out in the shipping (MAS) target |

### 2.9 Website

The single home for "operate the site" — absorbs the shipped Site menu plus the outline's
Website menu. Groups top to bottom:

| Group | Items | Tag |
|---|---|---|
| Configure | Website Settings… · Analytics… · Logs… | shipped/app — Analytics/Logs are in-app provider-backed views |
| Preview | Preview in ▸ Default Browser · — · Safari · Chrome · Firefox | shipped/app — generalizes Open in Browser |
| Publish | **Publish… ⇧⌘P** · Recheck Readiness · Backup | shipped — *Publish renames Deploy (the Personal Publishing OS verb); `pre-deploy-check` still gates it, no override* |
| Quality | Audit · Harden… · Siri AI Readiness… | shipped |
| Grow | Domain… · Add Integration… · Assistant ▸ Review Copy… / Social Media Plan… / Design Interview… | shipped |
| Source | GitHub ▸ View on GitHub / Publish to GitHub… | shipped |
| Run | Dev Server ▸ Start / Stop / Restart ⌥⌘R | shipped |
| Provider | Cloudflare ▸ Dashboard / Config… | app — submenu named for the connected provider; external links. No Analytics/Logs here (the in-app views above cover them) |

### 2.10 Window · Help

**Window:** fully standard/automatic (Minimize ⌘M, Zoom, tiling, open-windows list, Bring All
to Front). No custom items.

**Help:** Anglesite Help (Help Book, shipped) with automatic search · What's New in Anglesite
`app` · Anglesite Website `app`. (Feedback lives in the app menu.)

## 3. Shortcut registry — conflicts and re-keys

Three shipped shortcuts move; all land with the skeleton release:

| Shortcut | Was (shipped) | Becomes | Rationale |
|---|---|---|---|
| ⌘K | Toggle Chat | **Add Link…** | macOS editor convention (iWork, Mail) is near-sacred in an editing-first app |
| ⌃⌘K | — | Toggle Chat | One modifier from ⌘K; no conflicts |
| ⌘[ / ⌘] | Preview Back/Forward | **Decrease/Increase Indent** | Editor convention (iWork, every text editor) |
| ⌃⌘← / ⌃⌘→ | — | Preview Back/Forward | Xcode's navigation-history keys — the right precedent for an editor with an embedded browser |
| ⇧⌘D | Deploy | *(retired with the rename)* | |
| ⇧⌘P | — | Publish… | Mnemonic for the renamed verb |
| ⌘N / ⇧⌘N | New Site / (varies) | New Page… / New Site… | Xcode convention: everyday unit gets ⌘N |

Non-conflicts by design: ⌘D Duplicate is one focus-scoped command (navigator item or editor
selection); ⇧⌘K Comment (iWork parity) coexists with ⌘K/⌃⌘K; ⌥⌘E Equation (Pages parity);
⇧⌘V Choose (iWork parity); ⌥⌘C/⌥⌘V Copy/Paste Style (iWork parity); ⌘L/⌥⌘L Lock/Unlock and
⌥⌘G/⇧⌥⌘G Group/Ungroup (iWork parity).

## 4. Subsystem definitions

### 4.1 Git-backed document versions (Revert To)

Versions are **git commits of `Source/`** — no NSDocument version store (it would compete with
git as source of truth, #72).

- **Revert To ▸** lists the last ~10 commits (subject line + relative date).
- **Browse All Versions…** opens a history browser over `git log` (list UI, not the
  Time-Machine starfield): per-commit preview of the rendered page where feasible, diff
  summary otherwise.
- Reverting creates a **safety commit** of any uncommitted work first, then applies the
  revert as a new commit (`git revert`-style, history-preserving — never a destructive
  reset). Clones remain valid.

### 4.2 Single File and Set Password (at-rest states)

Keynote semantics, with one Anglesite-specific rule that reconciles them with #72:

> **Single-file and encrypted are transport/at-rest states.** The app rehydrates a
> single-file or encrypted package to normal package form to edit it. git/CLI/VS Code interop
> applies to the rehydrated package.

- **Change File Type ▸ Single File** produces a zipped single-file `.anglesite` (cloud-drive-
  safe sharing — third-party drives mangle package directories). **▸ Package** converts back.
  Opening a single-file site rehydrates before the window appears.
- **Set Password…** encrypts the package like an iWork document password. While locked, the
  `Source/` repo is not externally clonable — that is the user's explicit, informed trade
  (the password sheet says so). Keys via Keychain; standard iWork password/hint UX.

### 4.3 Reduce File Size

Targets the **git repository's** size — primarily unused binary blobs.

- v1 semantics: identify binary assets no longer referenced by the current site, offer
  removal from the working tree, then repack (`git gc`). Report bytes saved.
- History rewriting (purging blobs from past commits) is offered only as an explicitly
  destructive second step. If `Source/` has a **git remote configured**, the warning states
  that it invalidates existing clones (#72 — clones are first-class); with no remote there
  are no clones, so the step runs with an ordinary confirmation and no clone warning.

### 4.4 Highlights & Comments (draft annotations)

Single-author review marks. Stored in the page source as build-stripped annotations
(data attributes or a sidecar file — implementation's choice, but they must never reach
published output). Visible in editor and preview only. **Edit ▸ Remove Highlights and
Comments** clears all in the current page. Collaboration (multi-user threads) is v2, along
with Activity Settings.

### 4.5 Smart @ Mention Links

`@` mentions resolve **Fediverse and ATmosphere identities**: `@user@instance.social` via
Webfinger; AT Protocol handles (`@name.bsky.social`) via AT resolution. Substitution emits a
profile link (microformats-annotated, positioning for #334 V-4 ActivityPub work).

**Zone-suppression rule (applies to all substitutions):** smart quotes/dashes/links must not
fire inside code spans, code blocks, or frontmatter — curly quotes in code or YAML break
builds. The substitution layer is zone-aware, same as the edit overlay.

### 4.6 Feed directory

Page ▸ Collections ▸ Add/Remove RSS Feed manage the site's **public feed directory**
(blogroll): a typed content object rendering as a directory page + OPML. Fits the
content-type registry (#335).

## 5. Cut list (recorded so they don't silently return)

| Cut | Reason |
|---|---|
| Formula ▸ (+ New Formula) | Formula engine over table data; no demonstrated demand |
| Conditional Highlighting… | Presumes the cut formula/data-table subsystem |
| Clear All | No standard macOS meaning |
| Activity Settings… | Collaboration is v2; returns with it |
| Format ▸ Advanced | Elements → Insert ▸ Advanced; attributes → Inspector Attributes tab |
| Transformations ▸ Rotate to Horizontal / Full Width | Not standard macOS transformations; system menu ships its standard set |

## 6. Architecture & rollout

- **`Commands`-type-per-menu** continues: new `InsertCommands`, `PageCommands`,
  `FormatCommands`, `ArrangeCommands`; `WebsiteCommands` absorbs `SiteMenuCommands`.
  State/actions publish via `.focusedSceneValue`, read via `@FocusedValue` (established
  pattern). Note the verified anchor asymmetry: `after:` groups render in declaration order,
  `before:` groups in reverse declaration order (see `AnglesiteApp.swift` comments).
- **Availability gating:** each item's enabled state derives from a capability check
  (focused-scene value presence for shipped items; feature-flag/capability protocol for
  gated ones), not per-item ad-hoc logic.
- **Sequencing:** (1) skeleton + re-keys + renames (Publish, Heading) in one release;
  (2) `app`-tagged items as normal feature work; (3) `editor` items enable per Component
  Editor slice; (4) each §4 subsystem gets its own issue ladder.
- The skeleton release supersedes the remaining scope of #517/#520's menu placement (their
  backends remain their own issues) and closes out #518's "Format menu" line.
