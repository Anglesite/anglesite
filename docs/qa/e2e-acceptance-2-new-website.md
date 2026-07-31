# E2E Acceptance — Part 2: Create a New Website

**Sequence:** Part 2 of 4 — requires Part 1's exit state (running app, empty launcher).
**Scope:** File ▸ New ▸ Site through a live previewing site window: template chooser, scaffold on disk, container boot, first render.

## Purpose

Verify a user can create a `.anglesite` package end-to-end: the chooser asks exactly one question (which template), the scaffold lands a complete git-initialized `Source/` **with a real initial commit** (#697) named "Untitled" in the sites root, the site registers in recents, and the container runtime boots to a live preview of the owner's homepage without further user action.

## Preconditions

- Part 1 passed. Container artifacts provisioned and build entitled (overview doc) — otherwise every case from 7 on fails by design.
- Test inputs used throughout: a non-default built-in theme picked in the chooser. There is no name/type/content/domain input — the site is created as **"Untitled"** (#1071).

## Acceptance Matrix

| # | Case | Result | Notes |
|---|---|---|---|
| 1 | Wizard entry points |  |  |
| 2 | Chooser, labels, selection |  |  |
| 3 | Sandbox grant + silent save location |  |  |
| 4 | Building checklist completes clean |  |  |
| 5 | Package layout + marker on disk |  |  |
| 6 | Git repo with initial commit (#697) |  |  |
| 7 | Site window opens; dev server auto-boots |  |  |
| 8 | Preview renders the owner's homepage |  |  |
| 9 | Recents, window chrome, Finder behavior |  |  |
| 10 | Window close tears down the runtime |  |  |
| 11 | Negative: duplicate name / cancelled grant |  |  |
| 12 | Negative: unprovisioned runtime messaging |  |  |

## Test Cases

### 1. Wizard entry points

All three routes present the same wizard sheet on the launcher window:

- **File ▸ New ▸ "Site"** (⇧⌘N) — note ⌘N is New Page, not New Site.
- Dock menu **"New Site"**.
- Launcher **Add Site → "Create new site…"**.

### 2. Chooser, labels, selection

One screen (fixed ~560×460 sheet; footer **Cancel / Create**):

- Title **"Choose a Template"**; a grid of theme cards, each a miniature page mock in the
  theme's colors with name + description. The first catalog theme is pre-selected.
- Single click selects (accent ring); **double-click creates immediately**.
- **Create** is the default button (Return). No name field, no domain question, no site-type
  step, no content step, no save panel (#1071).
- Cancel must dismiss with nothing on disk.

### 3. Sandbox grant + silent save location

Expected:

- First creation on a sandboxed build usually does **not** raise a "Grant Access" open panel — the app's own iCloud container needs no such grant. The panel only appears when iCloud is unavailable and the site root falls back to `~/Sites/`; in that case granting proceeds and it must not re-prompt for subsequent sites in the same root.
- The package lands at `Untitled.anglesite` in the sites root with no panel shown; a second run in the same session lands `Untitled 2.anglesite`.

### 4. Building checklist completes clean

Expected, in order, all check off: created the website file → copied the template → applied your theme → prepared the starter content → installing → registering → done. On a clean build the wizard dismisses itself and the site window opens.

- Warnings (⚠️ rows, e.g. "git init skipped", "Dependency baseline not saved") keep the wizard open with "…something above needs attention" and an **"Open Website Anyway"** button — record any warning verbatim; a clean run should have none.
- Failures at *create folder*, *copy template*, or *register* are fatal and must roll back the half-written package (verify no orphan `Untitled.anglesite` remains after a forced failure, if simulated).

### 5. Package layout + marker on disk

(Substitute your iCloud "Anglesite" folder for `~/Sites/` below if iCloud is available on the test machine.)

Inspect `~/Sites/Untitled.anglesite/`:

- `Info.plist` marker with format version 1, a stable site UUID, display name "Untitled", created date.
- `Source/` — the Astro project: `package.json` (name `anglesite-site`), `astro.config.ts`, `src/`, `public/`, `scripts/`, `worker/`, `.site-config`.
- `.site-config` contains: `SITE_NAME=Untitled`, `DOMAIN_CHOICE=later`, `THEME`, `CF_PROJECT_NAME=untitled`, and the real `ANGLESITE_VERSION` (not the `1.0.0` placeholder); **must not contain** `SITE_TYPE` or `TAGLINE`.
- `Config/` exists beside `Source/` with the dependency baseline; `Config/` is **not** inside the git repo.
- Excluded from the copy: `scripts/scaffold.sh`, `scripts/themes.ts`, `*.test.ts`, `integrations/`, `node_modules/`.
- When the package landed in the iCloud folder, any sync indicator (toolbar/inspector) showing this site as iCloud-sync-eligible is **expected, not a regression**: since #865 new sites are created inside the iCloud container, so `ICloudSyncEligibility` (#881) is now true by default rather than only for deliberately-relocated sites.

### 6. Git repo with initial commit (#697)

In `Source/`:

```sh
git -C ~/Sites/Untitled.anglesite/Source log --oneline
git -C ~/Sites/Untitled.anglesite/Source status --porcelain
```

Expected:

- Exactly one commit, message **"Initial commit"**, containing the scaffold *after* theme + homepage writes (working tree clean, or nearly — record any uncommitted paths).
- No `.env` / `.env.*` files staged in the commit.
- This is the regression guard for #697: a zero-commit repo makes the container's `git checkout HEAD` hydration fail and the site can never preview.

### 7. Site window opens; dev server auto-boots

Expected without any user action after the wizard:

- The "Untitled" window opens (launcher dismisses) and the preview pane enters `.starting`: **"Starting dev server for Untitled…"** with a determinate progress bar walking "Starting dev server…" → "Building site…" → "Connecting to preview…", plus an ungated **"Show Logs"** affordance that opens the Debug window.
- Debug logs show the container path: image import, VM boot, guest `git clone` of `Source/`, `npm install`, `astro dev`, MCP sidecar, vsock proxies. Record cold-start wall-clock time (first boot includes `npm install` — minutes is normal; a silent stall in "Building site…" beyond ~10 min is a fail).
- The preview URL is loopback (`http://127.0.0.1:<os-assigned port>`) — never a guest IP.

### 8. Preview renders the owner's homepage

Expected once ready:

- Homepage shows the **template placeholder** ("Welcome" hero — the owner edits it in the preview); the chosen theme's colors are visibly applied.
- `/about` renders the business-profile page; `/blog/` renders the empty state ("No posts yet…" with an RSS link); `/rss.xml` returns a feed.
- The window's subtitle shows the live preview URL.

### 9. Recents, window chrome, Finder behavior

- The site appears in the launcher list (green check), **File ▸ Open Recent**, and the Dock menu.
- Window title is "Untitled". Note whether a title-bar proxy icon appears (not currently wired — evidence for #680).
- In Finder the package is a single opaque document ("Anglesite Site"); double-clicking it opens/focuses the site in Anglesite. `cd`, `git`, and an external editor still descend into `Source/` normally.
- Quit and relaunch the app: the last-opened site auto-opens (MRU), skipping the launcher.

### 10. Window close tears down the runtime

Close the site window; within a few seconds no `com.apple.Virtualization` process remains, both vsock proxies are gone, and per-site ext4 artifacts are removed or accounted for (same bar as the container smoke doc).

### 11. Negative: duplicate name / cancelled grant

- Create two sites in a row without renaming → the second lands as **Untitled 2** (`Untitled 2.anglesite`), no clobber, no error. Also verify an *unregistered* `Untitled.anglesite` folder already sitting in the sites root is skipped the same way.
- (Fresh sandbox state) Cancel the Grant Access panel → the wizard aborts without creating anything; record whether the abort is communicated or silent.

### 12. Negative: unprovisioned runtime messaging

On a build without vendored container artifacts (or with them deliberately removed), opening the site must settle to the failed pane — ⚠️ **"Can't preview Untitled"** with the missing artifacts named, **Retry** and **Show Logs**, and **no host-subprocess fallback** (no host Node/npm processes spawned).

## Exit state for Part 3

"Untitled" open with a ready preview; git log shows the single initial commit.
