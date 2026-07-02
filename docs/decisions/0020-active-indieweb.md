---
status: accepted
date: 2026-06-09
decision-makers: [Anglesite maintainers]
---

# Run active IndieWeb endpoints on the owner's own domain via `@dwk/*` workers

## Context and Problem Statement

Anglesite already ships the **passive** IndieWeb: microformats (`h-card`, `h-entry`, `h-feed`), `rel="me"`, RSS, and the POSSE workflow (ADR-0006). These are static HTML — they need no server.

The **active** IndieWeb requires live HTTP endpoints: IndieAuth (sign in to other services with your domain; issue tokens), Webmention (receive cross-site mentions/replies), and Micropub (publish from third-party clients). Today `template/docs/indieweb.md` points owners at third-party hosts (webmention.io, indieauth.com delegation) or a vague "build a Worker yourself." Both undercut Anglesite's core promise that the owner controls everything (ADR-0011): delegation puts the owner's identity behind someone else's service, and "build it yourself" isn't a path a non-technical owner can take.

The [`davidwkeith/workers`](https://github.com/davidwkeith/workers) project publishes the `@dwk/*` packages — each an open-standard implementation as a composable, `fetch`-compatible Cloudflare Worker handler designed to deploy to the owner's **own** account. They are the missing self-owned option. We need to decide how Anglesite integrates them.

## Decision Drivers

* Owner controls everything — identity, tokens, and data stay on infrastructure the owner owns (ADR-0011)
* Identity is HTTPS-rooted at the owner's primary domain — the endpoints must be served from that domain, not a third party or a `*.workers.dev` subdomain
* Static-site compatibility — Anglesite builds static HTML; the active endpoints must coexist with that, not replace it
* Cloudflare-native — reuse the existing Worker, bindings, and deploy path (ADR-0003)
* Non-technical owner — a skill must do the wiring; the owner shouldn't hand-edit `wrangler.toml`
* No new always-on cost or third-party dependency

## Considered Options

* Compose the `@dwk/*` endpoint handlers into the site's existing `site-entry.js` Worker, rooted at the primary domain
* A separate dedicated Worker attached to the domain via Cloudflare routes
* Keep delegating to third-party hosts (webmention.io, indieauth.com)
* Build bespoke endpoint logic inside Anglesite

## Decision Outcome

Chosen option: **compose the `@dwk/*` endpoint handlers into `site-entry.js`**, because identity must be rooted at the owner's primary domain and `site-entry.js` is the Worker already bound to it. `site-entry.js` is already a composition root — it layers membership, A/B, and consent middleware ahead of the static `ASSETS` fetch — so mounting the IndieWeb handlers on path prefixes ahead of the same fallthrough follows an established pattern rather than inventing one. The first integration cohort is the endpoint trio: `@dwk/indieauth`, `@dwk/webmention`, `@dwk/micropub`.

### Architecture

> **Update (2026-06-21):** reconciled with the shipped `@dwk/*` `0.1.0-beta.3`
> API. The Webmention slice changed: the binding is `WEBMENTION_INBOX` (not
> `WEBMENTION_DB`), the queue consumer is a separate `createWebmentionQueueConsumer`
> factory (the handler has no `.queue`/`.scheduled`), `baseUrl` comes from a
> `SITE_URL` var, and the inbox stores only `{ source, target, verified_at }` — so
> the display (item 5) is a minimal source-link list, not rich `h-cite` cards. See
> `docs/superpowers/specs/2026-06-21-webmention-realignment-design.md`. IndieAuth
> and Micropub realignment (incl. the `approveAuthorization` passkey mechanism)
> are tracked separately.

1. **Composition:** `site-entry.js` mounts the three factory handlers ahead of `env.ASSETS.fetch()`, each gated on the presence of its Cloudflare binding (`AUTH_DB`, `MICROPUB_DB`, `WEBMENTION_DB`). A site that hasn't enabled the feature serves identically to before.
2. **Bindings:** D1 for IndieAuth codes/tokens, Micropub posts + DPoP replay, and the Webmention inbox; R2 for the Micropub media endpoint; a Queue for async Webmention verification; secrets for token signing and the bridge's GitHub token. Provisioned MCP-first (`mcp__cloudflare__*`), wrangler fallback.
3. **Discovery:** conditional `<link>` tags (`indieauth-metadata`, `authorization_endpoint`, `token_endpoint`, `micropub`, `webmention`) in `BaseLayout.astro`.
4. **Micropub → static content:** `@dwk/micropub` storage is D1-only and not pluggable, so created posts are bridged into first-class Keystatic content — a worker bridge materializes new D1 records into `.mdoc` files in a `notes` collection, commits them via the GitHub API, and a **GitHub Actions deploy workflow** rebuilds the static site. A note is queryable instantly (`q=source` reads D1) and publicly visible after the rebuild.
5. **Webmention display:** received mentions are edge-rendered into target pages with `HTMLRewriter` — no client JS, always current.
6. **Distribution gate:** the `@dwk/*` packages are unpublished (`0.0.0`); the skill installs from npm and stops gracefully until they ship.

> **Update (2026-07-01):** the `@dwk/*` packages are now published (`0.1.0-beta.2`+). The distribution gate in item 6 no longer blocks — the skill's Step 1 import-smoke-test (see `skills/indieweb/SKILL.md`) now runs against a live, loadable package set rather than stopping at "not yet published."

### Consequences

* Good, because the owner's identity, tokens, and data live only on their own Cloudflare account — no third-party identity host
* Good, because it reuses the existing Worker, bindings, and deploy path; one Worker, one domain, one deploy
* Good, because per-binding gating means the feature is invisible until enabled and degrades safely if partially configured
* Good, because Micropub posts become real Keystatic content the owner can edit like any other page
* Bad, because the Micropub publish loop is eventually consistent — a new note is live only after a rebuild (~1–2 min)
* Bad, because it requires a fine-grained GitHub token in the Worker for the bridge, and a CI deploy path the template didn't previously have
* Bad, because it is gated on an external project publishing to npm
* Neutral, because Micropub mandates DPoP on every request — secure, but bearer-only clients (including micropub.rocks' default flow) cannot authenticate

### Confirmation

The endpoints are set up by the `/anglesite:indieweb` skill. Per-standard conformance (webmention.rocks, micropub.rocks, IndieAuth interop) remains the `@dwk/*` packages' responsibility. `/anglesite:deploy`'s scans treat `/auth`, `/micropub`, `/media`, and `/webmention` as intentional public endpoints and confirm the signing key and GitHub token are secret bindings, never committed to source.

## Pros and Cons of the Options

### Compose into `site-entry.js` (chosen)

* Good, because the endpoints are served from the identity-rooting primary domain
* Good, because it extends the existing composition-root pattern
* Good, because a single deploy ships the site and its endpoints together
* Neutral, because Wrangler's bundler must pull the `@dwk/*` npm deps into the Worker (it does this automatically)

### Separate Worker + Cloudflare routes

* Good, because stronger isolation between the static site and the endpoints
* Bad, because it needs custom domain routes and risks colliding with the site Worker's catch-all
* Bad, because two Workers, two deploys, two configs to keep in sync

### Delegate to third-party hosts

* Good, because zero infrastructure for the owner
* Bad, because identity and data leave the owner's control — contradicts ADR-0011
* Bad, because the owner depends on a third party staying up and honest

### Bespoke endpoint logic in Anglesite

* Good, because no external dependency
* Bad, because re-implementing IndieAuth/Webmention/Micropub (PKCE, DPoP, async verification, conformance) is a large, security-sensitive surface better solved by a dedicated, conformance-tested project

## More Information

Design spec: `docs/superpowers/specs/2026-06-09-active-indieweb-design.md`. Integration guide: `docs/platforms/dwk-workers.md`. Tracking: Anglesite issue #339.
