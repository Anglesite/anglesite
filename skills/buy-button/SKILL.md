---
name: buy-button
description: "Add a buy button to sell a product, service, or digital good (Stripe or Polar)"
user-invokable: false
allowed-tools: Write, Read, Edit, Glob
---

Add a buy/payment button to a page. Two paths depending on what the owner is selling:

- **Physical products, services, or donations** → Stripe Payment Links (plain external redirect, no third-party JS)
- **Digital goods** (downloads, templates, presets, courses, ebooks, memberships) → Polar checkout overlay (Merchant of Record — handles global VAT and sales tax automatically)

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Stripe Payment Links are external redirects, fully compliant. Polar's checkout overlay (`cdn.polar.sh`) is an approved exception, like Cloudflare Turnstile.

## When to invoke this skill

- When the owner wants to sell a single product or service
- When the owner wants to sell a digital good (download, template, preset, course, ebook, membership)
- When the owner wants to accept a payment or donation
- When the owner mentions Stripe, Polar, payment links, or "buy button"
- When `/anglesite:add-store` routes here (single product, no catalog needed)

## Step 1 — Determine which path

Ask the owner: "What are you selling?"

**Route to Polar** if the answer involves digital goods:
- Downloadable files (presets, templates, ebooks, PDFs, fonts, icons)
- Courses or educational content
- Memberships or subscriptions for exclusive content
- License keys or software

**Route to Stripe** if the answer involves:
- Physical products or services
- One-time payments or donations
- Anything that doesn't need file delivery or license management

If unclear, explain the difference:

> **Polar** is best for digital products — it handles file delivery, license keys, and international sales tax automatically. You only pay 4% + payment processing fees, no monthly cost.
>
> **Stripe** is best for services, physical goods, or donations — it's a simple payment link with no extra features. 2.9% + 30¢ per transaction.

---

## Path A — Stripe Payment Links (physical goods, services, donations)

### A1 — Collect product details

Ask the owner for:

1. **What are you selling?** — product name, service, or donation purpose
2. **Price** — fixed amount (e.g., "$500") or "customer chooses" for donations
3. **One-line description** — shown on the checkout page
4. **Which page?** — where the button should appear (e.g., homepage, a service page)
5. **Button label** — default "Buy Now", but could be "Book Now", "Donate", "Get Started", etc.

### A2 — Guide the owner through Stripe Payment Link creation

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

### A3 — Add the BuyButton component

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

---

## Path B — Polar checkout overlay (digital goods)

### B1 — Collect product details

Ask the owner for:

1. **What are you selling?** — product name and type (download, course, membership, etc.)
2. **Price** — fixed amount (e.g., "$19") or recurring (e.g., "$5/month")
3. **One-line description** — shown on the checkout page
4. **Which page?** — where the button should appear
5. **Button label** — default "Buy Now", but could be "Download", "Get Access", "Subscribe", etc.

### B2 — Guide the owner through Polar product creation

Tell the owner:

> Polar handles everything for digital sales — payment processing, file delivery, license keys, and international sales tax. Here's how to set it up:
>
> 1. Go to **polar.sh** and create an account (or sign in)
> 2. Create a new product — set the name, price, and description
> 3. If selling a file, upload it to the product (Polar delivers it after purchase)
> 4. Go to the product page and copy the **checkout URL** (it looks like `https://buy.polar.sh/...`)
> 5. Paste the URL here

If the owner asks about costs:

> Polar charges 4% + payment processing fees per transaction. No monthly fee. They handle all international VAT and sales tax as your Merchant of Record — you don't need to worry about tax compliance.

Wait for the owner to provide the checkout URL before proceeding.

### B3 — Add the PolarCheckout component

The `PolarCheckout.astro` component already exists at `src/components/PolarCheckout.astro`.

Import and use it on the target page:

```astro
---
import PolarCheckout from "../components/PolarCheckout.astro";
---

<PolarCheckout href="https://buy.polar.sh/OWNER_PRODUCT" label="Buy Now" />
```

The component accepts these props:
- `href` (required) — the Polar checkout URL
- `label` (optional, default "Buy Now") — button text
- `theme` (optional, default "light") — "light" or "dark" to match the site theme

The component renders a checkout overlay that opens on the current page — the customer stays on the site during purchase.

Place the button in context — near the product description, pricing section, or call-to-action area. Don't drop it in isolation.

---

## Step 4 — Verify

Run `npm run build` to confirm the site builds cleanly with the new component.

## Notes

- Stripe Payment Links handle the entire checkout flow — no server routes, no API keys in the codebase, no PII concerns
- The Stripe button is a plain `<a>` tag with `target="_blank"` — accessible, works without JavaScript, prints cleanly
- The Polar checkout overlay loads a single script from `cdn.polar.sh` — approved in ADR-0008 and the pre-deploy allowlist
- Polar acts as Merchant of Record, handling global VAT and sales tax — critical for owners selling internationally
- If the owner later needs a full catalog or cart, suggest upgrading to Snipcart or Shopify Buy Button (see issue #96)
- After setup, the `/anglesite:add-store` skill deploys the ecommerce webhook worker for revenue tracking. If this skill was invoked directly (not via add-store), remind the agent to set up the webhook for the chosen provider (Stripe or Polar) — see `worker/wrangler-ecommerce.toml` for details.
