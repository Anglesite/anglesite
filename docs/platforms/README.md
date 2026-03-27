# Platform Best Practices

Setup guidance and integration tips for the SaaS platforms recommended across multiple business types. Reference for the webmaster agent — read the relevant platform file when the owner chooses a platform during `/anglesite:start` or `/anglesite:design-interview`. Not user-facing documentation.

Each SMB file recommends tools specific to that business type. These files cover the platforms that appear across many types — the ones the agent will set up most often. Industry-specific tools (Printavo, Jackrabbit Dance, PioneerRx, etc.) are covered only in their respective SMB files.

## Platform files

| File | When to read |
|---|---|
| [square.md](square.md) | Business takes payments, sends invoices, books appointments, or sells online |
| [google-business-profile.md](google-business-profile.md) | Any business with a physical location or service area |
| [cal-com.md](cal-com.md) | Business books appointments or consultations |
| [calendly.md](calendly.md) | Alternative to Cal.com — polished UI, well-known, good free tier |
| [buttondown.md](buttondown.md) | Business wants a mailing list (default recommendation) |
| [mailchimp.md](mailchimp.md) | Business already uses Mailchimp or needs 100–500 subscriber free tier |
| [ghost-newsletter.md](ghost-newsletter.md) | Migrating from Ghost/Substack with existing subscribers, or wants paid subscriptions or self-hosted email |
| [yelp.md](yelp.md) | Consumer-facing local business, especially services and food |
| [tripadvisor.md](tripadvisor.md) | Hospitality, tours, attractions, restaurants in tourist areas |
| [honeybook.md](honeybook.md) | Client-based business with proposals, contracts, and invoicing |
| [ko-fi.md](ko-fi.md) | Creators accepting tips, selling digital products, or offering memberships |
| [the-knot.md](the-knot.md) | Wedding-adjacent businesses |
| [stripe.md](stripe.md) | Business sells a service, accepts donations, or takes one-off payments via Payment Links |
| [polar.md](polar.md) | Digital product sales — downloads, templates, courses, memberships (default for digital) |
| [lemon-squeezy.md](lemon-squeezy.md) | Digital product sales — alternative to Polar, owner-preference driven |
| [snipcart.md](snipcart.md) | Small physical product catalog (under ~10 items), no dashboard needed |
| [shopify-buy-button.md](shopify-buy-button.md) | Full physical product catalog with inventory management dashboard |
| [paddle.md](paddle.md) | Software licensing, SaaS subscriptions, metered billing |

## Cross-platform tips

### Don't overload the owner

Most businesses need 2–3 platforms at most:
1. A payment/POS tool (Square)
2. A map listing (Google Business Profile)
3. One more based on their specific needs (booking, newsletter, reviews)

Don't recommend 6 platforms during `/anglesite:start`. Start with the essentials and add more as the business grows.

### Link, don't embed

Every platform offers embeddable widgets. Resist the temptation. Embedded third-party JavaScript:
- Slows the page
- Adds tracking (privacy cost)
- Breaks the CSP (security cost)
- Creates maintenance burden (widget APIs change)

A styled link or button to the platform's hosted page is simpler, faster, more private, and easier to maintain. The deploy gate in `/anglesite:deploy` blocks unauthorized third-party scripts — linking avoids this entirely.

### Privacy policy updates

When any platform is connected to the website, update the privacy policy to mention it as a data processor. See `docs/security.md` → Data handling and `docs/smb/legal-checklist.md` → Privacy policy.

### Keep platform info in sync

When business details change (hours, phone, address), update the website AND every connected platform. See `docs/smb/info-changes.md` for the full checklist.
