# Community Theater & Performing Arts

Covers: community theater companies, community orchestras, dance companies, choral groups, arts councils, comedy troupes.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Current season** — Shows, concerts, or performances with dates, times, venue, brief descriptions, and poster/promo images. This is the homepage during an active season.
- **Buy tickets** — Direct link to ticketing platform. Should be reachable in one click from any page.
- **Auditions** — Upcoming auditions with dates, requirements, what to prepare, how to sign up. Keep this updated — stale audition info looks bad.
- **About** — Company mission, history, artistic leadership, board
- **Get involved** — How to participate: perform, crew/backstage, volunteer (ushers, set build, costumes), join the board
- **Past productions** — Archive with photos and cast lists. Builds credibility and community pride.
- **Education / classes** — Acting classes, youth programs, workshops, summer camps
- **Donate / sponsor** — Show sponsorships, season sponsors, individual donations, planned giving
- **Venue** — Address, parking, accessibility, seating chart, box office hours
- **Blog / news** — Rehearsal diaries, director's notes, cast spotlights, season announcements

## Tools

- **Ludus** (~$0.50/ticket, proprietary) — Ticketing designed for performing arts. Seating charts, box office, patron management. ludus.com
- **ThunderTix** (~$30/mo, proprietary) — Ticketing with reserved seating, subscriptions, donations. thundertix.com
- **Eventbrite** (fees per paid ticket, free for free events) — Good for simple general admission events.
- **Square** (free POS) — For box office walk-up sales and concessions.
- For orchestras/choral: concert program management may be handled in-house. Focus the website on the season schedule and tickets.
- **GiveButter** (free, tips-based) — For fundraising campaigns and galas.

## Compliance

- **Licensing and royalties**: If performing copyrighted works (musicals, plays), licensing is handled by the company (MTI, Samuel French/Concord, etc.), not the website. But do NOT publish full scripts, lyrics, or copyrighted music on the website.
- **Photo rights**: Production photos may involve photographer contracts. Credit photographers on the website.
- **Minor performers**: If youth participate, follow the same child safety policies as youth organizations (consent for photos, background checks for adults).
- **Venue accessibility**: Note ADA accessibility — wheelchair seating, assisted listening devices, accessible restrooms. Required for public venues.
- **Content warnings**: For shows with mature themes, note content advisories on the show page. Audiences appreciate transparency.

## Content ideas

Show announcements with teaser images, director's notes or dramaturg essays, cast and crew spotlights, audition announcements, behind-the-scenes rehearsal photos, opening night recaps, season announcements, education program highlights, donor and sponsor recognition, "why live theater matters" pieces, throwback features from past seasons.

## Structured data

Use `PerformingArtsTheater` or `MusicGroup` or `DanceGroup` with:
- name, address, phone
- `event` for shows and performances with dates, times, ticketing URLs

## Airtable schema

- **Contacts:** Name, Email, Phone, Type (Patron/Performer/Volunteer/Donor/Sponsor), Notes, Created Date
- **Productions:** Title, Season, Director, Dates, Venue, Ticket URL, Status (Upcoming/Running/Closed), Notes
- **Volunteers:** Contact (linked), Role (Usher/Set Build/Costumes/Crew/Board), Availability, Notes
