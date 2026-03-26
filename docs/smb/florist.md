# Florist

Covers: flower shops, floral design studios, wedding/event florists, plant shops, garden centers that sell arrangements.

## Pages

- **Shop / arrangements** — Categories: everyday, sympathy, romance, birthday, get well, new baby, holidays. Photos of actual arrangements (not stock). Price ranges visible.
- **Weddings & events** — Portfolio of past events, consultation process, pricing structure (packages vs. custom), timeline, what to expect. This is where the margin is — make it compelling.
- **Delivery** — Delivery area (map or zip code list), same-day cutoff time, delivery fees, contactless option. Delivery zone is one of the first things customers check.
- **About** — The designer's story, philosophy, sourcing (local farms, sustainable practices). Floral design is personal — let the personality show.
- **Subscriptions** — Weekly/monthly flower subscriptions for homes or offices. Recurring revenue.
- **Plants** — Houseplants, succulents, orchids, plant care. Growing category.
- **Sympathy & funeral** — Standing sprays, casket pieces, arrangements for services. Sensitive, clear, and easy to order quickly.
- **Contact / order** — Phone (people call for sympathy orders especially), order form, walk-in hours.

## Design

**Visual mood:** Beautiful, natural, and romantic. The site should feel like receiving flowers — delightful, fresh, and personal.

**Color direction:** Soft, botanical palette — blush, sage green, cream, soft pink, lavender. Let the floral photography provide the color pops. Avoid harsh or saturated tones that compete with the arrangements.

**Typography feel:** Classic stack (Georgia) for headings — elegant and timeless. Pairs naturally with botanical imagery.

**Layout emphasis:** Arrangement gallery and order CTA above the fold — visitors are here to see flowers and place orders. Pattern 4 (card grid) for the arrangement gallery. Max-width 56rem.

**Photography style:** Beautiful floral photography with natural light is everything. This is a visual business — the photos do the selling. 1:1 aspect ratio for the arrangement grid, 4:5 for feature images.

**Key component:** Arrangement card — photo, arrangement name, occasion or style tag, starting price, and an "Order" button. Clean, shoppable, and beautiful.

## Tools

- **Floranext** (~$50+/mo, proprietary) — Florist POS, website, delivery management, wire service integration. floranext.com
- **Details Flowers** (~$20+/mo, proprietary) — Floral design software: proposals, recipes, cost tracking. For wedding/event florists. detailsflowers.com
- **Square** (free POS, proprietary) — Good for walk-in sales, simple inventory.
- **Wire services** (FTD, Teleflora, BloomNation) — Incoming orders from national networks. High commission fees (20–30%). Many independents are leaving wire services — if they have, that's worth mentioning on the about page as a value statement.
- **Cal.com** (open source, free tier) — Wedding consultations.

## Compliance

- **Sales tax**: Varies by state. Some states tax flowers, some don't. Delivery fees may be taxed separately.
- **Delivery liability**: Note that you're not responsible for flowers left at the door, weather damage after delivery, etc. Terms and conditions for delivery.
- **Wire service contracts**: If participating, understand exclusivity and commission terms. Not a website compliance issue, but impacts business operations.
- **Pesticide/chemical**: If selling plants, note any treatment disclosures required in your state.
- **ADA**: Online ordering must be accessible — form labels, alt text on arrangement photos.

## Review platforms

- **Google Business Profile** — The primary discovery channel for "florist near me," "same-day flower delivery [city]," and "wedding florist [area]." Reviews here are read by people placing time-sensitive orders — keep the profile current and respond to every review. Positive reviews specifically mentioning delivery reliability or sympathy orders are especially valuable.
- **Yelp** — Used by customers comparing florists, especially for everyday and gift purchases. Yelp reviewers tend to describe the arrangement quality, value, and delivery experience in detail.
- **The Knot / WeddingWire** — For florists doing wedding work, these platforms are where couples actively search. Reviews from past brides carry significant weight in the wedding market.

See `docs/smb/reviews.md` for full review management guidance.

## Content ideas

Seasonal arrangement spotlights, flower care tips ("how to make your bouquet last"), behind-the-scenes of event setups, "flower of the month," sourcing stories (local farm partnerships), wedding trend recaps, sympathy etiquette guides, houseplant care, DIY arrangement tutorials, holiday ordering deadlines.

## Key dates

- **Valentine's Day** (Feb 14) — #1 revenue day. Pre-orders, delivery schedules, arrangement showcases. Lead time: 3 weeks.
- **National Floral Design Day** (Feb 28) — Behind-the-scenes, designer spotlights, arrangement process content.
- **Mother's Day** (2nd Sun May) — #2 revenue day. Pre-order push, gift guides, delivery planning. Lead time: 3 weeks.
- **Petal It Forward** (3rd Wed Oct) — SAF-sponsored. Give flowers to strangers, community goodwill, social media engagement.

## Structured data

Use `Florist` (schema.org) with:
- name, address, phone, hours
- `areaServed` for delivery zone
- `hasOfferCatalog` for arrangement categories

## Data tracking

- **Orders:** Customer Name, Phone, Email, Occasion, Items, Delivery Address, Delivery Date, Status (Received/Designing/Out for Delivery/Delivered), Total, Notes
- **Events:** Client Name, Event Date, Venue, Type (Wedding/Corporate/Memorial), Consultation Date, Proposal Sent, Status, Budget, Notes
