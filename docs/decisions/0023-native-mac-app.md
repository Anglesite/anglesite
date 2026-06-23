---
status: accepted
date: 2026-06-23
decision-makers: [Anglesite maintainers]
---

# Ship a native macOS host (`Anglesite-app`) that embeds — not forks — this plugin

## Context and Problem Statement

The plugin's primary surfaces are Claude Code (developers, CLI) and Claude Cowork (non-technical owners). Cowork users still need a terminal-free, click-to-edit experience: open a site, click a headline, change it, drag in an image, deploy with one button — without learning the CLI. A native app can provide that, but only if it does **not** fork the plugin: the scaffolding, skills, hooks, security scans, and MCP server must stay single-sourced here so the app and the CLI never diverge.

The design was explored in `docs/dev/mac-app-design.md` (originally "Draft / exploration") and has since shipped as a separate repository, `Anglesite/Anglesite-app`. This ADR ratifies that decision and records the contract the two repos share.

## Decision

Maintain a native macOS application, `Anglesite/Anglesite-app`, as a **host** for this plugin, not a replacement for it:

1. **Embed, don't fork.** The app pulls the marketplace plugin at runtime and stamps its origin commit (`Resources/plugin/.bundled-from-commit`). All edits, deploys, and skills flow through the same skills, hooks, and MCP server the CLI uses. Skill development stays in this repo.
2. **The plugin owns the wire contract.** The app's WKWebView edit overlay and on-device tooling speak to the plugin's MCP server. The `ElementInfo` payload, the `apply_edit` op enum (`replace-text`, `replace-attr`, `replace-image-src`, `edit-style`), and the `edit-applied` / `edit-failed` / `edit-preview` responses are defined here (`server/apply-edit-schema.mjs`); the app mirrors them. Schema changes are made plugin-side first.
3. **Transport-agnostic server.** `server/index-tools.mjs` registers the tool set against a `projectRoot` and connects over stdio (default) or a Streamable HTTP transport (`server/http-server.mjs`, selected via `ANGLESITE_MCP_TRANSPORT=http`) so the app can run the server embedded or in a container runtime.
4. **The shipped runtime is the contract too.** The app vendors a specific Node (`scripts/node-version.txt`) to execute `server/*.mjs`; the plugin's CI test matrix tracks that version so the interpreter we ship is exercised here (see issue #378).
5. **Owner controls everything still holds (ADR-0011).** Sites are real files on disk; an owner can leave the app and keep working in Finder, VS Code, or the CLI at any time. The four mandatory pre-deploy scans (ADR-0007) still run and still block.

## Decision Drivers

* Terminal-free editing for Cowork-style owners without a second codebase to maintain
* Single source of truth — one plugin, one set of skills/hooks/scans, mirrored by the app
* No lock-in — the app is a client over real files, never the only way to edit a site (ADR-0011)
* A stable, plugin-owned MCP contract the app can build against

## Consequences

* **Good:** non-technical owners get a polished GUI while developers keep the CLI; both ride the same machinery.
* **Good:** the MCP server, edit pipeline, and content tools have a real second consumer, which keeps the wire contract honest.
* **Neutral:** the plugin now carries a cross-repo coupling — the MCP schema, the readiness/transport env vars, and the Node version are a public contract with the app, so changes need coordination (tracked as doc hygiene in issue #380).
* **Bad / limits:** v1 is Mac-only; Windows/Linux owners stay on Cowork/CLI. The app is maintained in a separate repo, so a schema change here can break it until the app re-bundles.

See `docs/dev/mac-app-design.md` for the full design (goals, edit pipeline, agent routing).
