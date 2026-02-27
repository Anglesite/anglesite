# Restaurant & Food Business

Covers: restaurants, cafés, coffee shops, bakeries, catering, delis, ice cream shops, juice bars, home bakers, cottage food businesses. See also [food-truck.md](food-truck.md) for food trucks and mobile food vendors — their discovery model is fundamentally different (schedule-driven, not address-driven).

## Pages

- **Menu** — The #1 reason people visit a restaurant website. PDF menus are bad for SEO and mobile — use HTML. Update it when the menu changes.
- **Hours / location** — Include parking, transit, and "we're the one next to the blue awning" wayfinding. Display prominently — don't bury it.
- **About** — The story behind the food. Family history, chef background, sourcing philosophy. This is what differentiates from chains.
- **Catering / private events** — If offered. Separate page with menus, pricing guidance, and a contact form.
- **Gallery** — Food photos, interior, events. Real photos of real food — not stock photography.
- **Contact** — Phone (make it tappable), email, directions. Include a "call to order" CTA if they do takeout.
- **Custom orders** — If the business takes custom orders (decorated cookies, custom cakes, catering). Include: what they make, lead time ("order 2–3 weeks ahead"), price ranges or "request a quote" form, order form or inquiry form collecting event date, theme, quantity, dietary needs, design inspiration. Show past work organized by occasion (weddings, birthdays, holidays, corporate).
- **Shipping** — If they ship products (cookies, sauces, packaged goods). Shipping policy, turnaround time, zones/costs, packaging details, seasonal restrictions (e.g., chocolate in summer). Set expectations: "Shipped items are packaged for freshness — here's what to expect."

## Tools

- **Square** (free POS, 2.6% per transaction, proprietary) — Payments, online ordering, marketing. Free tier is generous and easy to start. square.com
- **Toast** (~$0–$69/mo + processing, proprietary) — Restaurant-specific POS with online ordering, delivery integration. More features but more complex. toasttab.com
- For reservations: consider whether the owner actually needs reservation software, or if a phone number and email work fine. Most small restaurants don't need Resy or OpenTable.
- **Map listings** — Essential for "restaurants near me" searches. Claim the business on Google Business Profile, Apple Business Connect, and OpenStreetMap. Post menu updates and photos regularly. See `docs/webmaster.md` → Map listings.

## Compliance

- **Health department permits**: Required for commercial kitchens. Display permit number if required by jurisdiction. Link to latest inspection report if publicly available (builds trust).
- **Cottage food laws**: Home bakers and makers of shelf-stable foods (cookies, breads, jams, candy) can often sell without a commercial kitchen under state cottage food laws. Requirements vary widely by state — check the specific state's rules. Common requirements:
  - Revenue caps (typically $25K–$75K/year, some states unlimited)
  - Labeling: "Made in a home kitchen that is not inspected by [state department of health]"
  - Ingredient and allergen listing on labels
  - Restricted to shelf-stable products (no dairy fillings, no items needing refrigeration in most states)
  - Direct-to-consumer sales only (no wholesale in most states)
  - Ask the owner: "Are you baking from home or from a commercial kitchen?" If home, search "[state] cottage food law" for specific requirements. Note the path forward: cottage food → renting time in a commercial kitchen → own commercial space.
- **Food allergen disclosure**: Many jurisdictions require allergen information. At minimum, add "Please inform us of any allergies" to the menu or order page.
- **Alcohol licensing**: If serving alcohol, display license type and number if required. Some states restrict advertising drink specials online.
- **Nutritional information**: Required for chains (20+ locations) under FDA rules. Optional for small restaurants but helpful for customer trust.
- **ADA compliance**: Menu must be accessible (not image-only PDFs). Ensure the website is screen-reader friendly.

## Content ideas

New menu items, seasonal specials, behind-the-scenes photos, event announcements, chef spotlights, community involvement, recipes (shareable and brings search traffic), "meet the team" features, holiday hours announcements, catering highlights, customer features (with permission), food sourcing stories, local supplier spotlights.

**Video content** — Food businesses thrive on video. Process videos (decorating, plating, cooking), order reveals, packaging and shipping, "day in the life." TikTok and Instagram Reels are the primary discovery channels for food businesses — short-form video drives more traffic than any other content type. The website hosts the permanent version (blog post with embedded video or gallery); social gets the clip. During `/start`, ask if they create video content and plan the site to feature it.

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
