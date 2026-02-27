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

## Tools

- **Time To Pet** (~$25/mo, proprietary) — Built for dog walking and pet sitting. Scheduling, invoicing, GPS tracking. timetopet.com
- **Gingr** (~$100/mo, proprietary) — Built for boarding, daycare, grooming. Reservations, vaccination tracking, POS. gingrapp.com
- **Square** (free POS, proprietary) — For grooming and retail (food, accessories).
- **Cal.com** (open source, free tier) — For booking grooming appointments or training sessions.
- Many pet businesses manage bookings via phone/text. If that works and the volume is manageable, don't fix what isn't broken.

## Compliance

- **Vaccination records**: Boarding and daycare facilities typically require proof of vaccination. Note requirements on the policies page (rabies, DHPP, bordetella are common).
- **Insurance**: Pet care businesses should carry commercial liability insurance. Mentioning "fully insured" on the website builds trust.
- **Emergency procedures**: Display what happens if a pet has a medical emergency — which vet clinic you use, how you contact the owner.
- **Zoning**: Some home-based pet businesses face zoning restrictions. Not a website concern, but be aware.

## Content ideas

Pet of the month/week, grooming tips by breed, training tips for common behavioral issues, seasonal pet safety (heatstroke, holiday hazards, winter paw care), facility updates, staff spotlights, vaccination reminder posts, fun pet photos.

## Structured data

Use `LocalBusiness` with:
- name, address, phone, hours
- `description` mentioning services offered

## Airtable schema

- **Clients:** Owner Name, Email, Phone, Pet Name, Pet Breed, Vaccination Due Date, Notes, Created Date
- **Bookings:** Client (linked), Service, Date, Time, Status, Notes
