# Webmaster Best Practices

## Before every deploy

Run `/anglesite:check` for the full health check (build, accessibility, privacy, security, SEO, performance). The deploy command also runs mandatory privacy and security gates.

## What the owner can do without a developer

- **Write and edit blog posts** — Keystatic at `https://DEV_HOSTNAME/keystatic` while the preview is running (read `DEV_HOSTNAME` from `.site-config`)
- **Publish changes** — Type `/anglesite:deploy`
- **Check site health** — Type `/anglesite:check`
- **Fix problems** — Type `/anglesite:fix` (diagnoses and repairs common issues)

Everything else (new pages, design changes, custom features) the webmaster handles through conversation.

## Accessibility is not optional

The site must be usable by people with disabilities. This is legally required in many jurisdictions (ADA in the US, EAA in the EU) and it's the right thing to do. The `/anglesite:check` and `/anglesite:deploy` commands enforce WCAG AA compliance. Never skip these checks.

## Maintenance schedule

**Monthly**
- Run `/anglesite:check` to verify site health
- Glance at Cloudflare Analytics — are visitors finding the site? (see `docs/measuring-success.md`)
- Check for new Google reviews and respond (see `docs/smb/reviews.md`)
- Verify business info is current on website and map listings (see `docs/smb/info-changes.md`)

**Quarterly**
- Run `/anglesite:update` to get security patches and dependency updates
- Review blog posts — is the content still accurate and relevant?
- Quick competitor scan — any changes in the local landscape? (see `docs/smb/competitor-awareness.md`)
- Review analytics trends and check goals (see `docs/measuring-success.md`)

**Annually**
- Renew domain registration (Cloudflare sends email reminders)
- Consider refreshing the design if the brand has evolved
- Review all costs — any unused paid tools? (see `docs/cost-of-ownership.md`)
- Verify map listings are still claimed and accurate

## Local SEO

For businesses with a physical location:

### NAP consistency

Key details must be consistent everywhere (website, map listings, social media, directories):
- **N**ame — exact business name
- **A**ddress — exact street address
- **P**hone — primary phone number

Search engines cross-reference these to verify the business is legitimate. Inconsistencies (abbreviations, old phone numbers, wrong suite number) hurt rankings.

### Map listings

Customers find local businesses through maps. Each platform draws from different audiences — claim all three:

- **Google Business Profile** — business.google.com. Free. Powers Google Maps and "near me" searches. The most impactful listing for most businesses. Post updates, add photos, respond to reviews.
- **Apple Business Connect** — businessconnect.apple.com. Free. Powers Apple Maps results on iPhone, iPad, Mac, Siri, and CarPlay. iPhone users are roughly half the US market — if the business isn't on Apple Maps, it's invisible to those customers. Claim the listing and verify hours, photos, and categories.
- **OpenStreetMap** — openstreetmap.org. Community-maintained, open data. Powers many apps and services (DuckDuckGo, Bing Maps, many in-car systems, hiking/cycling apps). Anyone can add or edit a business. Search for the business — if it's missing or wrong, edit it. No account required for small edits; create a free account for ongoing updates.

Ask the owner: "Have you claimed your business on Google Maps, Apple Maps, and OpenStreetMap?" Most know about Google but haven't heard of Apple Business Connect.

### Structured data

The home page includes JSON-LD structured data (`LocalBusiness` or `Organization` schema) with the business name, address, phone, and hours. This helps search engines understand the business and display rich results.

Update the JSON-LD whenever the business info changes (new phone number, new hours, new address). Validate with:
- **Schema.org Validator** — validator.schema.org (vendor-neutral, checks schema.org compliance)
- **Google Rich Results Test** — search.google.com/test/rich-results (checks Google-specific rich result eligibility)
- **Bing Markup Validator** — bing.com/webmasters/markup-validator (checks Bing-specific rendering)
