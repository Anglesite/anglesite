# Reviews & Reputation

How to build, manage, and display reviews and testimonials. Reference for the webmaster agent — applied during `/anglesite:start`, `/anglesite:design-interview`, content planning, and ongoing maintenance. Not user-facing documentation.

For photo and testimonial consent requirements, see `docs/smb/legal-checklist.md` (item 4).

## Why reviews matter

Reviews are the #1 trust signal for local businesses. Most customers read reviews before calling, visiting, or booking. A business with 20 genuine reviews and a 4.3-star average will get more customers than one with no reviews and a better website.

The website's role is twofold:
1. **Display social proof** — Testimonials, review excerpts, and links to review profiles on the website itself
2. **Make reviewing easy** — Help customers find where to leave reviews

## Where reviews live

### Primary platforms by business type

Every business should claim Google Business Profile. Beyond that, the most impactful review platform varies:

| Business type | Primary review platforms |
|---|---|
| Restaurant, café, bakery, food truck | Google, Yelp, TripAdvisor (if tourist area) |
| Salon, barber, spa | Google, Yelp, booking platform (Fresha, Vagaro) |
| Trades (plumber, electrician, etc.) | Google, Nextdoor, Angi, HomeAdvisor |
| Healthcare, dental, veterinary | Google, Healthgrades, Zocdoc, Yelp |
| Legal, accounting | Google, Avvo (legal), Yelp |
| Auto repair, auto dealer | Google, Yelp, CarGurus/Cars.com (dealers) |
| Hospitality (B&B, hotel, vacation rental) | Google, TripAdvisor, Booking.com, Airbnb |
| Pet services | Google, Yelp, Rover (if applicable) |
| Fitness, yoga | Google, Yelp, ClassPass |
| Photography, videography | Google, The Knot/WeddingWire (if weddings) |
| Childcare | Google, Yelp, Winnie |
| Campground | Google, Hipcamp, The Dyrt, Campendium |
| Tattoo | Google, Yelp, Instagram (portfolio) |
| Roadside attraction | Google, TripAdvisor, Atlas Obscura, Roadtrippers |
| Farm, CSA | Google, farm-specific (LocalHarvest), word of mouth |
| Bookshop, retail | Google, Yelp, Bookshop.org (bookstores) |
| Event venue | Google, The Knot/WeddingWire, Yelp |

During `/anglesite:start` or `/anglesite:design-interview`, ask: "Where have your customers left reviews? Where would you like them to?" Focus on 1–2 platforms — don't spread thin.

## Getting reviews

### When to ask

The best time to ask for a review is right after a positive experience:

- After a completed service ("Thank you! If you have a minute, a Google review helps other people find us")
- After a successful event or visit
- After a customer says something positive in person or by email
- After resolving a problem well (people who had a problem fixed are often the most loyal advocates)

### How to ask

- **In person** — Simple and direct. "We're a small business and reviews really help. If you had a good experience, we'd appreciate a Google review."
- **Follow-up email** — After a service or purchase. Include a direct link to the review page (not just "find us on Google").
- **Printed card** — A small card with a QR code linking directly to the Google review page. Hand it to customers or include it with orders.
- **On the website** — A "Leave us a review" link on the contact or about page, linking directly to the review form.

### Google review link

The direct link to leave a Google review is:
```
https://search.google.com/local/writereview?placeid=PLACE_ID
```

Find the Place ID at: https://developers.google.com/maps/documentation/places/web-service/place-id

During `/anglesite:start`, if the owner has a Google Business Profile, find their Place ID and create a direct review link. Save it in `.site-config`:
```
GOOGLE_REVIEW_URL=https://search.google.com/local/writereview?placeid=ChIJ...
```

### What NOT to do

- **Don't offer incentives for reviews.** "Leave a review, get 10% off" violates the terms of service of every major review platform and is illegal under FTC guidelines. Reviews must be voluntary and uncompensated.
- **Don't review-gate.** Don't ask "Was your experience good?" and only direct happy customers to review. This creates artificially inflated ratings and violates platform policies.
- **Don't fake reviews.** Don't write reviews for the business, ask friends/family who aren't customers, or buy reviews. Platforms detect this and the consequences are severe (listing suspension, legal action).
- **Don't ask for a specific rating.** "Leave us a 5-star review" is pressure. "Leave us an honest review" is appropriate.

## Responding to reviews

### Positive reviews

Respond to every positive review. Keep it short, genuine, and specific:

- Thank them by name
- Reference something specific about their experience if possible
- Don't be generic ("Thank you for your kind words!" repeated 50 times looks robotic)

### Negative reviews

Negative reviews are inevitable and not catastrophic. A business with only 5-star reviews looks suspicious. How the owner responds matters more than the review itself.

**Do:**
- Respond promptly (within a few days)
- Be professional and empathetic
- Acknowledge the problem, even if you disagree
- Take the conversation offline ("We'd like to make this right — please call us at [number]")
- Fix the underlying problem if there is one

**Don't:**
- Argue publicly
- Get defensive or sarcastic
- Accuse the reviewer of lying
- Offer compensation publicly (this invites more negative reviews seeking freebies)
- Ignore it — silence looks like indifference

**Template for a difficult review:**
"Thank you for letting us know about your experience. We take this seriously and want to make it right. Please contact us directly at [phone/email] so we can address this."

### Fake or malicious reviews

If the owner receives a review that's clearly fake (from someone who was never a customer, from a competitor, or contains threats):

- **Google:** Flag the review through Google Business Profile → Reviews → Flag as inappropriate. Google's process is slow (days to weeks). If it's clearly a policy violation, persistence helps.
- **Yelp:** Use the "Report Review" feature. Yelp's filter is aggressive — some legitimate reviews get filtered too.
- **Other platforms:** Each has its own reporting process.

Don't respond to obviously fake reviews with anger. A calm, factual response ("We don't have a record of your visit — please contact us so we can look into this") lets other readers draw their own conclusions.

## Displaying reviews on the website

### Testimonials section

During `/anglesite:design-interview`, ask: "Do you have positive reviews or customer testimonials you'd like to show on the website?"

Display options:
- **Home page** — 2–3 short, strong quotes with attribution. Builds trust immediately.
- **Dedicated testimonials page** — If the business has many testimonials (photography, trades, services).
- **Service-specific** — A testimonial about plumbing on the plumbing page, about electrical on the electrical page.

**Format:**
```
"[Quote — keep it brief, one or two sentences, in the customer's own words.]"
— [Name], [City/Context if relevant]
```

**Always get permission** before displaying a review on the website. Even if it's a public Google review, re-posting it on the website is different. A quick text or email asking "Can we feature your review on our website?" is enough. See `docs/smb/legal-checklist.md` → Photo and testimonial consent.

### Review links

On the contact page or in the footer, include links to the business's review profiles:

- "See our reviews on Google" (link to Google Business Profile)
- "Read reviews on Yelp" (link to Yelp business page)
- "Leave us a review" (link to Google review form)

Don't embed live review widgets from third-party services — they add tracking scripts and slow the page. Static testimonials chosen by the owner are more trustworthy and more private.

### Structured data for reviews

If displaying testimonials on the website, add `Review` structured data:

```json
{
  "@type": "Review",
  "author": { "@type": "Person", "name": "Customer Name" },
  "reviewBody": "The review text",
  "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
}
```

Nest these inside the `LocalBusiness` structured data as the `review` property. This may enable review stars in search results — but only use real reviews from real customers. Fabricated structured data reviews violate Google's guidelines.

## Monitoring

During monthly `/anglesite:check`, ask the owner:

- "Have you checked your Google reviews recently? Any new ones to respond to?"
- "Have you gotten any feedback — good or bad — that we should address on the website?"

If the business is new, reviews take time. Reassure the owner: 10–15 genuine reviews over the first year is normal for a small business. Quality matters more than quantity.
