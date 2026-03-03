# Square

**Used by:** Nearly every business type with in-person transactions. POS, invoicing, appointments, online store, gift cards, loyalty programs.

## What to recommend

Square has many products. Match the owner's needs — don't set up everything:

| Product | Free tier | When to recommend |
|---|---|---|
| Square POS | Free (2.6% + $0.10 per tap/swipe) | Any business taking in-person payments |
| Square Online | Free (2.9% + $0.30 per transaction) | Simple online ordering or product sales |
| Square Appointments | Free for 1 staff | Salons, services, trades, healthcare — anyone booking time slots |
| Square Invoices | Free | Trades, services, photography — anyone billing after the fact |
| Square Loyalty | Paid add-on | Repeat-visit businesses: cafés, car washes, salons |
| Square Gift Cards | Per-card cost | Any business that sells gift cards |

## Website integration

- **Link, don't embed.** Square's online store and booking pages work best as linked pages, not iframes. Add a clear CTA on the website ("Book an appointment" or "Order online") that links to the Square-hosted page.
- **Keep the branding consistent.** Square allows logo, colors, and cover photo customization. Set these up during `/anglesite:design-interview` to match the website design.
- **No third-party scripts.** Linking to Square (rather than embedding their JavaScript widget) keeps the website clean and avoids CSP issues. The deploy gate won't flag an external link.

## Privacy note

Square processes payment data under their own PCI compliance. The website doesn't handle card numbers. If Square is used, mention it in the privacy policy: "Payments are processed by Square. We do not store your payment information."

## Tips for the owner

- **Set up the items/services catalog first.** Square's POS, online store, and invoicing all draw from the same catalog. Getting it right once saves time.
- **Turn on email receipts.** Builds a customer list organically.
- **Use Square Dashboard on mobile.** The owner can track sales, manage appointments, and respond to invoices from their phone.
