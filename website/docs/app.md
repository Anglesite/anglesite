# Pairadocs Farm App

Julia has **Pairadocs Farm.app** in `/Applications/` and in her Dock. When she clicks it, it shows a task menu with nine actions.

## How it works

The app is a macOS `.app` bundle containing a shell script launcher. On launch:

1. **Already in `/Applications/`?** If not, copies itself there and relaunches.
2. **Project exists in iCloud Drive?** If not, copies the template from `Resources/project/` inside the app bundle.
3. **First run?** (No `node_modules.nosync/`) Shows setup instructions and opens the project folder in Finder. Julia then opens it in Claude Desktop's Code tab and types `/setup`.
4. **Normal launch:** Delegates to `scripts/farm.sh` which shows the task menu.

The project lives at:
```
~/Library/Mobile Documents/com~apple~CloudDocs/Pairadocs Farm/
```
Finder shows this as **iCloud Drive → Pairadocs Farm**. It syncs automatically to all Macs on the same iCloud account.

## iCloud and .nosync

Heavy directories that shouldn't sync use `.nosync` suffixes with symlinks:

| What npm/Astro sees | Actual directory (iCloud ignores) |
|---|---|
| `node_modules/` (symlink) | `node_modules.nosync/` |
| `dist/` (symlink) | `dist.nosync/` |
| `.astro/` (symlink) | `.astro.nosync/` |
| `.wrangler/` (symlink) | `.wrangler.nosync/` |

`scripts/setup.sh` creates these. If they break (e.g., after a git operation), run setup.sh again.

## The task menu

### 🌱 Start Local Server
Starts the dev server at `localhost:4321`. If already running, just opens the browser.

### 🛑 Stop Local Server
Stops the dev server on port 4321.

### ✏️ Edit Posts
Opens the Keystatic blog editor. Starts the dev server first if needed.

### 📤 Publish to Farm
Builds, deploys to Cloudflare via Wrangler, commits locally. Won't push broken code.

### 🔍 Check Farm Site
Runs TypeScript check and build. Shows pass/fail notification.

### 📊 View Analytics
Opens Cloudflare Web Analytics dashboard.

### 🗂️ Open Airtable
Opens the CSA base in Airtable. Reads URL from `.farm-config`. If not set up, shows instructions to run `/setup-airtable` in Claude.

### 🌐 View Live Website
Opens https://www.pairadocs.farm.

### 🤖 Chat with Webmaster
Opens the project folder in Finder and shows instructions for opening it in Claude Desktop's Code tab.

## Config file

`scripts/farm.sh` reads settings from `.farm-config` in the project root. Simple key=value format, committed to git (site config, not secrets):

```
PROJECT_DIR=/Users/julia/Library/Mobile Documents/com~apple~CloudDocs/Pairadocs Farm
AIRTABLE_BASE_URL=https://airtable.com/appXXXXXXXXXXXXXX
```

| Key | Written by | Used by |
|---|---|---|
| `PROJECT_DIR` | `scripts/setup.sh`, auto-updated by `farm.sh` | `/fix`, reference |
| `AIRTABLE_BASE_URL` | `/setup-airtable` | 🗂️ Open Airtable |

## Logs

- `~/.pairadocs/logs/build.log` — build failures
- `~/.pairadocs/logs/deploy.log` — deploy failures
- `~/.pairadocs/logs/check.log` — check failures
- `~/.pairadocs/logs/dev.log` — dev server output
- `~/.pairadocs/logs/setup.log` — setup script output
