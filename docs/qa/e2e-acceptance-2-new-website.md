# E2E Acceptance — Part 2: Create a New Website

**Sequence:** Part 2 of 4 — requires Part 1's exit state (running app, empty launcher).
**Scope:** File ▸ New ▸ Site through a live previewing site window: wizard, scaffold on disk, container boot, first render.

## Purpose

Verify a user can create a `.anglesite` package end-to-end: the wizard collects name/type/look/content, the scaffold lands a complete git-initialized `Source/` **with a real initial commit** (#697), the site registers in recents, and the container runtime boots to a live preview of the owner's homepage without further user action.

## Preconditions

- Part 1 passed. Container artifacts provisioned and build entitled (overview doc) — otherwise every case from 7 on fails by design.
- Test inputs used throughout: site name **"QA Bakery"**, type **business**, a non-default built-in theme, headline **"Fresh bread daily"**, domain choice **"Set this up later"**.

## Acceptance Matrix

| # | Case | Result | Notes |
|---|---|---|---|
| 1 | Wizard entry points |  |  |
| 2 | Wizard steps, labels, validation |  |  |
| 3 | Sandbox grant + save panel defaults |  |  |
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

### 2. Wizard steps, labels, validation

Walk the six steps (fixed ~520×460 sheet; footer **Back / Cancel / Continue**):

- **Details** ("Create a website"): "Website name" field; domain radio group **"Buy a domain"** / **"Transfer an existing domain"** / **"Set this up later"**. Selecting "Set this up later" shows the temporary-domain explanation. Continue is disabled until the name is non-empty and the slug untaken; Transfer additionally requires a valid domain.
  - *Fixed (#703):* the "later" copy now promises a `<slug>.workers.dev` address, matching the actual deploy target. Record the exact copy shown.
- **Type** ("What kind of website are you creating?"): one card per site type; **business** is the default.
- **Look** ("Pick a color scheme"): built-in theme grid plus a **Custom** card (primary/accent colors, "Upload Logo…"). Pick a non-default theme so case 8 can verify it applied.
- **Content** ("First words"): "Homepage headline", optional short description; "Generate hero image…" appears only when Image Playground is available.
- **Save**: leads to the save panel (case 3).
- **Building**: case 4.

Cancel at any pre-build step must dismiss with nothing on disk.

### 3. Sandbox grant + save panel defaults

Expected:

- First creation on a sandboxed build usually does **not** raise a "Grant Access" open panel — the app's own iCloud container needs no such grant. The panel only appears when iCloud is unavailable and the site root falls back to `~/Sites/`; in that case granting proceeds and it must not re-prompt for subsequent sites in the same root.
- The save panel ("Save Your Website", prompt "Save") defaults to the Sites root (the iCloud "Anglesite" folder, or `~/Sites/` if iCloud is unavailable, unless overridden) with filename **`qa-bakery.anglesite`**, and creates the directory if missing.

### 4. Building checklist completes clean

Expected, in order, all check off: created the website file → copied the template → applied your theme → wrote your words → installing → registering → done. On a clean build the wizard dismisses itself and the site window opens.

- Warnings (⚠️ rows, e.g. "git init skipped", "Dependency baseline not saved") keep the wizard open with "…something above needs attention" and an **"Open Website Anyway"** button — record any warning verbatim; a clean run should have none.
- Failures at *create folder*, *copy template*, or *register* are fatal and must roll back the half-written package (verify no orphan `qa-bakery.anglesite` remains after a forced failure, if simulated).

### 5. Package layout + marker on disk

(Substitute your iCloud "Anglesite" folder for `~/Sites/` below if iCloud is available on the test machine.)

Inspect `~/Sites/qa-bakery.anglesite/`:

- `Info.plist` marker with format version 1, a stable site UUID, display name "QA Bakery", created date.
- `Source/` — the Astro project: `package.json` (name `anglesite-site`), `astro.config.ts`, `src/`, `public/`, `scripts/`, `worker/`, `.site-config`.
- `.site-config` contains the wizard answers: `SITE_NAME`, `SITE_TYPE`, `DOMAIN_CHOICE`, `THEME`, `TAGLINE`, and the real `ANGLESITE_VERSION` (not the `1.0.0` placeholder).
- `Config/` exists beside `Source/` with the dependency baseline; `Config/` is **not** inside the git repo.
- Excluded from the copy: `scripts/scaffold.sh`, `scripts/themes.ts`, `*.test.ts`, `integrations/`, `node_modules/`.

### 6. Git repo with initial commit (#697)

In `Source/`:

```sh
git -C ~/Sites/qa-bakery.anglesite/Source log --oneline
git -C ~/Sites/qa-bakery.anglesite/Source status --porcelain
```

Expected:

- Exactly one commit, message **"Initial commit"**, containing the scaffold *after* theme + homepage writes (working tree clean, or nearly — record any uncommitted paths).
- No `.env` / `.env.*` files staged in the commit.
- This is the regression guard for #697: a zero-commit repo makes the container's `git checkout HEAD` hydration fail and the site can never preview.

### 7. Site window opens; dev server auto-boots

Expected without any user action after the wizard:

- The "QA Bakery" window opens (launcher dismisses) and the preview pane enters `.starting`: **"Starting dev server for QA Bakery…"** with a determinate progress bar walking "Starting dev server…" → "Building site…" → "Connecting to preview…", plus an ungated **"Show Logs"** affordance that opens the Debug window.
- Debug logs show the container path: image import, VM boot, guest `git clone` of `Source/`, `npm install`, `astro dev`, MCP sidecar, vsock proxies. Record cold-start wall-clock time (first boot includes `npm install` — minutes is normal; a silent stall in "Building site…" beyond ~10 min is a fail).
- The preview URL is loopback (`http://127.0.0.1:<os-assigned port>`) — never a guest IP.

### 8. Preview renders the owner's homepage

Expected once ready:

- Homepage shows headline **"Fresh bread daily"** (not the template default "Welcome"); the chosen theme's colors are visibly applied.
- `/about` renders the business-profile page; `/blog/` renders the empty state ("No posts yet…" with an RSS link); `/rss.xml` returns a feed.
- The window's subtitle shows the live preview URL.

### 9. Recents, window chrome, Finder behavior

- The site appears in the launcher list (green check), **File ▸ Open Recent**, and the Dock menu.
- Window title is "QA Bakery". Note whether a title-bar proxy icon appears (not currently wired — evidence for #680).
- In Finder the package is a single opaque document ("Anglesite Site"); double-clicking it opens/focuses the site in Anglesite. `cd`, `git`, and an external editor still descend into `Source/` normally.
- Quit and relaunch the app: the last-opened site auto-opens (MRU), skipping the launcher.

### 10. Window close tears down the runtime

Close the site window; within a few seconds no `com.apple.Virtualization` process remains, both vsock proxies are gone, and per-site ext4 artifacts are removed or accounted for (same bar as the container smoke doc).

### 11. Negative: duplicate name / cancelled grant

- Re-run the wizard with the name "QA Bakery" → Details step shows `A site named "qa-bakery" already exists.` and Continue stays disabled.
- (Fresh sandbox state) Cancel the Grant Access panel → the wizard aborts without creating anything; record whether the abort is communicated or silent.

### 12. Negative: unprovisioned runtime messaging

On a build without vendored container artifacts (or with them deliberately removed), opening the site must settle to the failed pane — ⚠️ **"Can't preview QA Bakery"** with the missing artifacts named, **Retry** and **Show Logs**, and **no host-subprocess fallback** (no host Node/npm processes spawned).

## Exit state for Part 3

"QA Bakery" open with a ready preview; git log shows the single initial commit.
