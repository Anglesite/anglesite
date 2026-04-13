# Bookshop

Covers: independent bookstores, used bookshops, comic book stores, rare/antiquarian book dealers.

## Pages

- **New arrivals** — Weekly or monthly picks. This is the page that brings people back.
- **Events** — Author readings, book clubs, signings, story time, workshops. Events are a bookshop's biggest differentiator from online retailers.
- **Staff picks / recommendations** — Personal curation is why people shop indie. One page or a recurring blog series.
- **About** — The shop's story, the people behind it, the community role
- **Hours / location** — With parking, transit, neighborhood info
- **Services** — Special orders, gift wrapping, book clubs, subscriptions, gift cards
- **Blog** — Reviews, reading lists, event recaps, industry news
- **Contact** — Phone, email, social links

Don't try to replicate a full online catalog. The website's job is to get people into the shop or calling to order — not to compete with Amazon's inventory system.

## Design

**Visual mood:** Literary, warm, and inviting. The site should feel like stepping into a well-loved bookshop — rich textures, curated shelves, a sense of discovery.

**Color direction:** Rich wood tones, deep greens, burgundy, and cream. Warm and grounded. Avoid bright primaries or anything that feels like a tech company.

**Typography feel:** Classic stack (Georgia) for headings — bookish and literary. Pair with a readable body font. Let the serif do the work.

**Layout emphasis:** Staff picks and upcoming events above the fold — these are what bring people in and back. Pattern 2 (hero + content) for the home page, Pattern 4 (card grid) for staff picks and new arrivals. Max-width 56rem.

**Photography style:** Cozy interior shots, book displays, reading nooks, event photos. Show the space, not just the product. 4:3 aspect ratio for consistency.

**Key component:** Staff pick card — book cover image, title, author, and a brief staff recommendation. Personal curation is the indie bookshop's superpower; the card format makes it scannable and shareable.

## Tools

- **Bookmanager** or **IndieLite** — Industry-specific POS and inventory. Most indie bookshops already use one. Don't replace it.
- **Square** (free POS, proprietary) — Good fallback if they don't have a POS yet. Handles in-person and simple online sales.
- **Bookshop.org affiliate** — Lets customers order online through the indie bookshop's affiliate link. The shop earns a commission. No inventory management needed.
- **IndieBound** — American Booksellers Association directory. Help the owner claim or update their listing.
- **Eventbrite** (free for free events) or **Cal.com** (open source) — For event RSVPs.

## Review platforms

- **Google Business Profile** — "Bookstores near me" and "used bookstore [city]" are common searches. The profile is also where people check holiday hours before a special trip. Keep it current with photos and respond to reviews.
- **Yelp** — Many indie bookshop regulars use Yelp and leave detailed reviews about the curation, staff, and experience — the qualities that differentiate an indie shop from Amazon. Worth claiming and maintaining.
- **Bookshop.org** — The indie bookstore's online sales platform also functions as a directory. Customers who buy through a shop's Bookshop.org affiliate page often leave ratings, and the shop's presence on the platform signals community commitment to indie bookselling.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **ISBN and publisher relationships**: Not a website concern, but if the shop wants to sell online, they'll need proper distribution channels. Link to Bookshop.org rather than building a storefront.
- **Sales tax**: Applies to book sales in most US states. The POS handles this, not the website.
- **Accessibility**: Mention physical accessibility (wheelchair access, seating for readings). Important for event pages.

## Content ideas

Staff picks with personal reviews, monthly reading lists by theme or mood, event announcements and recaps, author Q&As, "what we're reading this month" posts, seasonal gift guides, local author spotlights, book club selections and discussion guides, behind-the-scenes of running a bookshop, banned books week features, indie bookstore day promotions.

## Key dates

- **Independent Bookstore Day** (last Sat Apr) — The biggest day for indie bookstores. Exclusive editions, events, community celebration.
- **World Book Day** (Apr 23) — Reading promotions, staff picks, literacy awareness.
- **Banned Books Week** (last week Sep) — Intellectual freedom displays, reading lists, community conversations.
- **National Book Month** (Oct) — Author events, reading challenges, gift guide previews.

## Structured data

Use `BookStore` with:
- name, address, phone, hours
- `event` for upcoming author events (optional)

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Customer/Author/Publisher/Vendor), Notes, Created Date
- **Events:** Name, Date, Author (linked to Contacts), Type (Reading/Signing/Book Club/Workshop), RSVP Count, Notes
