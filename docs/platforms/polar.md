# Polar

**Used by:** Creators and businesses selling digital products — downloads, templates, presets, ebooks, courses, fonts, icons, memberships, software licenses.

## When to recommend

Polar is the default for digital product sales. Recommend when:
- The owner sells downloadable files (PDFs, templates, presets, fonts, icons)
- The owner sells courses or educational content
- The owner offers memberships or subscriptions for exclusive content
- The owner needs automatic file delivery after purchase
- The owner sells internationally and needs tax compliance handled

Don't recommend Polar if the owner sells physical goods (use Snipcart or Shopify), services or donations (use Stripe Payment Links), or software with complex subscription/licensing needs (use Paddle).

## Setup

1. Create an account at polar.sh (free — no monthly fee)
2. Create a new product — set name, price, and description
3. If selling a file, upload it to the product (Polar delivers it automatically after purchase)
4. Go to the product page and copy the **checkout URL** (looks like `https://buy.polar.sh/...`)

No API keys are needed on the website. The checkout URL powers the overlay.

## Pricing

4% + payment processing fees per transaction. No monthly fee. Polar acts as Merchant of Record — they handle global VAT and sales tax on the owner's behalf.

## Website integration

- **Use the `PolarCheckout` component.** The template includes `src/components/PolarCheckout.astro` — it renders a link with `data-polar-checkout` that opens a checkout overlay on the current page. The customer stays on the site during purchase.
- **One script tag.** The component loads `cdn.polar.sh/embed/buy-button.js` with `defer` and `data-auto-init`. This is approved in ADR-0008 and the CSP allowlist.
- **CSP domains.** When `ECOMMERCE_PROVIDER=polar` is set in `.site-config`, the CSP automatically includes `cdn.polar.sh` (script-src), `api.polar.sh` (connect-src), and `buy.polar.sh` (frame-src).
- **Theme support.** The component accepts a `theme` prop ("light" or "dark") to match the site design.

## Privacy note

Polar is a third-party data processor for checkout transactions. Mention in the privacy policy: "Digital product purchases are processed by Polar (polar.sh), which acts as our Merchant of Record. Polar handles payment processing, file delivery, and tax compliance. Their privacy policy applies to information you provide during checkout."

## Tips for the owner

- **Set up file delivery.** Polar can automatically deliver files after purchase — upload them when creating the product. No need to email files manually.
- **Use the Polar dashboard.** Manage products, view orders, track revenue, and handle refunds at polar.sh/dashboard.
- **Consider offering pay-what-you-want.** Polar supports flexible pricing — useful for open-source projects, creative works, or community-supported content.
- **International sales are handled.** Polar calculates and remits VAT/sales tax for every country. The owner doesn't need to register for tax in other jurisdictions.
