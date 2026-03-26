# Pet Services

Covers: dog grooming, pet boarding/kennels, dog walking, pet sitting, dog training, doggy daycare.

## Pages

- **Services** — List with descriptions and pricing. Include what's included in each service.
- **About** — Story, philosophy, love of animals. Pet parents want to trust the person.
- **Gallery** — Happy pets, facility photos, before/after grooming
- **Policies** — Vaccination requirements, cancellation policy, emergency procedures
- **FAQ** — What to bring, drop-off/pick-up times, how to prepare your pet
- **Location** — Facility address, hours, pickup/dropoff procedures
- **Testimonials** — Reviews from pet parents (bonus: include the pet's name)
- **Contact / booking** — Phone, booking link, emergency contact

## Design

**Visual mood:** Friendly, warm, playful but professional. The site should feel like a place where pets are loved and well cared for — approachable without being cartoonish. Pet parents need to trust you with their family member.

**Color direction:** Warm colors — teal, warm orange, soft green, cream. Friendly and inviting without being garish. Avoid sterile clinical whites or overly dark palettes. Accent color for booking CTAs should feel cheerful and confident.

**Typography feel:** Humanist stack (Segoe UI, Roboto, sans-serif) for approachability and warmth. Medium weight headings (500–600). Rounded, friendly feel. Body text generous and readable — pet parents scan quickly.

**Layout emphasis:** Services and booking CTA above the fold. Happy pet photos everywhere. Trust signals (insured, vaccination policy, emergency procedures) visible on the home page. Use Pattern 2 (hero + content) for home, Pattern 4 (card grid) for services. Max-width 56rem.

**Photography style:** Happy pet photos — real clients with permission, not stock. Show the animals enjoying the experience (post-groom glow-ups, dogs playing at daycare, cats lounging at the facility). 1:1 or 4:5 for pet portraits, 4:3 for facility and environment shots.

**Key component:** Service card with photo (happy pet), service name, description, pricing, and "Book" button. Cards grouped by service type (grooming, boarding, walking, training). Each card feels like a mini promise of how the pet will be treated.

## Tools

- **Time To Pet** (~$25/mo, proprietary) — Built for dog walking and pet sitting. Scheduling, invoicing, GPS tracking. timetopet.com
- **Gingr** (~$100/mo, proprietary) — Built for boarding, daycare, grooming. Reservations, vaccination tracking, POS. gingrapp.com
- **Square** (free POS, proprietary) — For grooming and retail (food, accessories).
- **Cal.com** (open source, free tier) — For booking grooming appointments or training sessions.
- Many pet businesses manage bookings via phone/text. If that works and the volume is manageable, don't fix what isn't broken.

## Review platforms

- **Google Business Profile** — Pet owners search "dog groomer near me" or "dog boarding [city]" and choose heavily on reviews. Reviews that mention a specific pet's name or a funny story ("they even sent us a photo of Max during his bath") are especially persuasive. Respond to every review personally — pet parents appreciate the warmth.
- **Yelp** — Active for pet services in most markets. Pet owners use Yelp specifically when searching for grooming and boarding options. Features like photos and check-ins give it depth. Claim the listing and keep it updated with current photos.
- **Rover** (if applicable) — For dog walkers and pet sitters who use the Rover platform, the in-app review system is the primary credibility signal. A high Rover rating and review count significantly affects booking rates within the platform.
- **Facebook** — Many pet owners ask for recommendations in neighborhood Facebook Groups. A business page with visible reviews and active posts gives you something to point to when someone mentions your name in a group. Respond to recommendations and tags.

Ask pet parents at pickup: "If [pet's name] had a great time, a Google or Yelp review would mean the world to us!" Including the pet's name in the ask makes it personal and almost always gets a yes.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Vaccination records**: Boarding and daycare facilities typically require proof of vaccination. Note requirements on the policies page (rabies, DHPP, bordetella are common).
- **Insurance**: Pet care businesses should carry commercial liability insurance. Mentioning "fully insured" on the website builds trust.
- **Emergency procedures**: Display what happens if a pet has a medical emergency — which vet clinic you use, how you contact the owner.
- **Zoning**: Some home-based pet businesses face zoning restrictions. Not a website concern, but be aware.

## Content ideas

Pet of the month/week, grooming tips by breed, training tips for common behavioral issues, seasonal pet safety (heatstroke, holiday hazards, winter paw care), facility updates, staff spotlights, vaccination reminder posts, fun pet photos.

## Key dates

- **Responsible Pet Owners Month** (Feb) — Pet care tips, wellness resources, training spotlights.
- **National Pet Day** (Apr 11) — Client pet features, photo contests, special treats.
- **National Dog Day** (Aug 26) — Dog-focused promotions, adoption partnerships, social media engagement.
- **National Cat Day** (Oct 29) — Cat-focused content, cat boarding/grooming specials.

## Structured data

Use `LocalBusiness` with:
- name, address, phone, hours
- `description` mentioning services offered

## Data tracking

- **Clients:** Owner Name, Email, Phone, Pet Name, Pet Breed, Vaccination Due Date, Notes, Created Date
- **Bookings:** Client (linked), Service, Date, Time, Status, Notes
