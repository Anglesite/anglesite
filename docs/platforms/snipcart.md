# Snipcart

**Used by:** Small businesses selling physical goods with a small catalog — handmade items, art, merchandise, food products, clothing, crafts.

## When to recommend

Snipcart is the default for small physical product catalogs. Recommend when:
- The owner sells physical goods (not digital downloads or services)
- The catalog is small — roughly 1 to 10 products
- The owner doesn't need a full inventory management dashboard
- The owner wants products managed as content files alongside the rest of the site

Don't recommend Snipcart if the owner needs inventory tracking, shipping rate calculations, or a management dashboard (use Shopify Buy Button). Don't recommend it for digital goods (use Polar or Lemon Squeezy) or services (use Stripe Payment Links).

## Setup

1. Create an account at app.snipcart.com/register (free to sign up)
2. Go to **Account > Credentials** and copy the public API key (starts with `ST_...` or `NjM...`)
3. Set the website URL in Snipcart's domain settings so checkout validation works
4. Configure shipping options and tax settings in the Snipcart dashboard

The public API key goes in the site's HTML. The secret key stays with Snipcart — never store it in the project.

## Pricing

2% per transaction + Stripe payment processing fees (2.9% + 30¢). No monthly fee. If the store makes less than $500/month, Snipcart charges a minimum $13/month.

## Website integration

- **Products are content files.** Each product is a `.mdoc` file in `src/content/products/` managed via Keystatic. The `SnipcartProduct` component renders product cards with Snipcart's `data-item-*` attributes.
- **Cart and checkout are Snipcart-hosted.** Snipcart injects a cart overlay and checkout flow. The customer stays on the site.
- **Three resources load from Snipcart.** The integration adds `snipcart.js`, `snipcart.css`, and a hidden `#snipcart` container. These are approved in ADR-0008 and the CSP allowlist.
- **CSP domains.** When `ECOMMERCE_PROVIDER=snipcart` is set in `.site-config`, the CSP automatically includes `cdn.snipcart.com` (script-src, style-src) and `app.snipcart.com` (connect-src, frame-src).
- **Product validation.** Snipcart crawls each product's URL to verify prices match. Every product needs a publicly accessible page at `products/<slug>` — this is why individual product pages are generated.

## Privacy note

Snipcart is a third-party data processor for cart and checkout transactions. Mention in the privacy policy: "Shopping cart and checkout are powered by Snipcart (snipcart.com). Payment is processed through Stripe via Snipcart. We do not store your payment information. Snipcart's privacy policy applies to information you provide during checkout."

## Tips for the owner

- **Add product images.** Products with photos sell better. Use `scripts/optimize-images.ts` to resize and convert to WebP before adding.
- **Set weights for shipping.** If using weight-based shipping rates, set the `weight` field on each product (in grams).
- **Manage orders in the Snipcart dashboard.** View orders, process refunds, and download invoices at app.snipcart.com/dashboard.
- **Test with test mode.** Snipcart has a test/live toggle. Use test mode with Stripe test cards before accepting real payments.
- **Keep the catalog small.** Snipcart works best for under ~10 products. If the catalog grows, consider migrating to Shopify Buy Button for inventory management.
