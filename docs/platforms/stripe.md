# Stripe

**Used by:** Any business selling a service, accepting donations, or taking one-off payments — consulting, design, photography, coaching, nonprofits, trades.

## When to recommend

Stripe Payment Links are the default for non-digital, non-catalog sales. Recommend when:
- The owner sells a service or single offering (not a catalog of physical goods)
- The owner wants to accept donations or tips
- The owner needs a simple "pay now" button with no cart or inventory

Don't recommend Stripe Payment Links if the owner needs a shopping cart (use Snipcart), a product catalog dashboard (use Shopify), or sells digital goods with file delivery (use Polar or Lemon Squeezy).

## Setup

1. Create a Stripe account at stripe.com (free — no monthly fee)
2. Complete identity verification (required before accepting live payments)
3. Go to **Stripe Dashboard > Payment Links > Create payment link**
4. Set the product name, price, and description
5. Click **Create link** and copy the URL (looks like `https://buy.stripe.com/...`)

No API keys are needed on the website. The Payment Link is a hosted checkout page — the customer leaves the site to pay and returns afterward.

## Pricing

2.9% + 30¢ per successful transaction. No monthly fee, no setup fee.

## Website integration

- **Use the `BuyButton` component.** The template includes `src/components/BuyButton.astro` — a styled `<a>` tag that links to the Payment Link URL. No JavaScript, no CSP changes needed.
- **No third-party scripts.** Stripe Payment Links are external redirects. The customer checks out on Stripe's hosted page, not on the site. This means zero CSP impact and no pre-deploy scan entries.
- **Place buttons in context.** Put the buy button near the service description, pricing section, or call-to-action area — not floating in isolation.
- **Customize the button label.** "Book Now", "Pay Now", "Donate", "Get Started" — match the label to the action.

## Privacy note

Stripe processes payment data on their hosted checkout page. The website never handles card numbers. Mention in the privacy policy: "Payments are processed by Stripe (stripe.com). We do not store your payment information. Stripe's privacy policy applies to information you provide during checkout."

## Tips for the owner

- **Use descriptive product names.** "60-Minute Design Consultation" is better than "Service" — the customer sees this on the checkout page and their bank statement.
- **Set up email receipts.** Stripe sends automatic receipts. Make sure the business name and contact info are correct in Stripe settings.
- **Test with test mode first.** Stripe has a test mode toggle in the dashboard. Create a test Payment Link to verify the flow before going live.
- **Track payments in the Stripe Dashboard.** All transactions, refunds, and disputes are managed at dashboard.stripe.com.
