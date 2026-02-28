# Equipment & Party Rental

Covers: tool and equipment rental (construction, landscaping, moving), party and event rental (tents, tables, chairs, linens, inflatables, bounce houses, photo booths), heavy equipment rental, trailer rental, moving truck/van rental, costume rental, formal wear rental (tuxedos, gowns). See also [event-venue.md](event-venue.md) for venues that also provide rentals, and [entertainment.md](entertainment.md) for inflatable parks and permanent attractions.

## Pages

- **Rental catalog** — Everything available for rent, organized by category. Each item or item type needs: photo, description, capacity or specs, rental rate (hourly/daily/weekly/weekend), delivery available (yes/no), deposit required. Customers compare items and plan their order from this page.
- **Delivery and pickup** — Delivery area (list of towns or radius), delivery and setup fees, timeline (when do you deliver and pick up), site requirements (access width, ground surface for tents, power availability for inflatables). For heavy equipment: transport requirements and fees.
- **How it works** — The rental process from start to finish: browse catalog → request a quote or book online → confirm availability → delivery/pickup → setup (if included) → rental period → return/pickup → deposit refund. Explain deposit, damage, and cleaning policies clearly.
- **Packages** — Pre-built bundles for common events: "backyard birthday" (tent, tables, chairs, tablecloths), "graduation party" (tent, tables, chairs, stage, PA system), "wedding reception" (tent, dance floor, lighting, linens, place settings). Packages simplify the decision and increase average order value.
- **FAQ** — What if it rains? What if I damage something? Do you set up? Can I pick up instead of delivery? How far in advance should I book? Do I need a permit for a tent in my yard? These questions come up on every call — answer them on the website.
- **Gallery** — Photos of setups at real events. Show tents in backyards, tables with linens, bounce houses at birthday parties, equipment on job sites. Customers need to visualize what the rental looks like in context.
- **About** — Company history, team, fleet size, service area. If family-owned or long-established, say so — it's a trust signal. Photos of the warehouse and fleet.
- **Contact / quote request** — Phone, email, form. The quote request form should ask: event date, event type, estimated guest count, items interested in, delivery address, and any special needs. This form is the primary lead generator.

## Tools

- **Point of Rental** (pricing varies, proprietary) — Rental management software: inventory tracking, reservations, contracts, delivery scheduling, billing. The industry standard. point-of-rental.com
- **Rentman** (~$35/mo, proprietary) — Event and equipment rental management. Good for party rental specifically. rentman.io
- **EZRentOut** (~$50/mo, proprietary) — Equipment tracking, online booking, maintenance scheduling. For tool and equipment rental. ezo.io/ezrentout
- **Square** (free POS, 2.6% per transaction) — For walk-in rentals, deposits, and damage charges.
- **Google Business Profile** — Essential. People search "tent rental near me," "bounce house rental [town]," "equipment rental [area]."
- **Yelp** — Active for party rental in many markets.
- **The Knot / WeddingWire** — If the business does wedding rentals, listing here reaches brides and planners. theknot.com / weddingwire.com

## Compliance

- **Liability and insurance**: Rental businesses carry significant liability. Inflatable and bounce house rentals require commercial general liability insurance and often specific rider policies. Require signed rental agreements before every rental. Note on the website: "All rentals require a signed rental agreement."
- **Safety standards for inflatables**: ASTM F2374 covers the safe operation of inflatable amusement devices. Operators should be trained. Note weight limits, age restrictions, and supervision requirements on the website. Some states and municipalities require inflatable operators to be licensed or registered.
- **Tent permits**: Many municipalities require a permit for tents over a certain size (commonly 200–400 sq ft). The rental company often handles this for the customer. Note on the website: "We can assist with tent permits in most areas."
- **Equipment operation training**: For heavy equipment or power tool rentals, provide safety information and verify that the renter is qualified to operate the equipment. Some equipment (chainsaws, scaffolding, aerial lifts) may require certification.
- **Vehicle rental regulations**: If renting trucks, trailers, or vans, state motor vehicle rental regulations apply. Renters may need specific license classes, minimum age requirements, and insurance verification.
- **Sales tax on rentals**: Rental transactions are taxable in most states. Some states have specific rental tax rates distinct from sales tax. Verify with a tax advisor.
- **Damage and deposit policies**: Display clearly on the website: deposit amounts, damage assessment process, cleaning fees, late return fees, what constitutes normal wear vs. damage. Transparent policies reduce disputes.

## Content ideas

Event setup photos (with customer permission), seasonal rental promotions, event planning tips ("how many tables do you need for 50 guests?"), tent sizing guides, comparison posts (chiavari chairs vs. folding chairs, round tables vs. rectangular), behind-the-scenes of setup and teardown, new inventory announcements, customer testimonials and event recaps, safety tips for inflatables and equipment, holiday and seasonal event ideas, DIY event planning checklists, venue partnership spotlights, weather contingency planning tips.

## Key dates

- **Wedding season** (May–Oct) — The busiest period for party rental. Book early messaging starts in January.
- **Graduation season** (May–Jun) — Backyard party rentals: tents, tables, chairs, decorations.
- **Summer event season** (Jun–Aug) — Block parties, family reunions, corporate picnics, festivals.
- **Halloween** (Oct) — Costume rental, haunted house props, event decor.
- **Holiday party season** (Nov–Dec) — Corporate events, holiday parties, New Year's Eve.
- **Construction season** (Apr–Nov in northern climates) — Peak demand for equipment rental.

## Structured data

Use `LocalBusiness` with `additionalType` of `RentalStore` or relevant subtype:
- `name`, `address`, `telephone`
- `openingHours`
- `areaServed` — delivery area
- `hasOfferCatalog` — categories of rental items

For individual rental items, use `Product` with `offers` using `BusinessFunction` of `LeaseOut`:
- `name`, `description`, `image`
- `offers` with rental pricing

## Data tracking

- **Inventory:** Item Name, Category (Tent/Table/Chair/Linen/Inflatable/Equipment/Other), Quantity Owned, Quantity Available, Rental Rate (Day/Weekend/Week), Replacement Cost, Condition, Notes
- **Reservations:** Reservation Number, Customer, Event Date, Items Reserved, Delivery Address, Setup Required, Total, Deposit, Status (Pending/Confirmed/Delivered/Returned/Cancelled), Notes
- **Customers:** Name, Phone, Email, Address, Events (linked), Notes
