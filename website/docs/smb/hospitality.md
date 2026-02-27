# Hospitality & Tourism

Covers: bed & breakfasts, vacation rentals, tour operators, travel guides, event venues.

## Pages

- **Rooms / rentals** — Individual pages per room or property with photos, amenities, pricing, and availability link
- **Gallery** — Professional photos of the property, views, grounds, nearby attractions
- **Location / area** — What's nearby, local attractions, restaurants, activities. Great for SEO.
- **About** — The host's story. B&Bs and small lodging are personal — guests choose the host.
- **Policies** — Check-in/out times, cancellation, pet policy, house rules
- **Rates / book** — Seasonal pricing, link to booking platform
- **Reviews / testimonials** — Guest testimonials (critical for hospitality trust)
- **Contact** — Phone, email, directions, parking instructions
- **Events** — If the venue hosts events (weddings, retreats, meetings)

## Tools

- **Lodgify** (~$17/mo, proprietary) — Vacation rental management, direct booking widget, channel management. lodgify.com
- **Little Hotelier** (~$90/mo, proprietary) — B&B-specific. Reservations, front desk, channel management. littlehotelier.com
- **Airbnb/VRBO** — List on platforms for discovery but drive direct bookings through the website to avoid commission fees (15–20%).
- **Cal.com** (open source, free tier) — For scheduling tours, tastings, or activity bookings.
- **Square** (free POS, proprietary) — For on-site purchases, gift shop, or event deposits.

## Compliance

- **Occupancy tax / tourism tax**: Many jurisdictions require hospitality businesses to collect and remit occupancy or lodging taxes. Note if the pricing includes or excludes taxes.
- **Safety disclosures**: Some jurisdictions require displaying fire safety info, maximum occupancy, or emergency exits.
- **ADA accommodations**: Note physical accessibility (stairs, elevator, ground-floor rooms, bathroom grab bars). Important for guest decision-making and compliance.
- **Short-term rental regulations**: Many cities now regulate short-term rentals (permits, licenses, zoning). Display the permit number if required.

## Content ideas

Seasonal guide to the area ("fall foliage," "summer activities"), local restaurant and attraction recommendations, guest stories and experiences, behind-the-scenes of hosting, event recaps, "what to pack" guides for the area, holiday specials and packages, local history or fun facts.

## Structured data

Use `LodgingBusiness` (or `BedAndBreakfast`, `Hotel`, `Hostel`) with:
- name, address, phone, hours (check-in/out)
- `priceRange`
- `amenityFeature` for key amenities
- `checkinTime`, `checkoutTime`

For tour operators, use `TouristAttraction` or `TravelAgency`.

## Data tracking

- **Guests:** Name, Email, Phone, Source (direct/Airbnb/VRBO/referral), Visits, Notes, Created Date
- **Reservations:** Guest (linked), Room/Property, Check-in, Check-out, Guests Count, Rate, Status, Notes
