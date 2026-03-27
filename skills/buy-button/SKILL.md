---
name: buy-button
description: "Add a Stripe Payment Link buy button to sell a single product or service"
user-invokable: false
allowed-tools: Write, Read, Edit, Glob
---

Add a buy/payment button to a page using Stripe Payment Links. This is the zero-integration ecommerce path — no cart, no catalog, no server-side code, no third-party JavaScript. The button links to a hosted Stripe checkout page.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Stripe Payment Links are external redirects, not embedded scripts. Fully compliant.

## When to invoke this skill

- When the owner wants to sell a single product or service
- When the owner wants to accept a payment or donation
- When the owner mentions Stripe, payment links, or "buy button"
- When `/anglesite:add-store` routes here (single product, no catalog needed)

## Step 1 — Collect product details

Ask the owner for:

1. **What are you selling?** — product name, service, or donation purpose
2. **Price** — fixed amount (e.g., "$500") or "customer chooses" for donations
3. **One-line description** — shown on the checkout page
4. **Which page?** — where the button should appear (e.g., homepage, a service page)
5. **Button label** — default "Buy Now", but could be "Book Now", "Donate", "Get Started", etc.

## Step 2 — Guide the owner through Stripe Payment Link creation

Tell the owner:

> To accept payments, you'll need a Stripe account and a Payment Link. Here's how:
>
> 1. Go to your **Stripe Dashboard** → Payment Links → Create payment link
> 2. Set the product name, price, and description
> 3. Click **Create link** and copy the URL (it looks like `https://buy.stripe.com/...`)
> 4. Paste the URL here

If the owner doesn't have a Stripe account, explain:

> Stripe is free to set up — you only pay when you make a sale (2.9% + 30¢ per transaction). Create an account at stripe.com, then follow the steps above.

Wait for the owner to provide the Payment Link URL before proceeding.

## Step 3 — Add the BuyButton component

The `BuyButton.astro` component already exists at `src/components/BuyButton.astro`.

Import and use it on the target page:

```astro
---
import BuyButton from "../components/BuyButton.astro";
---

<BuyButton href="https://buy.stripe.com/OWNER_LINK" label="Buy Now" />
```

Adjust the `label` prop to match what the owner requested (e.g., "Book Now", "Donate", "Get Started").

Place the button in context — near the product description, pricing section, or call-to-action area. Don't drop it in isolation.

## Step 4 — Verify

Run `npm run build` to confirm the site builds cleanly with the new component.

## Notes

- Stripe Payment Links handle the entire checkout flow — no server routes, no API keys in the codebase, no PII concerns
- The button is a plain `<a>` tag with `target="_blank"` — accessible, works without JavaScript, prints cleanly
- If the owner later needs a full catalog or cart, suggest upgrading to Snipcart or Shopify Buy Button (see issue #96)
