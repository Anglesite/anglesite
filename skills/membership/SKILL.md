---
name: membership
description: "Gate premium content with newsletter (free) or Stripe (paid) — signed-cookie unlocks at the edge"
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(npx astro check), Bash(grep *), Bash(node *), Write, Read, Edit, Glob
disable-model-invocation: true
---

Add a paywall to the site. Two tiers, both unlock the same `tier: premium` pages:

- **Free tier** — visitor confirms newsletter subscription (Buttondown or Mailchimp). They get a signed cookie, premium content unlocks.
- **Paid tier** — visitor pays for a Stripe subscription. Stripe Customer Portal handles cancel/upgrade. They get a signed cookie, premium content unlocks.

Pages marked `tier: premium` in frontmatter are gated at the edge by `functions/_middleware.ts`. Public visitors see a teaser (configurable) plus an unlock prompt. Inline `<Premium>` blocks gate sections within otherwise-public pages.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — gating runs as a Pages Function at the edge, no static HTML reaches an unauthorized visitor
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — newsletter unlock is a server-to-server check; Stripe checkout is an external redirect (Payment Link), no client SDK
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — newsletter list and Stripe account are the owner's

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt. If `false`, proceed without pre-announcing.

## When to use this skill

- Owner wants to charge for content (creator economy: paid newsletters, courses, premium recipes, exclusive guides)
- Owner wants to reward subscribers with bonus posts behind a free email gate
- Owner mentions "paywall", "premium content", "members only", "subscribers only"

If they only need a one-time purchase (an ebook, a download, a print), route to `/anglesite:buy-button` instead — membership is for recurring access to evolving content.

## Step 0 — Check prerequisites

Read `.site-config`. The following must be set:

- `CF_PROJECT_NAME` — site has been deployed once (Cloudflare account is bound)
- `SITE_DOMAIN` — custom domain configured (cookies are scoped to this domain)
- `CONTACT_EMAIL` — a billing/support email on file

If any are missing, tell the owner: "Membership needs your site deployed on a custom domain first. Run `/anglesite:deploy` once, then come back."

If `MEMBERSHIP_WORKER_URL` is already set, the backend exists — skip to Step 5 to gate new pages.

## Step 1 — Choose tier(s)

Ask: "Which tiers do you want?"

| Option | Backend | Cost to subscriber | Cost to owner |
|---|---|---|---|
| **Free only** | Newsletter (Buttondown / Mailchimp) | Free (email opt-in) | Newsletter cost only |
| **Paid only** | Stripe subscription | Owner sets (e.g., $5/mo) | Stripe fees (2.9% + 30¢) |
| **Both** | Both — paid is a superset | Tiered | Both |

Save to `.site-config`:

- `MEMBERSHIP_TIERS=free` (or `paid`, or `free,paid`)

## Step 2 — Free tier setup (skip if paid-only)

Free tier piggybacks on the newsletter list. If `/anglesite:newsletter` has not been run yet, run it first — the membership skill needs `NEWSLETTER_API_KEY` and `NEWSLETTER_PLATFORM` already configured.

If newsletter is configured, no extra owner work — the membership Worker reuses the same API key to verify list membership.

Tell the owner: "Free tier unlock works like this: a visitor enters their email, we check it's on your newsletter list, and we set a cookie that unlocks premium pages. If they're not subscribed, they get a one-click subscribe button."

## Step 3 — Paid tier setup (skip if free-only)

### 3a — Stripe product

Guide the owner:

1. Sign in to **Stripe Dashboard** → Catalog → Add product
2. Set the product name (e.g., "Premium Membership")
3. Set the price as **Recurring** — pick monthly / yearly / both
4. Save the product. Copy the **price ID** (looks like `price_...`)

### 3b — Stripe Payment Link

1. Stripe Dashboard → Payment Links → Create
2. Select the recurring product from 3a
3. Under **After payment** → set "Show confirmation page" (default URL works — we'll override)
4. Under **Advanced** → check "Pass billing details" so we get the customer email
5. Save and copy the URL (looks like `https://buy.stripe.com/...`)

Save to `.site-config`:

- `STRIPE_MEMBERSHIP_LINK=https://buy.stripe.com/...`
- `STRIPE_PRICE_ID=price_...`

### 3c — Stripe Customer Portal

1. Stripe Dashboard → Settings → Billing → Customer Portal
2. Activate the portal
3. Allow customers to: cancel subscriptions, update payment method, view invoices
4. Set the return URL to `https://SITE_DOMAIN/account`

### 3d — Stripe API keys

The owner provides their **secret key** (Stripe Dashboard → Developers → API keys → Secret key, starts with `sk_live_` or `sk_test_`). It's stored as a Cloudflare Worker secret, never in the codebase.

Also generate a **webhook signing secret** in Step 4d below — the Worker uses it to verify Stripe webhook events that mark a subscription as active or canceled.

## Step 4 — Deploy the membership Worker

Tell the owner: "I'm deploying the server that handles the unlock — it verifies the email or payment, signs a cookie, and sends the visitor back to the page they were trying to read."

### 4a — Generate the cookie signing secret

The Worker signs unlock cookies with HMAC. Generate a 32-byte random key:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the printed hex string — you'll paste it as `MEMBERSHIP_SIGNING_KEY` next.

### 4b — Set Worker secrets

```sh
npx wrangler secret put MEMBERSHIP_SIGNING_KEY --config worker/membership-wrangler.toml
```

Paste the hex from 4a when prompted.

```sh
npx wrangler secret put SITE_DOMAIN --config worker/membership-wrangler.toml
```

Paste the value of `SITE_DOMAIN` from `.site-config`.

```sh
npx wrangler secret put MEMBERSHIP_TIERS --config worker/membership-wrangler.toml
```

Paste the value of `MEMBERSHIP_TIERS` (e.g., `free,paid`).

If free tier is enabled, also set:

```sh
npx wrangler secret put NEWSLETTER_API_KEY --config worker/membership-wrangler.toml
npx wrangler secret put NEWSLETTER_PLATFORM --config worker/membership-wrangler.toml
```

If using Mailchimp:

```sh
npx wrangler secret put MAILCHIMP_LIST_ID --config worker/membership-wrangler.toml
```

If paid tier is enabled, also set:

```sh
npx wrangler secret put STRIPE_SECRET_KEY --config worker/membership-wrangler.toml
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config worker/membership-wrangler.toml
```

(For `STRIPE_WEBHOOK_SECRET`, finish step 4d first, then come back and run this command.)

### 4c — Deploy

```sh
npx wrangler deploy --config worker/membership-wrangler.toml
```

Capture the printed Worker URL (e.g., `https://anglesite-membership.ACCOUNT.workers.dev`). Save it to `.site-config` as `MEMBERSHIP_WORKER_URL=https://...`.

### 4d — Stripe webhook (paid tier only)

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `<MEMBERSHIP_WORKER_URL>/webhook/stripe`
3. Events: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`
4. Copy the **signing secret** (starts with `whsec_`)
5. Run the `STRIPE_WEBHOOK_SECRET` command from 4b with this value
6. Re-run `npx wrangler deploy --config worker/membership-wrangler.toml`

Webhooks are how the Worker knows when a subscription becomes active. The Worker stores active subscriber identifiers in KV (`MEMBERSHIPS` namespace).

### 4e — KV namespace

Create the KV namespace and bind it to the Worker:

```sh
npx wrangler kv namespace create MEMBERSHIPS
```

Copy the `id` value from the output and paste it into `worker/membership-wrangler.toml` under `[[kv_namespaces]]`. Re-deploy.

## Step 5 — Mark pages as `tier: premium`

Two ways to gate content:

### Whole-page gating (frontmatter)

In any `src/content/posts/*.mdoc` (or other gated collection), set:

```yaml
---
title: "Premium post"
tier: premium
publicPreview: 2  # optional — number of paragraphs visible to non-members
---
```

The `posts` collection schema (and Keystatic) already declares `tier` and `publicPreview`. The middleware checks the cookie before serving — non-members get a redirect to `/unlock?return=<path>`.

### Section gating (component)

For pages that should be partly public, wrap a section in `<Premium>`:

```astro
---
import Premium from "../components/Premium.astro";
---

<p>Free intro paragraph everyone sees.</p>
<p>Another free paragraph.</p>

<Premium teaser="The next 3 sections are for members.">
  <h2>Members-only details</h2>
  <p>Full content here.</p>
</Premium>
```

The component renders the children server-side only if a valid signed cookie is present in the request. Public visitors see the `teaser` text and an unlock button.

## Step 6 — Update CSP for the Worker URL and the Stripe redirect

Read `public/_headers`. Update:

- `form-action` — append `MEMBERSHIP_WORKER_URL`
- `connect-src` — append `MEMBERSHIP_WORKER_URL`

If paid tier is enabled, ensure `form-action` already permits `https://buy.stripe.com` (the Payment Link target). Stripe Payment Links are external redirects, not embeds — no `frame-src` change needed.

## Step 7 — Build and verify

The edge middleware reads `functions/_premium-routes.json` to know which paths require a member cookie. Regenerate that index from the current `tier: premium` frontmatter, then build:

```sh
npm run ai-premium-build
npm run build
```

`ai-premium-build` is safe to re-run any time content changes — it preserves any glob-style entries (e.g. `"/members/*"`) the owner added by hand. **Run it before every deploy that touches premium content**, or the new pages will be publicly readable until the next regeneration.

Spot-check that:

- A premium post renders only its public preview when no `__anglesite_member` cookie is present
- The `/unlock` page loads at `https://SITE_DOMAIN/unlock`
- The `/account` page loads (paid tier only)

Run `npx astro check` to catch any schema typos.

Tell the owner what's live:

- `/unlock` — visitors enter their email (free) or click subscribe (paid)
- `/account` — paid members manage billing via Stripe Customer Portal
- Premium pages — gated at the edge, no flash of paid content
- `<Premium>` blocks — inline gating within public pages

## How the cookie works

The Worker signs a JSON payload `{ tier, exp, sub }` with HMAC-SHA256 using `MEMBERSHIP_SIGNING_KEY`. Cookie name: `__anglesite_member`. Attributes: `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000` (30 days).

- **Free tier** — `sub` is a SHA-256 hash of the verified email (no PII at rest), `tier` is `free`, `exp` is 30 days
- **Paid tier** — `sub` is a hash of the Stripe customer ID, `tier` is `paid`, `exp` is 30 days

The middleware verifies the HMAC and `exp` on every request. If invalid or expired, the visitor is redirected to `/unlock`. The Worker re-checks the source of truth (newsletter list or Stripe subscription) before issuing a fresh cookie — so a canceled subscription stops working when the cookie expires.

For instant revocation, the Worker stores active subscriber hashes in KV (`MEMBERSHIPS` namespace). The Stripe webhook deletes the entry on cancel, and the Worker's `/unlock` endpoint refuses to issue a fresh cookie for a hash that's not in KV.

## Notes

- The signing key never leaves Cloudflare — the middleware verifies via Web Crypto SubtleCrypto in the same Worker isolate runtime
- No third-party JS — both unlock paths are plain HTML forms / external redirects
- Owners can preview gated content while logged out by appending `?preview=<MEMBERSHIP_PREVIEW_TOKEN>` (set in `.site-config`); the middleware accepts it as a one-time bypass
- For analytics, gated views count as a single edge request — `/anglesite:stats` reports unlock events from the Worker logs (issue #194 inbox will surface them long-term)
- If the owner cancels Stripe and just wants free-tier later, set `MEMBERSHIP_TIERS=free` in `.site-config`, re-run Step 4b for `MEMBERSHIP_TIERS`, and redeploy. The middleware will stop expecting `tier=paid` cookies
- The pre-deploy security scan flags the membership Worker URL — that's expected; it's a first-party Cloudflare Worker on the owner's account
