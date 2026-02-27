# Restaurant & Food Business

Covers: restaurants, cafés, coffee shops, bakeries, food trucks, catering, delis, ice cream shops, juice bars.

## Pages

- **Menu** — The #1 reason people visit a restaurant website. PDF menus are bad for SEO and mobile — use HTML. Update it when the menu changes.
- **Hours / location** — Include parking, transit, and "we're the one next to the blue awning" wayfinding. Display prominently — don't bury it.
- **About** — The story behind the food. Family history, chef background, sourcing philosophy. This is what differentiates from chains.
- **Catering / private events** — If offered. Separate page with menus, pricing guidance, and a contact form.
- **Gallery** — Food photos, interior, events. Real photos of real food — not stock photography.
- **Contact** — Phone (make it tappable), email, directions. Include a "call to order" CTA if they do takeout.

## Tools

- **Square** (free POS, 2.6% per transaction, proprietary) — Payments, online ordering, marketing. Free tier is generous and easy to start. square.com
- **Toast** (~$0–$69/mo + processing, proprietary) — Restaurant-specific POS with online ordering, delivery integration. More features but more complex. toasttab.com
- For reservations: consider whether the owner actually needs reservation software, or if a phone number and email work fine. Most small restaurants don't need Resy or OpenTable.
- **Google Business Profile** — Essential for "restaurants near me" searches. Free. Post menu updates and photos regularly.

## Compliance

- **Health department permits**: Required. Display permit number if required by jurisdiction. Link to latest inspection report if publicly available (builds trust).
- **Food allergen disclosure**: Many jurisdictions require allergen information. At minimum, add "Please inform your server of any allergies" to the menu page.
- **Alcohol licensing**: If serving alcohol, display license type and number if required. Some states restrict advertising drink specials online.
- **Nutritional information**: Required for chains (20+ locations) under FDA rules. Optional for small restaurants but helpful for customer trust.
- **ADA compliance**: Menu must be accessible (not image-only PDFs). Ensure the website is screen-reader friendly.

## Content ideas

New menu items, seasonal specials, behind-the-scenes photos, event announcements, chef spotlights, community involvement, recipes (shareable and brings search traffic), "meet the team" features, holiday hours announcements, catering highlights, customer features (with permission), food sourcing stories, local supplier spotlights.

## Key dates

No single industry awareness day dominates — restaurant hooks are spread throughout the year. The big revenue dates are Valentine's Day dinner (Feb 14), Mother's Day brunch (2nd Sun May), and holiday catering season (Nov–Dec). See `seasonal-calendar.md` for month-by-month hooks tagged `types: restaurant`.

## Structured data

Use `Restaurant` (or `CafeOrCoffeeShop`, `Bakery`, `BarOrPub`, `FastFoodRestaurant`) with:
- name, address, phone, `openingHoursSpecification`
- `servesCuisine`
- `priceRange`
- `hasMenu` (link to menu page)
- `acceptsReservations`

## Data tracking

- **Customers:** Name, Email, Phone, Type (Regular/Catering/Event), Dietary Notes, Source, Created Date
- **Events:** Name, Date, Type (Private Party/Catering/Holiday), Guest Count, Menu, Status, Notes
- **Catering:** Client (linked), Date, Menu, Guest Count, Delivery/Pickup, Total, Status
