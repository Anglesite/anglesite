---
name: snipcart
description: "Set up Snipcart ecommerce for a small physical product catalog"
allowed-tools: Write, Read, Edit, Glob, Bash(npm run build), Bash(npx astro check)
user-invokable: false
---

Set up Snipcart ecommerce for selling physical goods with a small catalog (under ~10 products). Snipcart adds a full shopping cart with no monthly fees (2% per transaction + Stripe fees). Products are managed as content files via Keystatic; Snipcart handles cart, checkout, and payment.

This skill is invoked by `/anglesite:add-store` when the owner is selling physical goods with a small catalog and no dashboard needed.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Snipcart is a sanctioned exception; CSP and pre-deploy scan are already configured
- [ADR-0009 Industry tools first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — use Snipcart rather than building custom cart logic

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Prerequisites

- Site must be deployed at least once (`CF_PROJECT_NAME` set in `.site-config`)
- Owner must have a Snipcart account and API key (public key only — never store the secret key)

## Step 1 — Collect Snipcart API key

Ask the owner:

> "To set up your store, I need your Snipcart public API key. You can find it at https://app.snipcart.com/dashboard/account/credentials — it starts with something like `ST_...` or `NjM...`. This is the public key that goes in your site's HTML; your secret key stays with Snipcart."

If the owner doesn't have a Snipcart account:

> "No problem! You can sign up at https://app.snipcart.com/register — there's no monthly fee, just 2% per transaction. Come back when you're set up."

Exit gracefully. Do not write any files.

Save the API key to `.site-config`:

```
SNIPCART_API_KEY=<public-api-key>
```

## Step 2 — Create the products content collection

If `src/content/products/` doesn't exist, the products collection schema is already in `keystatic.config.ts` and `src/content.config.ts` (added by the template). Create the directory:

```
src/content/products/
```

## Step 3 — Add products

Ask the owner about their products:

> "Tell me about your products — for each one I need the name, price, a short description, and optionally a weight (for shipping). You can also provide product images if you have them."

For each product, create a content file at `src/content/products/<slug>.mdoc` with frontmatter:

```yaml
name: Leather Bag
description: Handmade full-grain leather messenger bag
price: 4500
image: /images/products/leather-bag.webp
imageAlt: Brown leather messenger bag on wooden table
weight: 450
order: 1
```

## Step 4 — Create the product listing page

Create `src/pages/products/index.astro` that lists all products using the `SnipcartProduct` component:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import SnipcartProduct from '../../components/SnipcartProduct.astro';
import { getCollection } from 'astro:content';

const products = (await getCollection('products'))
  .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));

const siteUrl = Astro.site?.origin ?? '';
---
<BaseLayout title="Products" description="Browse our products">
  <main>
    <h1>Products</h1>
    <div class="product-grid">
      {products.map((product) => (
        <SnipcartProduct
          id={product.id}
          name={product.data.name}
          price={product.data.price}
          url={`${siteUrl}/products/${product.id}`}
          description={product.data.description}
          image={product.data.image}
          imageAlt={product.data.imageAlt}
          weight={product.data.weight}
        />
      ))}
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

## Step 5 — Create individual product pages

Create `src/pages/products/[id].astro` for Snipcart's product validation (each product needs a crawlable URL):

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import SnipcartProduct from '../../components/SnipcartProduct.astro';
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const products = await getCollection('products');
  return products.map((product) => ({
    params: { id: product.id },
    props: { product },
  }));
}

const { product } = Astro.props;
const { Content } = await product.render();
const siteUrl = Astro.site?.origin ?? '';
---
<BaseLayout title={product.data.name} description={product.data.description}>
  <main>
    <article class="product-detail">
      {product.data.image && (
        <img
          src={product.data.image}
          alt={product.data.imageAlt || product.data.name}
          class="product-hero"
          loading="lazy"
        />
      )}
      <h1>{product.data.name}</h1>
      <div class="product-content">
        <Content />
      </div>
      <SnipcartProduct
        id={product.id}
        name={product.data.name}
        price={product.data.price}
        url={`${siteUrl}/products/${product.id}`}
        description={product.data.description}
        image={product.data.image}
        weight={product.data.weight}
        buttonLabel="Add to Cart"
      />
    </article>
  </main>
</BaseLayout>
```

## Step 6 — Inject Snipcart script

Add the Snipcart preconnect, stylesheet, and script to `src/layouts/BaseLayout.astro` in the `<head>`:

```html
<link rel="preconnect" href="https://app.snipcart.com">
<link rel="stylesheet" href="https://cdn.snipcart.com/themes/v3.7.1/default/snipcart.css">
<script async src="https://cdn.snipcart.com/themes/v3.7.1/default/snipcart.js"></script>
```

Add the Snipcart hidden container just before `</body>`:

```html
<div hidden id="snipcart" data-api-key="SNIPCART_API_KEY"></div>
```

Read the API key from `.site-config` and inject it.

## Step 7 — Add cart button to navigation

Add a cart summary button to the site header or navigation:

```html
<button class="snipcart-checkout" aria-label="Shopping cart">
  Cart (<span class="snipcart-items-count">0</span>)
</button>
```

## Step 8 — Update CSP and pre-deploy scan

The CSP headers (`public/_headers`) and pre-deploy allowlist (`scripts/pre-deploy-check.ts`) already include Snipcart domains from the template. Verify they're present:

- `cdn.snipcart.com` in `script-src`, `style-src`, and pre-deploy `allowedScripts`
- `app.snipcart.com` in `connect-src` and `frame-src`

If the owner added a booking widget or other providers that modified the CSP, ensure Snipcart domains are still present.

## Step 9 — Save configuration

Save to `.site-config`:

```
ECOMMERCE_PROVIDER=snipcart
SNIPCART_API_KEY=<public-api-key>
```

## Step 10 — Verify

Run `npm run build` to ensure the site builds cleanly with Snipcart.

Tell the owner:

> "Your store is set up! Visitors can browse your products, add them to their cart, and check out — all without leaving your site. Snipcart handles the payment securely.
>
> To manage orders, check your Snipcart dashboard at https://app.snipcart.com/dashboard.
>
> Want to preview it?"

If the build fails, diagnose and fix before presenting.

## Adding more products later

When the owner asks to add a product, create a new `.mdoc` file in `src/content/products/` with the product frontmatter. The listing page and individual product page are generated automatically.

## Scaling guidance

When reviewing the store or adding products, assess whether the owner may benefit from upgrading to Shopify Buy Button. Use the upgrade assessment logic in `scripts/ecommerce-upgrade.ts`:

1. **Count products** — count `.mdoc` files in `src/content/products/`
2. **Check revenue** — if the ecommerce webhook worker is deployed, query Analytics Engine using `buildRevenueQuery()` from `scripts/ecommerce-revenue.ts` to get actual monthly revenue
3. **Assess** — call `assessUpgrade({ provider: "snipcart", productCount, monthlyRevenueCents, monthlyOrderCount })` with the data gathered
4. **Present** — if an upgrade is recommended, use `formatUpgradeMessage()` to tell the owner in plain English. If revenue data is available, include the cost comparison.

Upgrade thresholds (from `UPGRADE_THRESHOLDS`):
- **10+ products** — the catalog has outgrown Snipcart's simple model. Shopify gives them inventory management, order tracking, and a dashboard.
- **~$15K+/month revenue** — at this volume, Shopify's dashboard and fulfillment tools justify the $39/month fee.

If the owner is not ready to switch, acknowledge that and move on. Never pressure — just surface the information.

> Example message when recommending an upgrade:
>
> "Your store has grown to [N] products — nice! At this size, Shopify gives you a dashboard to manage orders, track inventory, and handle shipping. Snipcart charges 2% per sale with no monthly fee; Shopify charges $39/month plus 2.9% + 30¢ per sale. At your current volume of ~$[X]/month, that works out to [comparison]. Want me to help you migrate?"
