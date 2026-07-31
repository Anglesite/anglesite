# E2E Acceptance — Part 1: Initial Launch

**Sequence:** Part 1 of 4 — see [e2e-acceptance-overview.md](e2e-acceptance-overview.md) for shared preconditions and the fresh-state reset.
**Scope:** what a user experiences the very first time Anglesite launches: no recents, no bookmarks, no credentials, no sites.

## Purpose

Verify the first-run experience is the empty Sites launcher — no onboarding gates, no permission dialogs, no background provisioning — with every site-scoped command correctly disabled and sensible Settings defaults.

## Preconditions

- Fresh-state reset performed (overview doc).
- Build launched normally (Finder/Xcode Run), not from a state-restoring session.

## Acceptance Matrix

| # | Case | Result | Notes |
|---|---|---|---|
| 1 | Launcher window with empty state |  |  |
| 2 | No onboarding or permission dialogs |  |  |
| 3 | Menu enablement with no site open |  |  |
| 4 | Open Recent and Dock menu empty states |  |  |
| 5 | Settings defaults |  |  |
| 6 | Siri AI readiness tab |  |  |
| 7 | No eager state or provisioning on disk |  |  |
| 8 | Launcher error/drop affordances |  |  |

## Test Cases

### 1. Launcher window with empty state

Launch the app.

Expected:

- Exactly one window opens: **"Sites"** (the launcher). No site window, no debug window.
- Header: bold **"Sites"** title plus a borderless reload button (help text "Reload site list").
- Empty state: `tray` symbol, headline **"No Anglesite sites found"**, body copy directing to **Add Site → Create new site…** / **Add Site → Import existing site…**.
- Footer: an **"Add Site"** menu with exactly two items: **"Create new site…"** and **"Import existing site…"**.
- No auto-open of any site (fresh install has no `lastOpenedSiteID`).

Fail if a site window opens, the launcher shows a stale list, or the window appears blank for more than a moment (the "deciding" state must resolve).

### 2. No onboarding or permission dialogs

Observe the first 60 seconds after launch, then open Notification Center settings.

Expected:

- No welcome/onboarding/tour modal, no EULA, no sign-in gate.
- **No notification permission prompt** — authorization is provisional and lazy (`CompletionNotifier`); it must never raise the system alert, at launch or later.
- No container image/kernel provisioning UI or download activity at launch (runtime resolution is lazy, at site-open).

Fail if any modal or system permission dialog appears before the user takes an action.

### 3. Menu enablement with no site open

Walk the menu bar with only the launcher open.

Expected:

- **File ▸ New ▸ Site** enabled (⇧⌘N). **New ▸ Page…** (⌘N), **Collection…**, **Post…**, **Component…** all disabled.
- **File ▸ Open Site…** (⌘O) enabled; picking a non-package shows the "Couldn't open that site" alert.
- **File ▸ Export Site Source…** disabled. **File ▸ Print…** inert.
- **Site menu**: every item (Deploy ⇧⌘D, Recheck Deploy Readiness, Backup, Audit, Harden…, Domain…, Add Integration…, Siri AI Readiness…, dev-server controls, Open in Browser) disabled.
- **View**: pane switches ⌘1–3, Chat ⌘K, Inspector ⌥⌘I inert; **"Show Debug Pane" (⌥⌘D) not visible** in a Release build until the Settings ▸ Advanced diagnostics toggle is on (visible by default in Debug builds).
- **App menu ▸ About Anglesite** shows the custom panel with the `Phase <n> · macOS <version>` credits line.

Fail if any site-scoped command is enabled with no site window focused.

### 4. Open Recent and Dock menu empty states

Expected:

- **File ▸ Open Recent** shows a single disabled **"No Recent Sites"** item, with **"Import Site…"** below the divider (enabled).
- The Dock icon's context menu shows only **"New Site"** (no recents). Selecting it activates the app and presents the New Site wizard on the launcher.

### 5. Settings defaults

Open Settings (⌘,).

Expected — fixed-size window with three tabs:

- **General**: "Auto-generate alt text for dropped images" **ON**; "Auto-suggest descriptions for new pages and posts" **ON**; "Notify when site operations finish" **ON**; "Play dial-up sound while loading" **OFF**; "Announce live updates to VoiceOver" **ON**.
- **Advanced**: plugin path override empty (placeholder "(use bundled plugin)"); Sites root empty (placeholder for the iCloud "Anglesite" folder, or `~/Sites/` if iCloud is unavailable on the test machine); Credentials section shows the Cloudflare API token row with **no stored token**; "Show Debug Pane menu item" **OFF**; LAN runtime section hidden in Release (no diagnostics opt-in yet).
- No runtime-selection toggle exists anywhere (runtime choice is automatic).

Fail if any default differs or a credential appears pre-populated after the fresh-state reset.

### 6. Siri AI readiness tab

Open Settings ▸ **Siri AI**.

Expected:

- An initial check runs on appear; rows for macOS runtime, App Intents registration, View annotations, Apple Foundation Models, System MCP bridge, each with a status color and remediation text where applicable (e.g. "Apple Intelligence is turned off" → System Settings pointer).
- A **"Re-check"** button and last-checked timestamp.
- Warnings here (e.g. Apple Intelligence off) do **not** block anything else in this run.

### 7. No eager state or provisioning on disk

After a few minutes idle, inspect the app container.

Expected:

- `recents.json` either absent or an empty list — no scan of `~/Sites/` happened (registry is authoritative, not a folder scan).
- No container ext4/rootfs artifacts unpacked, no `com.apple.Virtualization` process running.

### 8. Launcher error/drop affordances

- Drag a valid `.anglesite` package from Finder onto the launcher list → it registers and its window opens (this seeds Part 2's "existing site" negative checks; use a throwaway package or defer to after Part 2).
- Drag a non-package folder → ignored, no crash.
- (If simulable) a corrupted `recents.json` shows the "Couldn't load sites" error state with a working **Retry**.

## Exit state for Part 2

The app is running with the empty launcher visible; Settings untouched apart from inspection; no sites registered (re-do the reset if case 8 registered a throwaway).
