# Newsletter integration: add beehiiv as a provider

**Date:** 2026-07-27 · **Issue:** [#1030](https://github.com/Anglesite/Anglesite-app/issues/1030)

## Background

The newsletter integration proxies subscribe-form posts through a per-site
Cloudflare Worker (`worker/subscribe-worker.js`) that calls the newsletter
platform's REST API server-side, keeping the API key off the client. It
currently supports Buttondown and Mailchimp.

A July 2026 review of newsletter services (beehiiv, Ghost, Buttondown, Kit,
MailerLite, EmailOctopus, Substack, Listmonk) against this architecture
concluded:

- **Buttondown stays the recommended default.** Its API is free on all plans
  (since Jan 2025), double opt-in is the API default, it is email-first with
  no ambition to replace the user's site, and RSS-to-email (+$9/mo) is the
  only affordable "site publishes, service delivers" automation in the field.
  Known limit: subscriber creation is capped at 100 requests/day by default.
- **beehiiv is added as a provider.** Its free Launch plan (2,500
  subscribers) includes the v2 subscriptions API, so the Worker integration
  costs one fetch wrapper. Caveat owners should know: beehiiv's RSS-to-Send
  is gated to its Max plan ($96+/mo), so on affordable tiers newsletters are
  composed in beehiiv rather than driven from the site's RSS feed, and
  beehiiv promotes its own hosted site/archive.
- **Ghost is rejected.** No free tier; the Admin API the Worker would need is
  gated to Ghost(Pro) Publisher ($29/mo) or self-hosting with Mailgun; auth
  requires minting short-lived JWTs; and members created via the Admin API
  bypass double opt-in entirely.
- **Substack is rejected** (still no public subscribe API in 2026).
- **Kit is deferred** — its 10,000-subscriber free tier is attractive. The
  apparent documentation contradiction on free-plan API access resolved on
  closer reading (2026-07-27): the developer docs' "eligible plan" caveat is
  scoped to *sending broadcasts* via the API, while the help center states
  API keys are available on any plan and the pricing matrix lists
  subscriber-API access on the free Newsletter plan. A live check (free
  signup → mint v4 key → `POST /v4/subscribers`) is still wanted before
  adding the provider.
- **MailerLite** (free tier cut to 250 subscribers in June 2026),
  **EmailOctopus** (no RSS-to-email), and **Listmonk** (self-hosted Postgres
  plus deliverability ownership — unrealistic for the audience) are not
  added.

## Design

### Worker (`Resources/Template/integrations/worker/subscribe-worker.js`)

- New `subscribeBeehiiv(email, apiKey, publicationId)`:
  `POST https://api.beehiiv.com/v2/publications/{publicationId}/subscriptions`
  with `Authorization: Bearer <apiKey>` and body
  `{ email, double_opt_override: "on" }`.
- Double opt-in is forced per-call, matching the posture the Mailchimp path
  already takes (`status: "pending"`), rather than inheriting the
  publication's setting.
- Response mapping: any 2xx → success. beehiiv does not document a distinct
  already-subscribed error (the endpoint behaves as an upsert), so repeat
  subscribers see the normal success path. Non-2xx → the existing generic
  failure message.
- New secret `BEEHIIV_PUBLICATION_ID` (the `pub_…` id), analogous to
  `MAILCHIMP_LIST_ID`. `NEWSLETTER_PLATFORM` gains the value `beehiiv`.
- No CSP change — the API call happens in the Worker, not the browser.

### Catalog (`Sources/AnglesiteCore/IntegrationCatalog.swift`)

- Add `Provider(id: "beehiiv", displayName: "beehiiv", cspDomains: [])` to
  the newsletter descriptor and name all three services in its summary.
- Wizard fields unchanged: provider-specific config (API key, publication
  id) lives in Worker secrets, exactly as Mailchimp's list id does today.

### Docs (`Resources/Template/integrations/docs/newsletter-setup.md`)

- beehiiv bullet in step 1 (free Launch plan includes the API; key from
  Settings → API; note the `pub_…` publication ID).
- Conditional `BEEHIIV_PUBLICATION_ID` secret in step 2.

### Tests

- `IntegrationCatalogTests` provider-set assertion updated to include
  `beehiiv`.
- Verification: `swift test` (template-coupled suites included) — the Worker
  itself has no JS test harness today and this change does not introduce one.

## Addendum: Kit provider (#1034, same day)

With the free-plan question resolved, Kit is added as a fourth provider in a
stacked follow-up:

- `subscribeKit(email, apiKey, formId)` in the Worker: upsert the subscriber
  (`POST /v4/subscribers`, `X-Kit-Api-Key` auth, 200 update / 201 create),
  then add them to a form by email (`POST /v4/forms/{formId}/subscribers`,
  200 already-on-form / 201 added). Kit's double opt-in lives on forms — the
  form step is what sends the confirmation email — so `KIT_FORM_ID` is a
  required secret and the Worker refuses to subscribe without it rather than
  silently creating unconfirmed-by-policy subscribers.
- Catalog gains `Provider(id: "kit", displayName: "Kit")`; setup docs tell
  owners to create the form with double opt-in enabled.
- Same non-goals as beehiiv: no send-via-API, no distinct already-subscribed
  message (both Kit calls are idempotent upserts).

## Out of scope

- EmailOctopus provider (revisit if requested).
- Any "send via API" ambition (beehiiv gates its Send API to Enterprise).
- Wizard-driven Worker deployment (deploying the subscribe Worker remains
  the documented manual `wrangler` step).
