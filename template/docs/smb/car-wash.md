# Car Wash & Detailing

Covers: automatic car washes (tunnel and in-bay), self-serve car washes, hand wash, express detailing, full detailing (interior and exterior), mobile detailing, ceramic coating, paint correction, window tinting, fleet washing. See also [repair.md](repair.md) for auto repair shops and [auto-dealer.md](auto-dealer.md) for dealerships.

## Pages

- **Services and pricing** — Every wash and detail package with: what's included, price, duration. Organize from basic to premium. Clear tiered pricing: "Express Wash $10 → Premium Wash $18 → The Works $25." For detailing: interior only, exterior only, full detail, with add-ons (ceramic coating, headlight restoration, engine cleaning). Photos of results at each tier help customers choose.
- **Unlimited / membership plans** — If offered: monthly unlimited wash plans with pricing, what's included, how it works (RFID tag, app, license plate recognition), cancellation policy. This is increasingly the primary revenue model for modern car washes. Feature it prominently — it's the highest-value conversion. "Unlimited washes starting at $20/month."
- **Hours and location** — Hours of operation, address, map. For self-serve: note that bays are accessible 24/7 if applicable. For tunnel washes: note peak times to avoid and best times to visit. Multiple locations get individual pages.
- **Mobile detailing** — If offered: service area, how to book, where the detailer works (driveway, parking lot, office), what the customer needs to provide (power outlet, water access — or "we bring everything"), pricing, estimated duration.
- **Fleet services** — If offered: fleet washing programs, volume pricing, scheduling, on-site vs. at the wash, vehicles serviced (cars, trucks, vans, buses, equipment). Contact form specifically for fleet inquiries.
- **Gallery** — Before-and-after photos are the most effective content for detailing. Show the transformation. For car washes: photos of the facility, equipment, and the experience. Clean, modern facility photos build trust.
- **About** — Business history, the team, equipment and products used, environmental practices (water reclamation, biodegradable soaps). "Family-owned and operated" is a differentiator from chain washes.
- **Gift cards** — Available in-store and online. Promote for holidays, Father's Day, birthdays. Note denominations or custom amounts.
- **Contact** — Phone, email, address. For mobile detailing: booking form with vehicle type, location, preferred date/time, services requested.

## Design

**Visual mood:** Bold, shiny, satisfying. The site should feel like the moment you drive away in a gleaming car. High-impact visuals, clean lines, and a sense of premium quality — even for a $10 wash.

**Color direction:** High contrast — deep blue, black, or red as the base with chrome or silver accents. White text on dark hero sections. The palette should evoke shine and polish. Accent color for CTAs (buy a wash, join membership) should pop aggressively.

**Typography feel:** Modern stack (system-ui sans-serif). Bold headings (700) for package names and pricing. Clean, confident, easy to read at a glance — customers are often on their phone in the parking lot deciding which wash to buy.

**Layout emphasis:** Wash packages and pricing above the fold. Make it dead simple to compare tiers and pick one. Membership plan featured prominently. Use Pattern 2 (hero + content) for home with a gleaming car photo, Pattern 4 (card grid) for service tiers. Max-width 60rem.

**Photography style:** Before/after car shots for detailing. Gleaming results, water beading on paint, the "after" moment. Facility exterior showing a clean, modern operation. 16:9 for hero images, 4:3 for results and facility photos.

**Key component:** Wash package cards — tier name (e.g., "Express," "Premium," "The Works"), bullet list of what's included, price, and a visual upsell to the next tier. Cards side by side for easy comparison, with the recommended tier highlighted.

## Tools

- **Washify** (pricing varies, proprietary) — Car wash management: unlimited plan management, POS, license plate recognition, customer tracking, mobile app. washify.com
- **DRB Systems** (pricing varies, proprietary) — Tunnel car wash management: POS, RFID, license plate recognition, membership management. drb.com
- **EverWash** (revenue share, proprietary) — Membership management platform. Adds unlimited wash subscriptions to existing washes. everwash.com
- **Square** (free POS, 2.6% per transaction) — For single wash payments, detailing invoices, gift cards.
- **Urable** (~$30/mo, proprietary) — Detailing business management: scheduling, invoicing, CRM. Designed for mobile and shop detailers. urable.com
- **Google Business Profile** — Essential. People search "car wash near me" and "auto detailing [town]." Keep hours current, especially holiday hours.
- **Yelp** — Active for car washes and detailing in most markets.

## Compliance

- **Environmental regulations**: Car washes must manage wastewater. In most jurisdictions, wash water cannot flow into storm drains — it must go to a sanitary sewer or be captured and treated. Many states require a wastewater discharge permit. Note environmentally responsible practices on the website: "We reclaim and recycle our water" or "Our wastewater goes to the sanitary sewer, not storm drains."
- **Water use permits**: Some areas restrict water use, especially during droughts. Commercial car washes may need a water use permit. Self-serve washes that recirculate water may qualify for exemptions.
- **Chemical handling**: Cleaning chemicals (acids, alkalines, solvents) must be stored and used according to OSHA and EPA regulations. Safety data sheets (SDS) must be available. Not a website concern, but affects operational compliance.
- **Business licensing**: Standard business license requirements. Some municipalities have specific car wash or detailing licensing.
- **Sales tax**: Car wash and detailing services are taxable in most states.
- **Signage and zoning**: Car wash signage (pricing signs, directional signs) may need permits. Drive-through car washes have specific zoning requirements. Self-serve washes in residential-adjacent areas may face noise restrictions on hours.
- **ADA compliance**: Accessible facilities: payment kiosks, vacuum stations, entrance/exit. Self-serve bays accessible to wheelchair users.
- **Insurance**: General liability, property insurance, garage keeper's liability (covers damage to customers' vehicles while in your care). Mobile detailers need commercial auto insurance and liability coverage for working on client property.

## Content ideas

Before-and-after detailing photos (the best content for this business), seasonal car care tips ("protect your paint this winter," "spring pollen removal"), new service or product announcements, membership plan promotions, fleet program spotlights, employee spotlights, facility upgrades, environmental practices ("how we save water"), customer car spotlights (classic cars, custom vehicles — with permission), holiday gift card promotions, referral program announcements, tips for maintaining a clean car between washes, product recommendations for DIY maintenance, community events and sponsorships, rainy day humor ("bring it in after the rain — you still need a wash").

## Key dates

- **Spring** (Mar–May) — Post-winter wash season. Salt, sand, and grime removal. The busiest period in northern climates. Promote salt damage prevention and underbody wash.
- **Pollen season** (Apr–Jun, varies by region) — Pollen removal promotion. "Your car called. It needs help."
- **Father's Day** (3rd Sunday in Jun) — Gift card and detail package promotion.
- **Summer road trip season** (Jun–Aug) — Pre-trip detailing, road trip prep packages.
- **Back to school** (Aug–Sep) — "Start the school year with a clean car." College drop-off detailing.
- **Holiday gift season** (Nov–Dec) — Gift cards, detail packages as gifts, corporate fleet year-end washes.
- **Valentine's Day** (Feb 14) — "Show your car some love." Unexpected but effective promotion.

## Structured data

Use `LocalBusiness` with `additionalType` of `AutoWash`:
- `name`, `address`, `telephone`
- `openingHours`
- `priceRange`
- `hasOfferCatalog` — wash packages with pricing
- `paymentAccepted`

For membership plans, use `Service` with `offers`:
- `name`, `description`, `price`, `billingPeriod` (monthly)

## Data tracking

- **Membership plans:** Plan Name, Price (Monthly), Washes Included, Add-ons, Active Members, Notes
- **Fleet accounts:** Company, Contact, Phone, Email, Vehicle Count, Service Frequency, Rate, Status (Active/Inactive), Notes
- **Detail appointments:** Date, Customer, Vehicle (Year/Make/Model/Color), Service, Price, Status (Booked/In Progress/Completed/Cancelled), Notes
