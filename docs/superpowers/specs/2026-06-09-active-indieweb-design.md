  # Design: Active IndieWeb endpoints via `@dwk/*` workers

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan
**Topic:** Add a `/anglesite:indieweb` skill that deploys the IndieWeb endpoint
trio (`@dwk/indieauth`, `@dwk/webmention`, `@dwk/micropub`) from
[`davidwkeith/workers`](https://github.com/davidwkeith/workers) into an Anglesite
site, rooted at the owner's primary domain.

---

## 1. Goal

Anglesite already ships the **passive / static** IndieWeb: microformats
(`h-card`, `h-entry`, `h-feed`), `rel="me"`, RSS, and the POSSE workflow
(`template/docs/indieweb.md`, ADR-0006). This adds the **active** IndieWeb — live
HTTP endpoints that require server-side compute:

- **IndieAuth** — sign in to other IndieWeb services *with your own domain*;
  issue the DPoP-bound access tokens Micropub consumes.
- **Webmention** — receive (and send) cross-site mentions / replies / likes.
- **Micropub** — publish to your own site from third-party Micropub clients.

These are delivered by the `@dwk/*` packages, which are composable
`fetch`-compatible Worker handlers designed to deploy to the owner's **own**
Cloudflare account. The `workers` repo names Anglesite as "the first consumer."

**Non-goals (this spec):** the rest of the `@dwk` cohort — Microsub, WebSub,
WebFinger, host-meta, `did:web`/VC, Solid Pod, WebAuthn. Each is a separate
future skill/spec. Per-standard conformance (micropub.rocks, webmention.rocks,
Solid) remains the `@dwk` packages' own concern, not Anglesite's.

## 2. Decisions (resolved during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Trio MVP: IndieAuth + Webmention + Micropub | Stable cohort; pairs with the static IndieWeb already shipped. |
| Package source | Gate on npm publish | `@dwk/*` are all `0.0.0`, unpublished. Skill installs from npm and detects the unpublished state, stopping gracefully — no git installs, no forks. |
| Where endpoints run | Compose into `site-entry.js` | Identity is HTTPS-rooted at the primary domain; only the Worker bound to that domain qualifies. `site-entry.js` is already a composition root (membership/experiment/consent middleware ahead of `ASSETS`). |
| Micropub content | Git write-back + rebuild | Micropub-created posts become first-class Keystatic content. |
| Micropub bridge | Build the D1→GitHub bridge now | `@dwk/micropub` storage is **not** pluggable — it always writes to D1 (`MICROPUB_DB`); only `generatePostUrl` is configurable. Git write-back therefore requires a bridge on top: materialize D1 records → `.mdoc` → commit. |
| Rebuild trigger | GitHub Actions deploy workflow | No CI exists in the template today (deploy is local `wrangler deploy`). Add `.github/workflows/deploy.yml` to the site repo; push to `src/content/**` runs build + `wrangler deploy` with a `CLOUDFLARE_API_TOKEN` repo secret. MCP/CLI-automatable; repo already on GitHub via the backup skill. |
| Webmention display | Edge-render via `HTMLRewriter` | `site-entry.js` already rewrites HTML responses (consent geo meta, A/B variants); injecting mentions from `WEBMENTION_DB` reuses that capability. Always current, zero client JS. Gated to note/post target pages with mentions. |

## 3. Architecture

### 3.1 Composition into `site-entry.js`

Mount the three factory handlers ahead of the `env.ASSETS.fetch()` fallthrough,
each gated on the presence of its binding — identical in spirit to the existing
membership / A-B / consent guards. A site that hasn't run the skill serves
identically to today (the guards are all false).

```js
// after the existing membership/AB/consent middleware, before ASSETS:
const p = url.pathname;
if (env.AUTH_DB       && p.startsWith('/auth'))                 return indieauth(request, env, ctx);
if (env.MICROPUB_DB   && (p === '/micropub' || p === '/media')) return micropub(request, env, ctx);
if (env.WEBMENTION_DB && p === '/webmention')                   return webmention(request, env, ctx);
// …fall through to ASSETS (with optional webmention edge-render, §3.5)
```

The same Worker gains two new top-level exports:

- `async queue(batch, env, ctx)` — drains `WEBMENTION_QUEUE` (async link
  verification, delegated to `@dwk/webmention`) **and** the Micropub→GitHub
  bridge work (§3.4).
- `async scheduled(event, env, ctx)` — cron: retry unsynced bridge records and
  any webmention re-verification.

Factory handlers are created once at module scope from config (`baseUrl`, `me`,
issuer, scopes, `generatePostUrl`). Wrangler's esbuild bundles the npm deps into
the Worker automatically.

### 3.2 Cloudflare bindings (provisioned MCP-first, wrangler fallback)

| Binding | Type | Owner package | Purpose |
|---|---|---|---|
| `AUTH_DB` | D1 | indieauth | Authorization codes + issued tokens (strongly-consistent; never KV). |
| `MICROPUB_DB` | D1 | micropub | Published post records (mf2 source) + DPoP `jti` replay store. |
| `WEBMENTION_DB` | D1 | webmention | Verified-mention inbox. |
| `MEDIA` | R2 | micropub | Media-endpoint blob storage. |
| `WEBMENTION_QUEUE` | Queue | webmention | Async source-link verification. |
| `INDIEAUTH_SIGNING_KEY` | secret | indieauth | Token signing material (generated by the skill). |
| `GITHUB_TOKEN` | secret | bridge | Fine-grained PAT, `contents:write` on the site repo — for `.mdoc` commits. |

D1/R2 provisioned via `mcp__cloudflare__d1_database_create` /
`mcp__cloudflare__r2_bucket_create` (skill writes the returned ids into
`wrangler.jsonc` itself). Queues are not in the MCP set → `npx wrangler queues
create` fallback path. Secrets via `npx wrangler secret put`.

### 3.3 Discovery links (`BaseLayout.astro`)

Inject into `<head>`, each gated on the corresponding feature flag in
`.site-config`:

```html
<link rel="indieauth-metadata"     href="/.well-known/oauth-authorization-server" />
<link rel="authorization_endpoint" href="/auth" />
<link rel="token_endpoint"         href="/auth/token" />
<link rel="micropub"               href="/micropub" />
<link rel="webmention"             href="/webmention" />
```

The exact metadata path/shape follows what `@dwk/indieauth` advertises; the skill
reads the package's resolved config rather than hard-coding.

### 3.4 Micropub content model + D1→GitHub bridge

**New Keystatic `notes` collection** — Micropub h-entry "notes" are frequently
titleless (tweet-like) and don't fit the title-required `posts` collection
(`src/content/posts/*`, `slugField: title`). Add:

```
src/content/notes/*   — slug from timestamp, title optional, mf2-friendly fields
```

`@dwk/micropub` `generatePostUrl` → `/notes/<slug>` so the `201 Location`
canonical URL matches where the rebuilt static page lands.

**Bridge (`worker/indieweb-bridge.js`)**, driven by the `queue`/`scheduled`
exports:

1. Read new/updated/deleted records from `MICROPUB_DB` (a `synced` flag tracks
   materialization state).
2. Render each record's mf2 → a Keystatic `.mdoc` (frontmatter + markdoc body)
   at `src/content/notes/<slug>.mdoc`. Delete → remove the file (or set a draft
   flag, mirroring the D1 soft-delete).
3. Commit via the GitHub Contents API using `GITHUB_TOKEN`, on the default
   branch.
4. The commit triggers the GitHub Actions deploy workflow (§3.6).
5. On success, mark the record `synced`. On failure, leave it unsynced for the
   cron retry — never block the Micropub `201`.

Consequence: a new note is **queryable instantly** (`q=source` reads D1) but
**publicly visible only after rebuild (~1–2 min)**. D1 is the API-facing source
of record; the committed `.mdoc` → rendered page is the eventually-consistent
public copy. This is documented for the owner.

**Rendering** — `src/pages/notes/[slug].astro` (single note, `h-entry`) and
`src/pages/notes/index.astro` (the `h-feed`). Normal static pages; they render
once the `.mdoc` is committed and rebuilt.

### 3.5 Webmention display (edge-render)

On `ASSETS` responses for note/post pages that are webmention targets,
`site-entry.js` queries `WEBMENTION_DB` for mentions of that target and uses
`HTMLRewriter` to inject them into a designated container (e.g.
`<div id="webmentions">`). Gated: only HTML responses for known target paths with
≥1 stored mention pay the query + rewrite cost. No client JS; always current.

### 3.6 Rebuild trigger (GitHub Actions)

`template/.github/workflows/deploy.yml` (net-new): on push to `src/content/**`
(and manual dispatch), `npm ci && npm run build && npx wrangler deploy`,
authenticated with `CLOUDFLARE_API_TOKEN` (+ account id) repo secrets. The skill
sets these secrets via `gh secret set`. This also gives every Anglesite site a
git-push-driven deploy path, not just Micropub.

## 4. Components changed

**New skill:** `skills/indieweb/SKILL.md` (`disable-model-invocation: true`).
Flow: preflight (custom domain required; Cloudflare active; repo on GitHub;
`@dwk/*` published check) → pick endpoints (default all, each independently
gated) → provision bindings → wire `wrangler.jsonc` → patch `site-entry.js` →
inject discovery links → set up `notes` collection + bridge + Actions workflow →
write `.site-config` (`me`, owner identity, enabled-endpoint flags) → summary.

**Template (`template/`):**
- `keystatic.config.ts` — `notes` collection.
- `src/layouts/BaseLayout.astro` — conditional discovery `<link>`s.
- `worker/site-entry.js` — gated composition + `queue`/`scheduled` exports + webmention edge-render.
- `worker/indieweb-bridge.js` — D1→GitHub materializer.
- `src/pages/notes/[slug].astro`, `src/pages/notes/index.astro`.
- `.github/workflows/deploy.yml`.
- `docs/indieweb.md` — extend with the active-endpoint section.

**Plugin docs:**
- New ADR `docs/decisions/0020-active-indieweb.md` (+ README entry). (0019 was already taken by the D1 inbox ADR.)
- `docs/platforms/dwk-workers.md` — integration guide.
- Root `CLAUDE.md` — skill table + skill count.

## 5. Error handling

- **Missing binding** → `@dwk` packages fail loud at startup (composition
  contract), but the `if (env.BINDING)` guards mean a partially-configured site
  still serves `ASSETS`.
- **Bridge commit failure** → record left unsynced, retried on cron; never
  blocks the Micropub `201`.
- **GitHub token expiry** → bridge logs; surfaced via `/anglesite:check`.
- **`@dwk/*` unpublished** → skill detects on preflight and stops with a clear
  "not available yet" message.
- **No custom domain** → skill refuses (identity can't root on `*.workers.dev`).

## 6. Security / deploy-scan integration

- `/auth`, `/micropub`, `/media`, `/webmention` are **intentional public
  endpoints** — the deploy skill's route scans must not flag them.
- `INDIEAUTH_SIGNING_KEY` and `GITHUB_TOKEN` are **secret bindings** (wrangler
  secrets / GH secrets), never in source — the token scan must not false-positive
  and must confirm they aren't committed.
- Micropub enforces **DPoP on every request** and binds the token subject to the
  configured `me` — documented as intentional (bearer-only clients, incl.
  micropub.rocks' default flow, won't authenticate).
- `GITHUB_TOKEN` is least-privilege: fine-grained, single-repo, `contents:write`.

## 7. Testing

**Plugin-side (`tests/`):**
- `site-entry.js` gated dispatch (each route only when its binding is present;
  fallthrough to `ASSETS` otherwise).
- Discovery-link injection (present only when flags set).
- `notes` collection shape; `.mdoc` rendered from a sample mf2 record.
- `wrangler.jsonc` binding union after wiring.
- Webmention edge-render gating (no query/rewrite when no mentions).

**Out of scope:** per-standard conformance suites (owned by `@dwk`).

**Manual:** scaffold a test site → run the skill → IndieAuth login from a real
client + a Micropub create (observe D1 → commit → Actions deploy → live page) +
a webmention round-trip (observe inbox → edge-rendered display).

## 8. Open items deferred to the plan

- Exact `notes` collection field set (mapping mf2 properties ↔ Keystatic fields).
- The `@dwk/indieauth` metadata path/shape to advertise (read from package).
- Whether the bridge runs primarily on `queue` (event-driven) vs `scheduled`
  (cron) — likely queue-first with cron as the retry backstop.
