# Paddle

**Used by:** Software developers, SaaS businesses, plugin/theme sellers — anyone selling software licenses, subscriptions, or metered-billing products.

## When to recommend

Paddle is the default for software and SaaS sales. Recommend when:
- The owner sells software, a desktop app, or a browser extension
- The owner offers SaaS subscriptions (monthly/annual billing)
- The owner needs license key management
- The owner needs metered or usage-based billing
- The owner sells internationally and needs tax compliance handled for software sales

Don't recommend Paddle for simple digital downloads like ebooks or templates (use Polar or Lemon Squeezy — simpler and lower fees), physical goods (use Snipcart or Shopify), or services and donations (use Stripe Payment Links).

## Setup

1. Create an account at paddle.com
2. Complete business verification (Paddle requires business details for Merchant of Record status)
3. Create a product in the Paddle dashboard
4. Create a price for the product (one-time, recurring, or metered)
5. Go to **Developer Tools > Authentication** and copy the **client-side token** (starts with `test_` for sandbox or `live_` for production)
6. Copy the **price ID** from the product's pricing page (starts with `pri_`)

Both the client-side token and price ID are public values — safe to include in site files.

## Pricing

5% + 50¢ per transaction. No monthly fee. Paddle acts as Merchant of Record — they handle global tax compliance (VAT, sales tax, GST) for software sales in every jurisdiction.

## Website integration

- **Use the `PaddleCheckout` component.** The template includes `src/components/PaddleCheckout.astro`. It loads Paddle.js and opens a checkout overlay when the visitor clicks the button.
- **Sandbox and production auto-detected.** The component reads the token prefix (`test_` vs `live_`) and loads the corresponding Paddle.js URL and environment. Both sandbox and production domains are included in the CSP so testing works without config changes.
- **CSP domains.** When `ECOMMERCE_PROVIDER=paddle` is set in `.site-config`, the CSP automatically includes `cdn.paddle.com` and `sandbox-cdn.paddle.com` (script-src), `checkout.paddle.com` and `sandbox-checkout.paddle.com` (frame-src), and `log.paddle.com` (connect-src).
- **Multiple products.** Each product gets its own `PaddleCheckout` component with a different `priceId`. All share the same `clientToken`.

## Privacy note

Paddle is a third-party data processor for checkout and subscription management. Mention in the privacy policy: "Software purchases and subscriptions are processed by Paddle (paddle.com), which acts as our Merchant of Record. Paddle handles payment processing, subscription billing, and tax compliance. Their privacy policy applies to information you provide during checkout."

## Tips for the owner

- **Start with sandbox mode.** Use a `test_` client-side token to test the full checkout flow with test card numbers before going live.
- **Switch to live when ready.** Replace the `test_` token with a `live_` token in `.site-config`. The price ID stays the same if set up in both environments.
- **Manage subscriptions in the Paddle dashboard.** View subscribers, handle cancellations, issue refunds, and track MRR at vendors.paddle.com.
- **License keys.** If selling software licenses, configure Paddle to generate license keys automatically on purchase. Deliver them via email or the Paddle checkout success page.
- **Paddle vs. Polar.** If the owner is selling simple digital downloads without subscriptions or license management, Polar is simpler and has lower fees (4% vs 5% + 50¢). Paddle is the right choice for recurring billing, license keys, and complex pricing (tiers, add-ons, per-seat).
