# Cost of Ownership

What the website costs to run, now and ongoing. Reference for the webmaster agent — shared with the owner during `/anglesite:start` (Step 7) and `/anglesite:deploy`, and revisited during annual maintenance. Not user-facing documentation.

## The basics (already covered in `/anglesite:start`)

The owner hears this during initial setup:

- **Building the website:** Free (the owner already has an AI coding tool)
- **Hosting:** Free (Cloudflare Pages, unlimited bandwidth)
- **SSL/HTTPS:** Free (Cloudflare, automatic)
- **Analytics:** Free (Cloudflare Web Analytics, cookieless)
- **Custom domain:** ~$10–15/year (the only required cost)
- **The owner owns everything:** Code, content, domain. No platform lock-in.

This section expands on costs the owner may encounter over time.

## Required ongoing costs

| Item | Cost | Frequency | Notes |
|---|---|---|---|
| Domain name | $10–15/year | Annual (auto-renew) | Cloudflare sells at cost, no markup. `.com` is ~$10. Some TLDs cost more. |
| iCloud+ (if using custom email) | $0.99–$12.99/month | Monthly | Most Mac users already have this. Includes custom email domain, iCloud storage, and iCloud Private Relay. |

Total minimum: **~$10/year** (domain only, if the owner has iCloud+ already).

## Optional costs by need

These come up as the business grows or the owner wants specific features. Present them when relevant — not all at once.

### Email at the business domain

If the owner wants `name@business.com` instead of a personal email:

| Provider | Cost | Notes |
|---|---|---|
| iCloud+ (custom domain) | $0.99/month (included with existing subscription) | Best option for Mac users. Most already pay for iCloud+. |
| Proton Mail | Free (1 address) or $4/month (custom domain) | Privacy-focused, encrypted. Good for privacy-conscious owners. |
| Fastmail | $5/month | Independent, reliable. Good for owners who want simplicity. |
| Google Workspace | $7/month | If they already use Gmail. Most expensive and least privacy-friendly. |

### Booking and scheduling

If the business needs online booking:

| Tool | Cost | Notes |
|---|---|---|
| Square Appointments | Free (1 staff) | Good for salons, services, trades. Paid plans for multiple staff. |
| Calendly | Free (1 event type) | Good for consultants, professional services. |
| Platform-specific | Varies | Many SMB files recommend industry-specific tools. Check the relevant SMB file. |

### E-commerce / online ordering

If the business sells products or takes orders online:

| Tool | Cost | Notes |
|---|---|---|
| Square Online | Free (basic) + 2.9% per transaction | Good for retail, restaurants, farms. |
| Shopify Starter | $5/month + 5% per transaction | Lighter than full Shopify. Good for simple product sales. |
| Platform-specific | Varies | Local Line for farms, Barn2Door for farms, etc. Check the SMB file. |

### Email marketing

If the business sends newsletters or email updates:

| Tool | Cost | Notes |
|---|---|---|
| Buttondown | Free (up to 100 subscribers) or $9/month | Indie-run, privacy-respecting. Recommended. |
| Mailchimp | Free (up to 500 contacts) | Larger free tier but increasingly aggressive upselling. |

### Professional services

These aren't website costs, but owners ask about them:

| Service | Typical cost | When needed |
|---|---|---|
| Custom photography | $200–1,000 (one-time) | When the owner needs professional photos for the site. A good investment — real photos outperform stock. |
| Logo design | $200–2,000 (one-time) | If the business doesn't have a logo. Freelancers on Fiverr start around $50; local designers cost more but understand the market. |
| Copywriting | $200–1,000 (one-time) | If the owner struggles to write their own content. Usually not needed — the webmaster agent helps with this. |

## What the owner is NOT paying for

This is a differentiator worth mentioning during `/anglesite:start`:

- **No monthly hosting fee** — Squarespace charges $16–65/month. Wix charges $17–159/month. Cloudflare Pages is free.
- **No platform fee** — No percentage of sales to a website platform.
- **No designer/developer retainer** — The owner manages the site themselves with Claude Code.
- **No SEO subscription** — The site is built with SEO best practices. No monthly SEO service needed.
- **No maintenance contract** — `/anglesite:check` and `/anglesite:update` handle maintenance.
- **No migration fee** — The owner owns all the code and content. They can move to any host at any time.

Over 3 years, a typical Squarespace site costs $576–2,340 in platform fees alone. An Anglesite site costs ~$30–45 (domain renewals).

## When costs grow

As the business grows, the owner may need paid tools. Present these as natural steps, not upsells:

- **More than one email address** — Upgrade iCloud+ or switch to Fastmail/Proton paid plan.
- **Online payments** — Add Square or Stripe. Transaction fees (2.6–2.9%) are the cost.
- **More storage** — If the site grows to hundreds of images. Cloudflare Pages has generous limits, but very large sites may need image optimization or Cloudflare R2 storage ($0.015/GB/month for storage beyond 10GB free).
- **Multiple team members** — Cloudflare allows multiple members on a free account. No cost increase.
- **Higher traffic** — Cloudflare Pages handles traffic spikes gracefully. No cost increase for traffic.

## Annual cost review

During the annual maintenance check (see `docs/webmaster.md` → Maintenance schedule):

- "Is your domain set to auto-renew? Is the payment method current?"
- "Are you paying for any tools you're not using?" (Common: a booking platform they signed up for but never activated, a newsletter service with zero subscribers)
- "Has anything changed that means you need a new tool?" (Started taking online orders, added a second staff member, want to send newsletters)

Keep costs low and transparent. The owner should always know what they're paying for and why.
