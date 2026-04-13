# Hospitality & Tourism

Covers: bed & breakfasts, boutique hotels, small independent hotels, vacation rentals, travel guides. See also [campground.md](campground.md) for RV parks and campgrounds, [event-venue.md](event-venue.md) for barn venues, estate venues, and dedicated event spaces, [tour-guide.md](tour-guide.md) for fishing guides, adventure tours, and activity-based tour operators, and [marina.md](marina.md) for marinas and waterfront businesses.

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

## Design

**Visual mood:** Welcoming, aspirational, experience-driven. The site should make visitors picture themselves there — relaxing, exploring, arriving. Warm and polished without being sterile.

**Color direction:** Warm and inviting — creams, sage, soft blues, warm wood tones. Muted saturation. White or cream background. Avoid harsh or bright colors. The palette should feel like a comfortable room.

**Typography feel:** Classic stack (Georgia serif headings) for B&Bs and boutique hotels — conveys character and permanence. Sans-serif body for readability. Heading weight 600–700.

**Layout emphasis:** Rooms/rates and a booking CTA above the fold. Home page uses Pattern 2 (hero + content) with a stunning property photo — the first impression must be aspirational. Room pages with large photos and clear pricing. Max-width 56rem.

**Photography style:** Professional interior and exterior photography — rooms, common areas, grounds, views, nearby attractions. 16:9 for hero banners, 4:3 for room photos. Natural light, warm tones. Show the property at its best season. Real guests enjoying the space (with permission) add warmth.

**Key component:** Room or accommodation card — photo, room name, brief description, rate (or "from $X"), amenity icons, and a "Book" or "Check Availability" button. Each room should feel distinct and inviting.

## Tools

- **Lodgify** (~$17/mo, proprietary) — Vacation rental management, direct booking widget, channel management. lodgify.com
- **Little Hotelier** (~$90/mo, proprietary) — B&B-specific. Reservations, front desk, channel management. littlehotelier.com
- **Airbnb/VRBO** — List on platforms for discovery but drive direct bookings through the website to avoid commission fees (15–20%).
- **Cal.com** (open source, free tier) — For scheduling tours, tastings, or activity bookings.
- **Square** (free POS, proprietary) — For on-site purchases, gift shop, or event deposits.

## Review platforms

- **Google Business Profile** — Essential for local visibility. Many guests check Google first, especially for B&Bs and boutique hotels they found through local search. Respond to every review — prospective guests read the responses as much as the reviews themselves.
- **TripAdvisor** — The dominant travel review platform for hospitality. B&Bs and small hotels live or die on TripAdvisor reputation. Getting a Certificate of Excellence (based on review volume and rating) is worth actively pursuing. Respond professionally to all reviews, including critical ones.
- **Booking.com** — If the property lists on Booking.com, guests leave reviews through the platform after checkout. Booking.com reviews are verified (only guests who booked through the platform can review). These carry significant weight for travelers.
- **Airbnb / VRBO** — For vacation rentals and short-term rental properties, platform reviews are the primary trust signal. Guest ratings directly affect search ranking within the platform. Respond to every review promptly.
- **Expedia / Hotels.com** — Relevant for properties listed on these OTA platforms. Maintaining reviews across all listing platforms you're on is important — a guest might find you on one platform but check reviews on another.

Ask guests at checkout: "We'd love it if you had a moment to leave us a review on TripAdvisor or Google — it helps other travelers find us." Include a thank-you card with QR codes for both.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Occupancy tax / tourism tax**: Many jurisdictions require hospitality businesses to collect and remit occupancy or lodging taxes. Note if the pricing includes or excludes taxes.
- **Safety disclosures**: Some jurisdictions require displaying fire safety info, maximum occupancy, or emergency exits.
- **ADA accommodations**: Note physical accessibility (stairs, elevator, ground-floor rooms, bathroom grab bars). Important for guest decision-making and compliance.
- **Short-term rental regulations**: Many cities now regulate short-term rentals (permits, licenses, zoning). Display the permit number if required.

## Content ideas

Seasonal guide to the area ("fall foliage," "summer activities"), local restaurant and attraction recommendations, guest stories and experiences, behind-the-scenes of hosting, event recaps, "what to pack" guides for the area, holiday specials and packages, local history or fun facts.

## Key dates

- **National Travel and Tourism Week** (1st full week May) — Area spotlights, travel tips, booking specials.
- **National B&B Day** (Oct 1) — Property features, host stories, fall getaway promotions.

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
