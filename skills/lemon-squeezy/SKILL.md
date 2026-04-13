---
name: lemon-squeezy
description: "Add a Lemon Squeezy checkout overlay for digital product sales (alternative to Polar)"
user-invokable: false
allowed-tools: Bash(npm run build), Write, Read, Edit, Glob
---

Add a Lemon Squeezy checkout overlay to sell digital products. Lemon Squeezy is a Merchant of Record — it handles payment processing, file delivery, license keys, and global sales tax automatically.

This is an alternative to Polar for digital goods. The `/anglesite:add-store` intake flow routes here when the owner prefers Lemon Squeezy over Polar.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Lemon Squeezy's checkout overlay (`assets.lemonsqueezy.com`) is an approved exception, like Polar and Cloudflare Turnstile.

## When to invoke this skill

- When `/anglesite:add-store` routes here (digital goods, owner chose Lemon Squeezy)
- When the owner mentions Lemon Squeezy by name
- When the owner wants an alternative to Polar for digital product sales

## Step 1 — Collect product details

Ask the owner for:

1. **What are you selling?** — product name and type (download, course, membership, etc.)
2. **Price** — fixed amount (e.g., "$19") or recurring (e.g., "$5/month")
3. **One-line description** — shown on the checkout page
4. **Which page?** — where the button should appear
5. **Button label** — default "Buy Now", but could be "Download", "Get Access", "Subscribe", etc.

## Step 2 — Guide the owner through Lemon Squeezy product creation

Tell the owner:

> Lemon Squeezy handles everything for digital sales — payment processing, file delivery, license keys, and international sales tax. Here's how to set it up:
>
> 1. Go to **lemonsqueezy.com** and create an account (or sign in)
> 2. Create a new product — set the name, price, and description
> 3. If selling a file, upload it to the product (Lemon Squeezy delivers it after purchase)
> 4. Go to your product's **Share** settings and copy the **checkout URL** (it looks like `https://my-store.lemonsqueezy.com/buy/...`)
> 5. Paste the URL here

If the owner asks about costs:

> Lemon Squeezy charges 5% + 50¢ per transaction. No monthly fee. They handle all international VAT and sales tax as your Merchant of Record — you don't need to worry about tax compliance.

Wait for the owner to provide the checkout URL before proceeding.

## Step 3 — Add the LemonSqueezyCheckout component

The `LemonSqueezyCheckout.astro` component already exists at `src/components/LemonSqueezyCheckout.astro`.

Import and use it on the target page:

```astro
---
import LemonSqueezyCheckout from "../components/LemonSqueezyCheckout.astro";
---

<LemonSqueezyCheckout href="https://my-store.lemonsqueezy.com/buy/PRODUCT" label="Buy Now" />
```

The component accepts these props:
- `href` (required) — the Lemon Squeezy checkout URL
- `label` (optional, default "Buy Now") — button text
- `theme` (optional, default "light") — "light" or "dark" to match the site theme

The component renders a checkout overlay that opens on the current page — the customer stays on the site during purchase.

Place the button in context — near the product description, pricing section, or call-to-action area. Don't drop it in isolation.

## Step 4 — Verify

Run `npm run build` to confirm the site builds cleanly with the new component.

## Notes

- Lemon Squeezy's checkout overlay loads a single script from `assets.lemonsqueezy.com` — approved in ADR-0008 and the pre-deploy allowlist
- Lemon Squeezy acts as Merchant of Record, handling global VAT and sales tax — critical for owners selling internationally
- Lemon Squeezy is now part of Stripe but operates as a separate product with its own dashboard and pricing
- If the owner later needs a full catalog or cart, suggest upgrading to Snipcart or Shopify Buy Button
- After setup, the `/anglesite:add-store` skill deploys the ecommerce webhook worker for revenue tracking. If this skill was invoked directly (not via add-store), remind the agent to set up the Lemon Squeezy webhook — see `worker/wrangler-ecommerce.toml` for details.
