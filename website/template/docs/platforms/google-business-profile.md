# Google Business Profile

**Used by:** Every business with a physical location or service area. The most impactful single action for local discoverability.

## Setup during `/anglesite:start` or `/anglesite:deploy`

Ask: "Have you claimed your business on Google?" If not, walk them through:

1. Go to business.google.com
2. Search for the business name (it may already exist from Google's data)
3. Claim or create the listing
4. Verify ownership (phone, email, postcard, or video — Google decides the method)
5. Complete the profile fully

## What to fill out

Every field matters for search ranking. Don't skip any:

- **Business name** — Exact legal name. Don't add keywords ("Best Pizza Springfield" — just "Joe's Pizza").
- **Category** — Primary category is the most important. Add secondary categories for other services. Be specific: "Italian restaurant" beats "restaurant."
- **Address** — Exact match to the website's address (NAP consistency — see `docs/webmaster.md`).
- **Service area** — For businesses that go to customers (trades, cleaning, mobile detailing). List specific cities or ZIP codes.
- **Hours** — Regular hours, special hours for holidays, seasonal hours. Update before every holiday. Inaccurate hours generate negative reviews faster than anything else.
- **Phone** — Primary business phone. Must match the website.
- **Website** — Link to the website. This is the #1 referral source for most local businesses.
- **Description** — 750 characters. What the business does, who it serves, what makes it different. Include the city/area name naturally. No keyword stuffing.
- **Photos** — The single biggest impact on click-through. Upload at least 5–10: storefront/exterior, interior, products/services, the team, action shots. Update photos quarterly. Listings with photos get significantly more engagement.
- **Products/services** — List specific offerings with descriptions and prices where appropriate.
- **Attributes** — Accessibility, payment methods, amenities (WiFi, parking, outdoor seating). Every relevant attribute should be set.

## Ongoing maintenance

During monthly `/anglesite:check`:
- "Have you checked your Google reviews this month?" (see `docs/smb/reviews.md`)
- "Are your hours still accurate?"
- "Any new photos to add?"

During quarterly review:
- Post a Google update (like a mini blog post on the profile)
- Verify information is still accurate
- Check insights: how many people found the business, what they searched for, what actions they took

## Common mistakes

- **Duplicate listings** — If the business moved or changed names, old listings may still exist. Search for the business and claim/merge/delete duplicates.
- **Inconsistent NAP** — Name, address, and phone must be identical on the website, Google, Apple Maps, and everywhere else. "123 Main St" vs. "123 Main Street" is an inconsistency that hurts rankings.
- **Ignoring reviews** — Respond to every review, positive and negative. See `docs/smb/reviews.md`.
- **Not using Posts** — Google Business Profile has a "Posts" feature for updates, events, and offers. Most businesses don't use it. It's free visibility.
