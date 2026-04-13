# Shopify Buy Button

**Used by:** Businesses with a full physical product catalog — retail, clothing, art, home goods, food, merchandise, any business with 10+ products that need inventory management.

## When to recommend

Shopify Buy Button is for larger catalogs that need a management dashboard. Recommend when:
- The owner sells physical goods with 10+ products (or a growing catalog)
- The owner needs inventory tracking, order management, and shipping configuration
- The owner wants a dashboard to manage products without touching code
- The owner already has a Shopify account

Don't recommend Shopify Buy Button for small catalogs under 10 items (use Snipcart — no monthly fee), digital goods (use Polar or Lemon Squeezy), services (use Stripe Payment Links), or software (use Paddle).

## Setup

1. Sign up for Shopify's Starter plan at shopify.com/starter ($5/month)
2. Add products in the Shopify admin — name, description, price, images, inventory
3. Configure shipping rates and tax settings
4. For each product to embed: go to **Products > [Product] > More actions > Embed on an external website**
5. Copy the embed code snippet (contains the store domain, storefront access token, and product ID)

The storefront access token is a public token (like Stripe's publishable key) — safe to include in site files.

## Pricing

Starting at $5/month (Starter plan). Transaction fees vary by plan: 5% on Starter, lower on higher plans. Shopify Payments (built-in) has standard credit card rates.

## Website integration

- **Use the `ShopifyBuyButton` component.** The template includes `src/components/ShopifyBuyButton.astro`. It loads the Shopify Buy Button SDK and renders a product card with cart functionality.
- **Products are managed in Shopify.** Unlike Snipcart (content files), Shopify products live in Shopify's admin. The component fetches product data from Shopify's Storefront API at render time.
- **Embed code parsing.** Use `parseShopifyEmbed()` from `scripts/shopify-buy-button.ts` to extract the domain, storefront access token, and product ID from Shopify's embed snippet.
- **CSP domains.** When `ECOMMERCE_PROVIDER=shopify` is set in `.site-config`, the CSP automatically includes `cdn.shopify.com` and `sdks.shopifycdn.com` (script-src), `cdn.shopify.com` (style-src, img-src), `*.myshopify.com` and `monorail-edge.shopifysvc.com` (connect-src).
- **Multiple products.** Each product gets its own `ShopifyBuyButton` component instance with a different `productId`. All share the same `domain` and `storefrontAccessToken`.

## Privacy note

Shopify is a third-party data processor for product display and checkout. Mention in the privacy policy: "Our product catalog and checkout are powered by Shopify (shopify.com). Payment is processed through Shopify Payments or the payment provider configured in our Shopify account. We do not store your payment information directly. Shopify's privacy policy applies to information you provide during checkout."

## Tips for the owner

- **Manage everything in Shopify admin.** Products, inventory, orders, shipping, and discounts are all managed at admin.shopify.com. No need to edit site files to update products.
- **Use high-quality product images.** Shopify serves optimized images automatically, but start with good source photos.
- **Set up shipping profiles.** Configure shipping rates by weight, price, or zone in Shopify's admin to give customers accurate shipping costs at checkout.
- **Enable abandoned cart recovery.** Shopify can email customers who added items to their cart but didn't complete checkout (available on higher plans).
- **Use the Shopify mobile app.** Manage orders, track inventory, and view sales from a phone.
