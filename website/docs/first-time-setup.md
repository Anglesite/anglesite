# First-Time Setup

The Pairadocs Farm app handles first-run detection automatically. When Julia double-clicks the app:

1. App copies itself to `/Applications/` (asks permission first)
2. App copies the project template to iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/Pairadocs Farm/`)
3. App detects no `node_modules` → shows setup instructions and opens the project folder in Finder

Julia then opens the project in Claude Desktop's Code tab and types `/setup`.

## Three phases

### Phase 1: `/setup` — Technical bootstrap (~15 minutes)
Tools (fnm, Node, Git), Cloudflare account + Pages project, first deploy, Dock setup. Account creation happens just-in-time — Cloudflare when deploying, Airtable when `/setup-airtable` runs.

### Phase 2: `/design-interview` — Visual identity (~15–20 minutes)
Conversational intake. Results saved to `docs/brand.md`. CSS updated. Can happen same day or later.

### Phase 3: `/setup-airtable` — CSA membership (optional, ~10 minutes)
Creates Airtable account (if needed), base with Members, Items, Preferences, Forms. Can happen anytime.

## Detection

The webmaster can detect state by checking:
- No `node_modules.nosync/` → need `/setup`
- No `docs/brand.md` → need `/design-interview`
- Airtable MCP not connected (check `/mcp`) or no `AIRTABLE_BASE_URL` in `.farm-config` → need `/setup-airtable`

## Gatekeeper

The first time Julia opens the app from a zip download, macOS will block it. She needs to:
1. Right-click **Pairadocs Farm.app** → **Open**
2. Click **Open** in the dialog

This only happens once. The `Getting Started.txt` file in the zip explains this.
