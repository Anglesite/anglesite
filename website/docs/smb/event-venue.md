# Event Venue

Covers: barn venues, estate venues, garden venues, retreat centers, conference spaces, community event halls, private event spaces on farms or estates. See also [hospitality.md](hospitality.md) if the venue also offers overnight lodging, and [farm.md](farm.md) for working farms that host events.

The business model: the property IS the product. Customers rent the space for their event — the venue provides the setting, and usually coordinates with outside vendors for catering, photography, flowers, etc.

## Pages

- **The venue** — Photos are everything. Professional photography of the space in different seasons, lighting conditions, and event configurations. Show the venue empty AND set up for events. Include capacity, layout options (ceremony site, reception area, cocktail hour space), indoor/outdoor availability, and a rain/weather backup plan for outdoor venues.
- **Events we host** — Weddings, corporate retreats, family reunions, birthday parties, memorial services, nonprofit galas, holiday parties. Be specific about what kinds of events work in the space. If you don't host certain events (e.g., concerts, events over 200 people), say so.
- **Pricing / packages** — Tiered packages are standard: ceremony only, reception only, full day, multi-day. Include what's included at each tier (tables, chairs, setup/cleanup time, parking, restrooms, bridal suite, sound system, lighting). Pricing can be "starting at $X" or "request a quote" — but give enough detail that couples can self-qualify before reaching out.
- **Availability** — A calendar showing available dates. Even a simple "2026 dates available — inquire" is better than nothing. Weekends book 12–18 months ahead for weddings.
- **Vendors** — A preferred vendor list: caterers, photographers, florists, DJs, officiants, rental companies, bakers. This is valuable to customers AND builds referral partnerships with vendors. Note if vendors are required, preferred, or open (customer brings their own).
- **Gallery** — Real event photos (with permission from couples/clients). Organize by event type or season. Before/after or setup process photos show the transformation.
- **FAQ** — Address the practical questions every customer has: parking capacity, nearest lodging, accessibility, noise curfew, alcohol policy (BYOB? licensed bar? caterer handles it?), setup/teardown time, weather backup, generator/power availability, cell service, restroom facilities.
- **About** — The property's story, the people behind it, what makes the space special. For barn venues: the barn's history. For estates: the grounds and gardens. Customers choose venues emotionally — the story matters.
- **Contact** — Phone, email, booking inquiry form. Include a "schedule a tour" CTA — venue tours are the primary conversion step.

## Tools

- **HoneyBook** (~$19/mo, proprietary) — Client management, proposals, contracts, invoices. Popular with wedding and event venues. honeybook.com
- **Dubsado** (~$20/mo, proprietary) — Similar to HoneyBook. Workflows, scheduling, invoicing. Good for multi-step booking processes. dubsado.com
- **17hats** (~$15/mo, proprietary) — Simpler alternative. Quotes, contracts, invoicing.
- **Square** (free invoicing) — If they don't need a full CRM, Square handles invoicing and deposits.
- **Cal.com** (open source, free tier) — For scheduling venue tours. cal.com
- **The Knot / WeddingWire** — Wedding marketplace for discovery. Charges for listing but brings leads. The website should be the primary presence; these are supplemental.

## Compliance

- **Zoning**: The #1 compliance issue for rural event venues. Agricultural and residential zoning may not permit commercial events. Check with the town/county planning office. Some jurisdictions require a special use permit, conditional use permit, or variance. This can take months — start early.
- **Noise ordinances**: Most municipalities have noise curfews (often 10pm or 11pm). Display the curfew clearly in policies and contracts. Neighbors who complain can shut down a venue.
- **Occupancy limits**: Fire marshal sets maximum occupancy for indoor spaces. Display it and enforce it.
- **Alcohol**: If alcohol is served, the venue or caterer needs the appropriate license. BYOB events may still require a permit in some jurisdictions. Liquor liability insurance is essential.
- **Parking and traffic**: Rural venues need adequate parking (often in a field). Consider traffic flow on rural roads — neighbors notice. Some jurisdictions require a traffic management plan for large events.
- **Restrooms**: Permanent restrooms or portable toilets with handwashing stations. Health department may have requirements based on guest count.
- **Insurance**: Event liability insurance is non-negotiable. Require clients to carry event insurance or provide it as part of the package. General liability for the property, plus specific event coverage. Umbrella policy recommended.
- **Fire safety**: Outdoor fires (fire pits, sparklers, lanterns) may require permits. Barn venues need fire suppression or extinguishers. Check local fire marshal requirements.
- **Accessibility**: Note ADA considerations — level paths, accessible restrooms, reserved parking. Rural venues often have terrain challenges; be transparent about accessibility on the website.
- **Temporary food service**: If caterers serve on-site, the caterer handles food permits. The venue should confirm this in vendor requirements.

## Content ideas

Real wedding and event features (with permission), seasonal venue photos (the property looks different in every season — show it), behind-the-scenes setup process, vendor spotlights, "a day at [venue name]" walkthroughs, styling inspiration for different event types, FAQ content as blog posts ("What to ask when touring a venue"), guest testimonials, property history and stories, seasonal availability announcements, open house event invitations.

## Key dates

- **Engagement season** (Nov–Feb) — Newly engaged couples start venue shopping. Push availability, open house events, and "book your tour" content. Lead time: this is when 2027 weddings start booking.
- **Wedding season** (May–Oct in most climates) — Content focuses on current events and features. Saturdays are booked; push Friday and Sunday availability.
- **Corporate retreat season** (Sep–Nov, Jan–Mar) — Companies book off-site retreats in shoulder seasons. Different audience, different pages.
- **Holiday party season** (Nov–Dec) — Corporate and private holiday parties. Push availability starting in September.

## Structured data

Use `EventVenue` with:
- name, address, phone
- `maximumAttendeeCapacity`
- `amenityFeature` for key amenities
- `image` — multiple high-quality photos

For venues that also offer lodging, add `LodgingBusiness` as an additional type.

## Data tracking

- **Inquiries:** Name, Email, Phone, Event Type, Event Date, Guest Count, Budget Range, How Found Us, Status (Inquiry/Tour Scheduled/Tour Done/Proposal Sent/Booked/Declined), Notes
- **Events:** Client (linked), Event Type, Date, Guest Count, Package, Total, Deposit Paid, Balance Due, Vendors (linked), Setup Time, End Time, Status, Notes
- **Vendors:** Name, Category (Caterer/Photographer/Florist/DJ/Officiant/Rental), Contact, Website, Notes, Status (Preferred/Approved/Inactive)
