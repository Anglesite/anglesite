# Webmention realignment to the real `@dwk/webmention` API

**Date:** 2026-06-21 · **Issue:** Anglesite/anglesite#363 (problem 2, Webmention slice) · **Status:** approved

## Problem

`template/worker/site-entry.js` was written against an imagined `@dwk/webmention`
API. The shipped `0.1.0-beta.3` package differs in every load-bearing detail, so
the inbound-webmention path cannot work as written:

| Assumed (template today) | Real (`@dwk/webmention@0.1.0-beta.3`) |
|---|---|
| `createHandler()` (no config) | `createWebmention({ baseUrl, … })` |
| handler has `.queue()` / `.scheduled()` | queue is a **separate** `createWebmentionQueueConsumer(config)`; no `scheduled` arm |
| reads `env.WEBMENTION_DB` | reads `env.WEBMENTION_INBOX` (D1) + `env.WEBMENTION_QUEUE` |
| inbox rows carry `author_name, author_photo, content, url, type, status` | inbox stores only `{ source, target, verified_at }` (PK `(source,target)`) |

The edge-render's `loadWebmentions` selects columns that do not exist → it
throws → the catch degrades to "no mentions" → **mentions never render**.

## Decisions (from brainstorming)

1. **Display model:** a **minimal source-link list** — the package stores only
   the verified `source → target` link, so the page shows "Mentioned by" with
   each source's host as link text. No avatars/author/content (the data isn't
   there). The richer `h-cite` markup is dropped.
2. **Read via the package API**, not hand-rolled SQL: `createD1Inbox(db).list(target)`
   returns `VerifiedMention[]`, keeping anglesite resilient to the package's
   internal schema.
3. **`baseUrl` source:** a new `SITE_URL` Worker `var` (the site origin). Works in
   both `fetch` and `queue` contexts (the queue consumer has no request URL to
   derive an origin from). The skill writes it from `SITE_DOMAIN`.
4. **Binding rename** `WEBMENTION_DB` → `WEBMENTION_INBOX` everywhere it appears.
5. **Scope:** Webmention only. IndieAuth (passkey) and Micropub realignment are
   separate specs; their imports/wiring in `site-entry.js` are left untouched and
   stay inert behind their (unset) bindings.

## Changes

### `template/worker/site-entry.js`
- Import `{ createWebmention, createWebmentionQueueConsumer, createD1Inbox }` from
  `@dwk/webmention`.
- Memoize a handler + queue-consumer per `env` (WeakMap), built with
  `{ baseUrl: env.SITE_URL }`. Dispatch `/webmention` when `env.WEBMENTION_INBOX`
  is bound.
- `queue()`: run the queue consumer when `env.WEBMENTION_INBOX` is bound; keep the
  Micropub bridge `waitUntil`. `scheduled()`: drop the webmention call; keep the
  bridge sync.
- Edge-render: gate on `env.WEBMENTION_INBOX`; load via
  `createD1Inbox(env.WEBMENTION_INBOX).list()` for the cached known-target set and
  `.list(target)` for a page's mentions. `renderMention({ source })` →
  `<li class="h-cite"><a class="u-url" rel="nofollow ugc noopener"
  href="${safeUrl(source)}">${host(source)}</a></li>`. `safeUrl` (from the XSS
  fix this branch stacks on) still guards the `source` href.

### `template/wrangler.jsonc`
- Rename the D1 binding to `WEBMENTION_INBOX` (database_name stays `webmention`).
- Add `"vars": { "SITE_URL": "https://<domain>" }` (skill-substituted).

### `skills/indieweb/SKILL.md` + `docs/platforms/dwk-workers.md`
- Binding name `WEBMENTION_INBOX`, the `SITE_URL` var, the separate
  queue-consumer wiring, and the minimal-display behavior.

### Tests / stubs
- Rewrite `tests/__stubs__/dwk-webmention.ts` to export `createWebmention`,
  `createWebmentionQueueConsumer`, and `createD1Inbox` (with a fake inbox whose
  `list()` is driven by the test); keep the call-recording counters.
- Update `tests/indieweb-dispatch.test.ts` (binding name, queue/scheduled shape,
  minimal-render gating) and `tests/indieweb-wiring.test.ts` (binding name).

## Testing

TDD. Each behavior gets a failing test first:
- `/webmention` dispatch gated on `WEBMENTION_INBOX`; falls through otherwise.
- `queue()` runs the consumer only when bound; always schedules bridge sync.
- `scheduled()` no longer references a webmention arm; still schedules bridge.
- Edge-render queries via the inbox and renders a source-link list only for
  note/blog targets that have mentions; mention-free/non-target pages don't query.
- `renderMention` emits a safe (`http`/`https`-only) `source` href with
  `rel="nofollow ugc noopener"`.

Build (`npm run build`) and the full suite stay green (excluding the pre-existing
`#361` optimize-images failure, fixed on a separate branch).

## Out of scope

Passkey IndieAuth (`approveAuthorization`, `@dwk/webauthn` RP + Durable Object,
registration bootstrap, consent page) and Micropub realignment — separate specs.
