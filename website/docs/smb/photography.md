# Photography & Videography

Covers: wedding photographers, portrait photographers, commercial photographers, event videographers, drone photographers.

## Pages

- **Portfolio** — The most important page. Organized by category (weddings, portraits, commercial, etc.). High-quality images, fast loading.
- **About** — Personal story, style, approach. Clients hire a person, not just a camera.
- **Services / packages** — Clear pricing or "starting at" ranges. Investment guides.
- **Testimonials** — Client reviews, especially for weddings and events.
- **Blog** — Session features, behind-the-scenes, tips for clients
- **Contact / booking** — Inquiry form, availability calendar, turnaround times
- **FAQ** — What to wear, how sessions work, timeline for delivery, usage rights

## Tools

- **HoneyBook** (~$19/mo, proprietary) — Contracts, invoicing, scheduling, client management. Very popular with photographers. honeybook.com
- **Dubsado** (~$20/mo, proprietary) — Similar to HoneyBook. Contracts, forms, invoicing, scheduling.
- **Pixieset** (free tier, proprietary) — Client galleries and digital delivery. pixieset.com
- **Cal.com** (open source, free tier) — For booking consultations or mini-sessions.
- **Ko-fi** (free, no fees) — For selling prints, presets, or digital products.

## Compliance

- **Model releases**: If featuring clients or subjects on the website (especially children), have a model release. Mention this during the design interview when discussing gallery photos.
- **Copyright notice**: Add a copyright notice to the footer. Photographers own copyright by default, but stating it deters misuse.
- **Drone photography**: If they do drone work, FAA Part 107 certification should be mentioned on the services page. Builds credibility.

## Content ideas

Full session or wedding features (with client permission), "what to wear" guides for different session types, behind-the-scenes of a shoot, seasonal mini-session announcements, tips for getting the most out of your session, venue spotlights (great for wedding photographer SEO), gear reviews, editing before/after.

## Structured data

Use `ProfessionalService` with:
- name, address (or service area), phone
- `knowsAbout` for specialties (wedding, portrait, etc.)

## Airtable schema

- **Clients:** Name, Email, Phone, Session Type, Date, Status (Inquiry/Booked/Shot/Delivered), Gallery Link, Notes, Created Date
- **Sessions:** Client (linked), Type, Date, Location, Package, Total, Status, Delivery Date, Notes
