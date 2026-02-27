# Farm & CSA

Covers: small farms, CSA (community-supported agriculture) programs, market gardens, u-pick operations, homesteads with direct sales, farm stands, flower farms, maple sugaring, Christmas tree farms, forest product operations. See also [event-venue.md](event-venue.md) for farms that host events, and [hospitality.md](hospitality.md) for farms with lodging.


## Pages

- **What we grow** — Products by season, growing practices (organic, no-spray, regenerative). Photos of the farm and produce. This is the page that builds trust.
- **CSA / subscriptions** — How the CSA works, share sizes, pricing, season dates, pickup locations, sign-up link. Make the commitment clear and approachable.
- **Farm stand / u-pick** — Hours, location, what's available now (update weekly during season), pricing
- **About** — The farmers, the land, the story, farming philosophy. People buy from farms they feel connected to.
- **Where to find us** — Farmers markets (days, locations, hours), retail partners, restaurants that carry your products
- **Blog** — Farm updates, what's in season, recipes, behind-the-scenes
- **Events** — Farm dinners, tours, workshops, u-pick days, seasonal festivals. If events are a major revenue stream, consider the full event-venue treatment — see [event-venue.md](event-venue.md).
- **Forest products** — If applicable: maple syrup (grades, sizes, bulk pricing, sugaring season dates), Christmas trees (varieties, choose-and-cut vs. pre-cut, hours during season), firewood (species, cord pricing, delivery area), mushrooms, wreaths, woodland crafts. These are often seasonal — the page should be clear about availability and pre-ordering.
- **Contact** — Phone, email, directions to the farm (many farms are hard to find — include landmarks)

## Tools

- **Open Food Network** (open source, nonprofit) — Online store for farms, food hubs, and CSAs. Community-run, no platform fees. openfoodnetwork.org
- **Local Line** (~$75/mo, proprietary) — Farm-specific online store with CSA management, delivery routes, and wholesale ordering. localline.ca
- **Harvie** (percentage of sales, proprietary) — CSA management with customizable shares. harvie.farm
- **Barn2Door** (~$79/mo, proprietary) — Farm e-commerce with delivery, pickup, and market integrations.
- **Square** (free POS, 2.6% per transaction) — Good for farm stand and farmers market sales.
- **Mailchimp** (free up to 500 contacts) or **Buttondown** (~$9/mo, indie) — For weekly "what's in the box" or "what's at market" emails. Buttondown is indie-run and respects privacy.
- Many small farms manage CSA with just a spreadsheet and email. If that's working and the operation is small (<30 members), don't overcomplicate it.

## Compliance

- **Organic certification**: Only use the word "organic" if USDA certified. Display the certification and certifier name. Farms grossing under $5,000/year are exempt from certification but must still follow organic practices to use the term.
- **Cottage food laws**: If selling value-added products (jams, baked goods, pickles), laws vary by state. Some allow direct-to-consumer sales without a commercial kitchen; others don't. Note any applicable permits.
- **Raw milk**: Heavily regulated and illegal to sell in many states. If the farm sells raw milk where legal, note the state's specific requirements and display required disclaimers.
- **Pesticide disclosure**: Some states require disclosure of pesticide use. Even without a legal requirement, transparency builds trust — note growing practices on the website.
- **Food safety (FSMA)**: The FDA's Food Safety Modernization Act exempts most small farms selling direct to consumers, but farms selling to retailers or institutions may need a food safety plan. Not a website concern, but worth noting during `/setup-customers` if the farm sells wholesale.
- **Liability for u-pick and farm visits**: If the public visits the farm, note any agritourism liability protections (many states have agritourism statutes) and display safety rules for visitors. Agritourism liability waivers are common but enforceability varies — consult an attorney. Post visitor rules prominently: closed-toe shoes, supervised children, stay on paths, no dogs near livestock.
- **Zoning and land use**: Agricultural zoning may not permit commercial activities beyond farming (events, retail shops, lodging). Check with the town or county planning office before building pages for non-agricultural activities. A special use permit or variance may be needed. This is the #1 surprise for farms adding tourism or events.
- **Insurance for visitor access**: Standard farm insurance may not cover public visitors. Agritourism riders, event liability coverage, and umbrella policies are worth discussing with an insurance agent. If hosting events, see [event-venue.md](event-venue.md) compliance for additional requirements.
- **State agricultural resources**: Every state has a Cooperative Extension Service (through land-grant universities) offering free advice on production, marketing, food safety, and regulations. Many states also have product-specific associations (maple producers, Christmas tree growers, farmers market associations) with marketing support, shared labeling, and group insurance. Search "[state] cooperative extension" and "[state] [product] association."

## Content ideas

Weekly harvest updates ("what's in the box this week"), seasonal planting and harvest photos, recipes using farm products, behind-the-scenes of farm life (people love this), farmers market schedule and what to expect, CSA sign-up reminders before the season, crop profiles ("why we grow this variety"), farm event announcements, preservation and storage tips, collaborations with local chefs or restaurants, end-of-season wrap-ups, winter planning posts, sugaring season updates (sap run reports, boiling photos, yield), Christmas tree farm prep and opening day, firewood stacking and delivery, forest walk and wildlife photos.

## Key dates

- **National Agriculture Day** (Mar) — Farm story, "where your food comes from" content, school visits.
- **Earth Day** (Apr 22) — Sustainable farming practices, soil health, environmental stewardship.
- **National Farmers Market Week** (1st full week Aug) — Market schedules, vendor spotlights, "meet your farmer" events.
- **World Food Day** (Oct 16) — Food access, community partnerships, harvest celebrations.

## Structured data

Use `LocalBusiness` with `additionalType` of `https://schema.org/Farm` (or just use the `@type` array `["LocalBusiness", "Farm"]`):
- name, address, phone
- `openingHours` for farm stand or u-pick hours
- `areaServed` for delivery area
- `hasOfferCatalog` for products

## Data tracking

- **Members:** Name, Email, Phone, Share Size, Pickup Location, Season, Status (Active/Waitlist/Past), Payment Status, Notes
- **Products:** Name, Category (Vegetable/Fruit/Herb/Flower/Value-Added/Forest/Maple), Season, Status (Available/Coming Soon/Done), Notes
- **Markets:** Name, Day, Location, Hours, Season, Notes
