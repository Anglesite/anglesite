# Museum & Cultural Institution

Covers: art museums, history museums, science centers, children's museums, heritage sites, botanical gardens, zoos, aquariums.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Visit** — Hours, admission prices, location, parking, transit, accessibility, what to expect. The highest-traffic page. Answer every question a first-time visitor would have.
- **Exhibitions** — Current and upcoming exhibitions with images, dates, descriptions. Past exhibitions in an archive.
- **Collection** — Highlights from the permanent collection. Full online collection if feasible (large museums use separate platforms for this).
- **Events / programs** — Lectures, workshops, family programs, member events, exhibition openings
- **Education** — School group visits, teacher resources, student programs, homeschool days
- **Membership** — Levels, benefits, sign-up link. Membership is often the primary revenue stream.
- **Donate / support** — Annual fund, capital campaigns, planned giving, corporate sponsorship
- **About** — Mission, history, leadership, staff, board
- **Shop** — If they have a gift shop, link to the online store
- **Blog / magazine** — Behind-the-scenes, curator essays, collection deep dives, artist interviews

## Tools

- **Tessitura** or **Altru (Blackbaud)** — Museum-specific CRM, ticketing, membership, fundraising. Enterprise-level and expensive, but most mid-to-large museums already use one. Don't replace.
- **Eventbrite** (free for free events, fees for paid) — Good for event registration if they don't have a ticketing system.
- **Square** (free POS) — For gift shop and admission if no dedicated ticketing system.
- **GiveButter** (free, tips-based) — For donation campaigns.
- For small museums without enterprise tools: **Little Green Light** (~$45/mo) — Donor management designed for small nonprofits. littlegreenlight.com

## Compliance

- **ADA / physical accessibility**: Critical for public-facing institutions. Note wheelchair access, elevator locations, accessible restrooms, seating in galleries, assistive listening, large-print guides, sensory-friendly hours. Many museums face ADA scrutiny.
- **Image rights**: Collection images may have copyright restrictions. Note reproduction policies. Use works in the public domain freely; licensed works need attribution.
- **Tax receipts**: Membership payments above fair market value of benefits are tax-deductible. Note the deductible portion on the membership page.
- **Deaccessioning**: If the museum sells collection items, this is controversial. Not a website concern, but be aware.
- **Repatriation (NAGPRA)**: For history/anthropology museums with indigenous collections. Not directly a website concern, but transparency pages should acknowledge this if applicable.

## Content ideas

Exhibition previews and reviews, "object of the month" deep dives, curator Q&As, artist interviews, behind-the-scenes of exhibition installation, education program recaps, conservation and restoration stories, collection acquisition announcements, community event recaps, seasonal programming highlights, "what's on this weekend" roundups.

## Key dates

- **International Museum Day** (May 18) — Free admission, special programming, community outreach.
- **Museum Month** (varies by state) — Extended programming, membership drives, exhibit previews.
- **Arts & Humanities Month** (Oct) — Cultural events, educational programs, community partnerships.

## Structured data

Use `Museum` (or `ArtGallery`, `Zoo`, `Aquarium`) with:
- name, address, phone, hours
- `event` for exhibitions and programs
- `isAccessibleForFree` — if admission is free
- `priceRange` or `offers` for admission

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Member/Donor/Educator/Vendor), Membership Level, Status, Notes, Created Date
- **Events:** Name, Date, Type (Exhibition Opening/Lecture/Workshop/Family), Capacity, RSVP Count, Notes
- **Exhibitions:** Title, Start Date, End Date, Gallery, Status (Upcoming/Current/Past), Description, Notes
