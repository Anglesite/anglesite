---
name: paddle
description: "Set up Paddle checkout for software licensing, SaaS subscriptions, or metered billing"
allowed-tools: Write, Read, Edit, Glob, Bash(npm run build), Bash(npx astro check)
user-invokable: false
---

Set up Paddle checkout for selling software, plugins, SaaS subscriptions, or metered-billing products. Paddle acts as Merchant of Record — it handles global tax compliance, subscription management, license keys, and payouts. Claude embeds a checkout overlay on the site using Paddle.js.

This skill is invoked by `/anglesite:add-store` when the owner is selling software, a plugin, or a subscription/SaaS product.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Paddle.js is a sanctioned exception; CSP and pre-deploy scan are configured when `ECOMMERCE_PROVIDER=paddle`
- [ADR-0009 Industry tools first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — use Paddle's checkout and billing platform rather than building custom subscription logic

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## How it works

1. Owner creates a product and price in Paddle's dashboard (paddle.com)
2. Owner provides a client-side token and price ID
3. Claude places a `PaddleCheckout` component on the site
4. Paddle.js opens a checkout overlay when the visitor clicks the button
5. Paddle handles payment, tax, subscriptions, and license key delivery

## Prerequisites

- Site must be deployed at least once (`CF_PROJECT_NAME` set in `.site-config`)
- Owner must have a Paddle account (https://www.paddle.com)

## Step 1 — Collect Paddle credentials

Ask the owner:

> "To set up your checkout, I need two things from your Paddle dashboard:
>
> 1. **Client-side token** — found at Paddle > Developer Tools > Authentication. It starts with `test_` (sandbox) or `live_` (production).
> 2. **Price ID** — found on the product's pricing page. It looks like `pri_01abc123...`.
>
> You can start with a sandbox token to test, then switch to live when you're ready."

If the owner doesn't have a Paddle account:

> "No problem! Sign up at https://www.paddle.com — they have a generous sandbox for testing. Once you've created a product and a price, come back with the client-side token and price ID."

Exit gracefully. Do not write any files.

Validate the inputs:
- Client-side token must start with `test_` or `live_`
- Price ID must start with `pri_`

If invalid, explain what's expected and ask again.

Save to `.site-config`:

```
PADDLE_CLIENT_TOKEN=<client-side-token>
PADDLE_PRICE_ID=<price-id>
```

## Step 2 — Add the checkout component

Create or update the page where the owner wants the buy button. Use the `PaddleCheckout` component:

```astro
---
import PaddleCheckout from '../components/PaddleCheckout.astro';
---

<PaddleCheckout
  clientToken="CLIENT_TOKEN_FROM_CONFIG"
  priceId="PRICE_ID_FROM_CONFIG"
  label="Buy Now"
/>
```

Read the token and price ID from `.site-config` and inject them.

If the owner wants multiple products, each gets its own `PaddleCheckout` component with a different `priceId`. They can all share the same `clientToken`.

## Step 3 — Update CSP headers

Run the CSP header regeneration to add Paddle domains. Read `.site-config`, then use `generateHeadersContent()` from `scripts/csp.ts` to rebuild `public/_headers`:

```typescript
import { parseProviders, generateHeadersContent } from './scripts/csp.js';
```

The CSP module automatically includes Paddle domains (`cdn.paddle.com`, `sandbox-cdn.paddle.com`, `checkout.paddle.com`, `sandbox-checkout.paddle.com`, `log.paddle.com`) when `ECOMMERCE_PROVIDER=paddle`.

## Step 4 — Save configuration

Ensure `.site-config` has:

```
ECOMMERCE_PROVIDER=paddle
PADDLE_CLIENT_TOKEN=<client-side-token>
PADDLE_PRICE_ID=<price-id>
```

## Step 5 — Verify

Run `npm run build` to ensure the site builds cleanly with the Paddle component.

Tell the owner:

> "Your checkout is set up! When visitors click the buy button, Paddle opens a secure checkout overlay right on your site — no redirect needed. Paddle handles payment, tax, and delivery.
>
> To manage products, subscriptions, and payouts, use your Paddle dashboard at https://vendors.paddle.com.
>
> Want to preview it?"

If the build fails, diagnose and fix before presenting.

## Sandbox vs. production

The component auto-detects sandbox mode from the token prefix (`test_` = sandbox, `live_` = production). Both sandbox and production Paddle domains are included in the CSP so the owner can test without CSP changes.

When the owner is ready to go live:

> "To switch from sandbox to production, replace your `test_` token with your `live_` token in `.site-config`. The price ID stays the same if you've set it up in both environments."

## Adding more products later

When the owner asks to add another product, place an additional `PaddleCheckout` component with a different `priceId`. All products share the same `clientToken`.

## Paddle vs. Polar

If the owner is selling simple digital downloads (files, templates, presets) without subscriptions or license management, suggest Polar instead — it's simpler and indie-web-aligned. Paddle is the right choice when the owner needs:

- Recurring subscriptions (monthly/annual billing)
- Metered or usage-based billing
- License key management for software
- Complex pricing (tiers, add-ons, per-seat)

## Revenue tracking

After setup, the `/anglesite:add-store` skill deploys the ecommerce webhook worker for revenue tracking. If this skill was invoked directly (not via add-store), set up the Paddle webhook:

1. Deploy: `npx wrangler deploy --config worker/wrangler-ecommerce.toml`
2. Set secret: `npx wrangler secret put PADDLE_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml`
3. Register webhook in Paddle dashboard → Developer Tools → Notifications → `transaction.completed` → URL: `https://ecommerce-webhooks.<subdomain>.workers.dev/webhook/paddle`
