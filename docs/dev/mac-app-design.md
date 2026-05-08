# Anglesite Mac App — High-Level Design

**Status:** Draft / exploration
**Branch:** `claude/anglesite-gui-exploration-SqJjG`
**Audience:** Plugin maintainers and contributors evaluating a native GUI on top of Anglesite.

## 1. Summary

A native macOS application that wraps the existing Anglesite Claude plugin and gives non-technical site owners a polished, click-to-edit experience for their website. The app does not replace the plugin — it embeds it. All scaffolding, edits, deploys, and skills continue to flow through the same skills, hooks, and MCP server that Claude Code uses today; the Mac app is a custom **host** for that machinery with native UI affordances on top.

The headline feature is **live in-place editing**: the owner clicks any text or image in a live preview of their site and changes it. Trivial edits round-trip through a local source patcher; anything more substantive (layout, new pages, design changes) routes to Claude via the Agent SDK using the same skills the CLI exposes.

## 2. Goals

- Owner can open a site, see it rendered, click a headline, change it, and watch the page hot-reload — in under five seconds, with no terminal.
- Owner can drag an image from Photos or Finder onto a hero element and have it optimized, written to `public/`, and committed.
- Owner can deploy with one button. The four mandatory pre-deploy scans (PII, tokens, third-party scripts, Keystatic admin) still run and still block on failure.
- Owner can ask Claude to do anything more complex ("add a contact form," "make the hero darker," "import my old Wix site") via an inline chat that streams the agent's progress.
- Plugin developers continue to ship one plugin. The Mac app pulls the marketplace plugin at runtime; it does not fork it.

## 3. Non-goals

- **Cross-platform.** v1 is Mac-only. Tauri/Electron ports are welcome from the community but not maintained by this project.
- **Replacing Claude Code.** Power users keep using the CLI. The Mac app targets Cowork-style users.
- **Becoming an IDE.** No code editor, no terminal, no file tree as the primary surface. Files are an implementation detail.
- **Hosting service.** The app is a desktop client. Deploys still go to the owner's Cloudflare account from their machine.
- **Authoring the plugin from inside the app.** Skill development stays in the plugin repo, not the app.

## 4. Target users

Same as the plugin's `cowork` audience: small business owners with no technical background. They are comfortable with Mac apps (Mail, Photos, Pages) and uncomfortable with terminals. They own one site, occasionally two.

A secondary audience is **plugin developers** who want a faster preview loop than `npm run dev` + browser dev tools when iterating on template changes. The app's debug mode exposes the underlying Astro logs and MCP traffic.

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Anglesite.app  (SwiftUI)                                        │
│                                                                  │
│  ┌─────────────┐   ┌──────────────────────┐   ┌──────────────┐   │
│  │  Sidebar    │   │  WKWebView preview   │   │  Chat panel  │   │
│  │  (sites)    │   │  (Astro dev server)  │   │  (Agent SDK) │   │
│  │             │   │   + toolbar overlay  │   │              │   │
│  └─────────────┘   └──────────┬───────────┘   └──────┬───────┘   │
│                               │ WKScriptMessageHandler│           │
│                               ▼                       ▼           │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Swift bridge layer                                      │    │
│  │  • spawns / supervises subprocesses                      │    │
│  │  • routes edit + chat messages                           │    │
│  │  • Keychain, file pickers, drag-drop, notifications      │    │
│  └────┬──────────────┬──────────────┬──────────────┬────────┘    │
│       │              │              │              │             │
│       ▼              ▼              ▼              ▼             │
│  ┌────────┐    ┌──────────┐    ┌──────────┐   ┌──────────┐       │
│  │ astro  │    │  MCP     │    │  Claude  │   │ wrangler │       │
│  │  dev   │    │  server  │    │  Agent   │   │   gh     │       │
│  │        │    │ (stdio)  │    │   SDK    │   │  (cli)   │       │
│  └────────┘    └──────────┘    └──────────┘   └──────────┘       │
└──────────────────────────────────────────────────────────────────┘
       site project on disk: ~/Sites/<name>/  (real files, git-backed)
```

Five layers, each with one job.

### 5.1 SwiftUI shell

Sidebar of projects, main split view (preview + chat), menu bar, settings. Standard AppKit/SwiftUI. Owns all native UX: file pickers, drag-drop, Keychain, notifications, auto-update prompts.

### 5.2 WKWebView preview

Loads `http://localhost:<port>` from the embedded Astro dev server. The existing `template/src/integrations/anglesite-toolbar.ts` toolbar app is detected and a thin "edit mode" layer is injected on top of it: hovering an element shows handles, clicking a text node makes it `contentEditable`, dropping a file onto an `<img>` triggers an upload. All interactions are posted to the Swift side via `WKScriptMessageHandler`.

The toolbar's existing sticky-note flow is preserved unchanged — owner can still pin a note ("change this copy to be punchier") and it surfaces in the chat panel for Claude.

### 5.3 Subprocess layer

The Swift app spawns and supervises:

- **Astro dev server** (`node_modules/.bin/astro dev`) per active site. Logs streamed into a debug pane. Restarted on config changes.
- **MCP annotation server** (`node server/index.mjs` from the plugin) — same code as today, talked to over stdio. Extended message types (see §6) handle edits in addition to annotations.
- **Claude agent** via the Agent SDK. Two viable paths: (a) a Swift wrapper around `claude --agent` as a subprocess, parsing stream-json; (b) calling the Anthropic API directly with the plugin's skills loaded as tools. Path (a) is preferred for v0 because it inherits the plugin's skill registry, hooks, and permission model for free.
- **One-shot CLIs**: `wrangler deploy`, `gh`, `npm install`. Surfaced as native buttons; output streamed to a transient drawer.

### 5.4 MCP server (existing, extended)

Today the server in `server/*.mjs` handles three messages: `add-annotation`, `list-annotations`, `resolve-annotation`. We add an edit family:

- `anglesite:apply-edit { path, selector, op, value }` — patch a text node, attribute, or image src.
- `anglesite:edit-applied { id, path, before, after }` — confirmation back to the client.
- `anglesite:edit-failed { id, reason }` — selector didn't resolve, file is dirty in git, etc.

Source-patching logic lives in a new `server/patcher.mjs` (see §6).

### 5.5 Site project on disk

Sites live in `~/Sites/<name>/`. Real directories, real files, real git history. The app does not abstract the filesystem away — owners can open a site in Finder, in VS Code, or in Claude Code CLI and continue working without the app. This is a deliberate constraint: the app must never become the only way to edit a site.

## 6. Live edit pipeline

The defining feature. Flow for a typical "change this headline" edit:

1. User clicks an `<h1>` in the preview. The injected edit layer marks it `contentEditable=true` and records its CSS selector via the existing `server/selector.mjs` logic.
2. User types. On blur (or after a debounce), the edit layer posts `{type: "apply-edit", path: "/about", selector: "main > h1:nth-of-type(1)", op: "replaceText", value: "..."}` to Swift.
3. Swift forwards the message to the MCP server over stdio.
4. `server/patcher.mjs` resolves `path + selector` → source file + AST node. Three resolvers, tried in order:
   - **`.mdoc` content** — selector → frontmatter field or markdoc node. Preferred path; safest because Markdoc has a real AST and edits are unambiguous.
   - **`.astro` static text** — selector → string literal in template. Uses the Astro compiler's AST, only patches when the node is a static text child (no expressions, no slots). Refuses ambiguous matches.
   - **Keystatic schema field** — selector points at a schema-driven region (e.g. `siteSettings.tagline`). Edit goes through Keystatic's data layer, not raw file rewriting.
5. Patcher writes the file. Astro's HMR reloads the page. WKWebView reflects the change in ~200ms.
6. `edit-applied` flows back to the chat panel as a small "✓ updated About → headline" line, with an undo affordance.

**Out-of-band edits get bounced to Claude.** If the patcher can't safely resolve the selector (e.g. the user clicks something inside an Astro component with dynamic children), the edit is converted into a chat message (`"Change the headline on /about from X to Y"`) and routed to the agent. The user sees the same UX; only the implementation path differs. This is the escape hatch that makes the simple-patcher approach safe — when in doubt, Claude does it.

**Image drops** follow the same pattern but call into the existing `optimize-images` skill (resize, WebP, EXIF strip) before writing to `public/` and patching the `src=` attribute.

**Undo.** Every edit is a git commit on a hidden `anglesite/edits` branch with a short auto-message. Undo = `git revert` of the last commit on that branch. The owner-visible commit history (on `main`) is curated; the edit branch is the audit trail.

## 7. Claude / Agent SDK integration

The chat panel is the universal escape hatch for anything that isn't a direct in-place edit:

- "Add a testimonials section to the homepage."
- "My site looks too corporate, make it warmer."
- "Import the menu from this PDF."
- Sticky notes pinned via the toolbar arrive here too.

Implementation: the app spawns `claude` with the Anglesite plugin loaded (`--plugin-dir <bundled-or-marketplace-copy>`) and the current site as the working directory. Stream-json output is parsed and rendered as Markdown in the chat panel. Tool calls render as collapsible cards ("Reading `src/pages/index.astro`…"). Permission prompts surface as native sheets.

The skills already exist — `start`, `deploy`, `import`, `convert`, etc. The app exposes the user-facing ones as **buttons** (Deploy, Backup, Import…) that, when clicked, send the corresponding `/anglesite:<skill>` invocation into the chat. Buttons and chat are the same control surface; buttons are just shortcuts.

**Plugin sourcing.** The app bundles a known-good copy of the plugin and checks the marketplace for updates on launch. Owner can pin a version. Plugin developers building locally can point the app at a working copy via `Settings → Advanced → Plugin path`.

## 8. Project and site management

- **Sidebar** lists all sites the app knows about, plus an "Add site…" entry.
- **New site** runs `/anglesite:start` in a new directory under `~/Sites/`. The discovery interview happens in the chat panel; the owner sees the preview build out as they answer.
- **Open existing** picks a directory. The app validates that it looks like an Anglesite project (presence of `.site-config`, `astro.config.ts`, etc.) and offers to run `/anglesite:check` if anything looks off.
- **Multi-site.** v1 supports multiple sites, one preview at a time. v0 supports exactly one. Switching sites stops the previous Astro dev server and starts the new one.
- **Health badge** per site uses `/anglesite:check` output: green / yellow / red dot in the sidebar.

## 9. Authentication & secrets

- **Cloudflare API token** stored in Keychain. Surfaced once during deploy setup; reused for every deploy thereafter. `wrangler` reads it from the env when the app shells out.
- **GitHub** uses `gh` device-code OAuth as today. The app drives the flow but `gh` owns the token.
- **Site-level secrets** (Stripe keys, etc.) stay in `wrangler secret put` land — the app never sees them.

The deploy hook (`scripts/pre-deploy-check.sh`) and its four mandatory scans run unchanged. The app cannot bypass them; if a scan fails, the deploy button shows the failure inline with the remediation steps.

## 10. Distribution

- **Build:** Xcode + Swift Package Manager. Embedded Node runtime via a notarized framework (we ship Node, we don't depend on the user having it — this is non-negotiable for the target audience).
- **Sign and notarize** with a Developer ID certificate. Signed `.dmg` distributed from anglesite.dev.
- **Auto-update** via Sparkle, signed appcast.
- **Mac App Store** considered for v2 once the sandboxing implications of spawning Node and `wrangler` are worked out. Direct distribution first.
- **Telemetry:** none by default. Opt-in crash reports only.

Bundle size target: under 200 MB including Node, Astro, and a primed `node_modules` cache. New sites do their own `npm install` against the cache, so initial scaffold is fast.

## 11. Risks and open questions

| Risk | Mitigation |
|---|---|
| Embedded Node + Astro dev server is heavy and flaky inside an `.app` sandbox | v0 uses a non-sandboxed Developer-ID build; investigate sandbox + helper-tool architecture for App Store later |
| Source patcher resolves a selector wrong and corrupts a file | Every edit commits to a hidden branch; undo is one click; ambiguous selectors bounce to Claude |
| Plugin version drift between bundled copy and marketplace | Check on launch, prompt to update, allow pinning, surface the active version in Settings |
| Agent SDK Swift integration is immature | v0 shells out to `claude` and parses stream-json; Swift bindings can come later |
| Owner edits in Finder / VS Code while the app is running | File watcher reconciles; preview hot-reloads; chat shows a small "external change detected" notice |
| Cloudflare deploy failures are opaque to non-technical users | `wrangler` output is filtered through a known-error mapper that translates common failures into plain language |
| Performance of `contentEditable` selectors on heavily componentized pages | Patcher refuses unsafe matches and routes to Claude instead — better to be slow and correct than fast and wrong |

**Open questions** to resolve before v0 starts:

- **Single-window vs document-based?** Document-based feels right (one window per site), but multi-site sidebar argues for single-window. Probably single-window with tabs.
- **Where does the chat history live?** Per-site, in the project? Per-app, in `~/Library/Application Support/`? Probably per-site so it travels with the project (and ends up in the GitHub backup).
- **How does the app handle a site whose `.site-config` was made by a newer plugin version?** Refuse to open, or open read-only, or prompt to upgrade?
- **What's the story for sites currently being edited via Cowork in a browser?** The app should detect that Cowork is the source of truth and either defer or warn.
- **Do we ship a CLI alongside the app?** Owners will eventually want `anglesite open ~/Sites/foo` from the dock or Spotlight. Probably yes, as a small launcher binary.

## 12. Milestones

**v0 — "Open, edit, deploy"** (single site, no chat)
- Sidebar with one site, embedded Astro dev server, WKWebView preview.
- Edit-in-place for `.mdoc` text fields and `<img>` src attributes.
- One-click deploy with the existing pre-deploy hook.
- Notarized `.dmg`, no auto-update yet.

**v0.5 — "Ask Claude"**
- Chat panel wired to `claude` subprocess with the Anglesite plugin loaded.
- Sticky notes from the existing toolbar route into chat.
- Skill buttons for Deploy, Backup, Check, Import.
- Sparkle auto-update.

**v1 — "Multiple sites"**
- Sidebar supports N sites, switching, health badges.
- Drag-drop image flow with `optimize-images` skill.
- Keychain for Cloudflare token.
- Undo via hidden edit branch.

**v2 — "Polish"**
- Mac App Store build (sandboxed).
- Quick Look extension for site projects.
- Spotlight metadata.
- Theme picker, model picker, plugin-path override surfaced in Settings.

## 13. What this design explicitly does not commit to

- A specific Swift architecture pattern (MVVM vs TCA vs plain SwiftUI). v0 should pick the simplest path that works.
- A specific Markdoc/Astro AST library. The patcher is a single module; it can be rewritten if the first choice doesn't hold up.
- Whether the bundled Node is `node` or `bun`. Whichever notarizes cleanly and runs Astro fastest.
- Cross-platform parity. Linux/Windows ports are welcome from the community; the maintainers commit to keeping the plugin and MCP server portable, but not the app.

## 14. Relationship to existing ADRs

The Mac app does not invalidate any ADR in `docs/decisions/`. Astro (ADR-0001), Keystatic (ADR-0002), Cloudflare Workers (ADR-0003), pre-deploy scans (ADR-0007), no-third-party-JS (ADR-0008), GitHub backup (ADR-0013), and owner-controls-everything (ADR-0011) all carry over unchanged. The app is a host for the same architecture, not a replacement for it.

If this design ships, it should be ratified as a new ADR (`0020-native-mac-app.md`) summarizing §1–§3 and pointing at this document for the details.
