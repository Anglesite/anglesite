# Hardware & Home Improvement

Covers: independent hardware stores, lumber yards, garden centers, paint stores, home improvement centers.

## Pages

- **Departments / what we carry** — Categories with descriptions. Not a full inventory — highlight depth, specialty items, and what sets the shop apart from big-box stores.
- **Services** — Key cutting, paint mixing, screen repair, blade sharpening, tool rental, delivery, custom cutting. Services are the indie hardware store's biggest advantage.
- **About** — Store history, family/community roots, expertise. Many indie hardware stores have been around for decades — that's a story worth telling.
- **Hours / location** — With parking, loading dock access if applicable
- **Staff expertise** — Highlight knowledgeable staff. "Ask us anything" is the indie hardware value proposition.
- **Blog** — How-to guides, seasonal projects, product spotlights
- **Events / workshops** — DIY classes, product demos, kids' build days
- **Contact** — Phone (people call hardware stores constantly), email

## Tools

- **Epicor (formerly Eagle)** or **Paladin POS** — Hardware-specific POS with inventory and vendor management. Most established stores already use one.
- **Square** (free POS, proprietary) — Good for smaller shops without industry POS.
- **Do it Best**, **Ace**, **True Value** — If the store is part of a buying cooperative, they may have co-op-provided tools for inventory and ordering. Integrate with the website rather than replacing.
- **Cal.com** (open source, free tier) — For scheduling delivery or consultation appointments.

## Compliance

- **Hazardous materials**: If selling paints, solvents, propane, pesticides, etc., display any required safety or handling information.
- **Sales tax**: Handled by POS, not the website.
- **Contractor licensing**: The store doesn't need a contractor license, but if they recommend contractors, note that recommendations are informational (not endorsements).
- **ADA**: Note physical accessibility — important for a store with heavy products and wide aisles.

## Content ideas

Seasonal project guides ("winterize your home," "spring garden prep"), how-to articles for common repairs, product comparisons and recommendations, new product spotlights, staff expertise highlights ("meet our paint expert"), workshop and event announcements, local contractor tips, holiday gift guides for DIYers, community project spotlights.

## Structured data

Use `HardwareStore` with:
- name, address, phone, hours
- `hasOfferCatalog` for key departments/services

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Customer/Contractor/Vendor), Notes, Created Date
- **Services:** Name, Description, Price (if fixed), Notes
