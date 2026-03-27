# Lemon Squeezy

**Used by:** Creators and businesses selling digital products — downloads, templates, presets, ebooks, courses, software, memberships. Alternative to Polar.

## When to recommend

Lemon Squeezy is an alternative to Polar for digital product sales. Recommend when:
- The owner explicitly asks for Lemon Squeezy
- The owner already has a Lemon Squeezy account
- The owner prefers Lemon Squeezy's dashboard or feature set over Polar
- The owner sells digital goods and wants a Merchant of Record to handle tax

Don't recommend Lemon Squeezy over Polar by default — Polar has lower fees (4% vs 5% + 50¢) and is more indie-web-aligned. Offer Lemon Squeezy as an alternative during the `/anglesite:add-store` intake flow.

## Setup

1. Create an account at lemonsqueezy.com (free — no monthly fee)
2. Create a new store (if not already done during signup)
3. Create a new product — set name, price, and description
4. If selling a file, upload it to the product (Lemon Squeezy delivers it after purchase)
5. Go to the product's **Share** settings and copy the **checkout URL** (looks like `https://my-store.lemonsqueezy.com/buy/...`)

No API keys are needed on the website. The checkout URL powers the overlay.

## Pricing

5% + 50¢ per transaction. No monthly fee. Lemon Squeezy acts as Merchant of Record — they handle global VAT and sales tax on the owner's behalf.

## Website integration

- **Use the `LemonSqueezyCheckout` component.** The template includes `src/components/LemonSqueezyCheckout.astro` — it renders a link with `data-lemonsqueezy` that opens a checkout overlay on the current page.
- **One script tag.** The component loads `assets.lemonsqueezy.com/lemon.js` with `defer`. This is approved in ADR-0008 and the CSP allowlist.
- **CSP domains.** When `ECOMMERCE_PROVIDER=lemonsqueezy` is set in `.site-config`, the CSP automatically includes `assets.lemonsqueezy.com` (script-src), `api.lemonsqueezy.com` (connect-src), and `*.lemonsqueezy.com` (frame-src).
- **Theme support.** The component accepts a `theme` prop ("light" or "dark") to match the site design.

## Privacy note

Lemon Squeezy is a third-party data processor for checkout transactions. Mention in the privacy policy: "Digital product purchases are processed by Lemon Squeezy (lemonsqueezy.com), which acts as our Merchant of Record. Lemon Squeezy handles payment processing, file delivery, and tax compliance. Their privacy policy applies to information you provide during checkout."

## Tips for the owner

- **Set up file delivery.** Lemon Squeezy can automatically deliver files after purchase — upload them when creating the product.
- **Use the dashboard.** Manage products, view orders, track revenue, and handle refunds at app.lemonsqueezy.com.
- **Lemon Squeezy is now part of Stripe.** It operates as a separate product with its own dashboard and pricing, but benefits from Stripe's payment infrastructure.
- **International sales are handled.** Lemon Squeezy calculates and remits VAT/sales tax for every country as Merchant of Record.
- **License keys are built in.** If selling software, Lemon Squeezy can generate and manage license keys automatically.
