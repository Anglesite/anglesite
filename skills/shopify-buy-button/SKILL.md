---
name: shopify-buy-button
description: "Set up Shopify Buy Button for a full physical product catalog with dashboard"
allowed-tools: Write, Read, Edit, Glob, Bash(npm run build), Bash(npx astro check)
user-invokable: false
---

Set up Shopify Buy Button for selling physical goods with a full catalog (10+ products) that needs inventory management, order tracking, and shipping configuration. The owner manages products in Shopify's admin dashboard; Claude embeds Buy Buttons on the site.

This skill is invoked by `/anglesite:add-store` when the owner is selling physical goods with a full catalog and needs a dashboard.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Shopify Buy Button SDK is a sanctioned exception; CSP and pre-deploy scan are already configured
- [ADR-0009 Industry tools first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — use Shopify's existing ecommerce platform rather than building custom catalog logic

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## How it works

Unlike Snipcart (where Claude manages products as content files), Shopify Buy Button delegates product management entirely to Shopify:

1. Owner creates and manages products in Shopify admin (shopify.com)
2. Owner generates a Buy Button embed code for each product
3. Claude parses the embed code and places a `ShopifyBuyButton` component on the site
4. Shopify handles cart, checkout, payment, inventory, shipping, and orders

## Prerequisites

- Site must be deployed at least once (`CF_PROJECT_NAME` set in `.site-config`)
- Owner needs a Shopify account with at least the Starter plan ($5/month)

## Step 1 — Guide Shopify signup

Ask the owner:

> "For a full product catalog with inventory management, Shopify is the best fit. It starts at $5/month and gives you a dashboard for products, orders, shipping, and discounts.
>
> Do you already have a Shopify account, or do I need to walk you through setting one up?"

If they don't have an account:

> "Here's how to get started:
> 1. Go to https://www.shopify.com/starter and sign up
> 2. Add your products in the Shopify admin
> 3. Come back here and I'll connect your store to your site
>
> Take your time — I'll be here when you're ready."

Exit gracefully. Do not write any files.

## Step 2 — Collect the embed code

Once the owner has a Shopify account with products:

> "Great! Now I need the Buy Button embed code for a product. Here's how to get it:
>
> 1. In your Shopify admin, go to **Products**
> 2. Click the product you want to add
> 3. Click **More actions** → **Embed on an external website**
> 4. Copy the embed code and paste it here
>
> I'll use this to connect your store to your site. You can add more products the same way later."

## Step 3 — Parse the embed code

Use `parseShopifyEmbed()` from `${CLAUDE_PLUGIN_ROOT}/template/scripts/shopify-buy-button.ts` to extract:
- `domain` — the shop's myshopify.com domain
- `storefrontAccessToken` — the public Storefront API token
- `productId` — the Shopify product ID

If parsing fails, ask the owner to paste the code again. Common issues:
- They pasted only part of the snippet
- They pasted a product URL instead of the embed code
- The embed code format has changed

## Step 4 — Place the component

Copy the `ShopifyBuyButton.astro` component from `${CLAUDE_PLUGIN_ROOT}/template/src/components/ShopifyBuyButton.astro` to the site's `src/components/`.

Create or update the page where the product should appear. For the first product, suggest a `/shop` or `/products` page:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ShopifyBuyButton from '../components/ShopifyBuyButton.astro';
---
<BaseLayout title="Shop" description="Browse our products">
  <main>
    <h1>Shop</h1>
    <div class="product-grid">
      <ShopifyBuyButton
        domain="{domain}"
        storefrontAccessToken="{storefrontAccessToken}"
        productId="{productId}"
      />
    </div>
  </main>
</BaseLayout>

<style>
  .product-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 2rem;
    margin-block-start: 2rem;
  }
</style>
```

## Step 5 — Verify CSP and pre-deploy scan

The CSP headers (`public/_headers`) and pre-deploy allowlist (`scripts/pre-deploy-check.ts`) already include Shopify domains from the template. Verify they're present:

- `cdn.shopify.com` and `sdks.shopifycdn.com` in `script-src` and pre-deploy `allowedScripts`
- `cdn.shopify.com` in `style-src` and `img-src`
- `*.myshopify.com` and `monorail-edge.shopifysvc.com` in `connect-src`

If the owner has other providers configured that modified the CSP, ensure Shopify domains are still present.

## Step 6 — Save configuration

Save to `.site-config`:

```
ECOMMERCE_PROVIDER=shopify
SHOPIFY_DOMAIN=my-store.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=abc123def456
```

The storefront access token is a public token (like Stripe's publishable key) — safe to store in `.site-config`.

## Step 7 — Verify

Run `npm run build` to ensure the site builds cleanly with the Shopify component.

Tell the owner:

> "Your store is connected! The Buy Button will show your product with its image, price, and an 'Add to Cart' button — all powered by Shopify.
>
> To manage your products, orders, and inventory, go to your Shopify admin at https://admin.shopify.com.
>
> Want to add more products or preview the site?"

If the build fails, diagnose and fix before presenting.

## Adding more products

When the owner wants to add another product:

1. Ask them to generate another Buy Button embed code from Shopify admin
2. Parse the embed code (the domain and token will be the same; only productId changes)
3. Add another `<ShopifyBuyButton>` component to the shop page

## Scaling guidance

Shopify Buy Button works well for any catalog size. If the owner outgrows the Starter plan and wants a full Shopify storefront with a custom theme, they can upgrade their plan — the Buy Button continues to work alongside or can be replaced with a full Shopify store link.

## Revenue tracking

After setup, the `/anglesite:add-store` skill deploys the ecommerce webhook worker for revenue tracking. If this skill was invoked directly (not via add-store), set up the Shopify webhook:

1. Deploy: `npx wrangler deploy --config worker/wrangler-ecommerce.toml`
2. Set secret: `npx wrangler secret put SHOPIFY_WEBHOOK_SECRET --config worker/wrangler-ecommerce.toml`
3. Register webhook in Shopify admin → Settings → Notifications → Webhooks → `orders/paid` → URL: `https://ecommerce-webhooks.<subdomain>.workers.dev/webhook/shopify`
