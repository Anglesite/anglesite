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

## Design

**Visual mood:** The work IS the design. Ultra-minimal frame that disappears behind the photography. Neutral, gallery-like presentation — the site should feel like a white-wall exhibition space, not a template.

**Color direction:** Neutral backgrounds — white or black depending on the photographer's editing style. No competing color. A single muted accent for interactive elements at most. Avoid anything that shifts perceived color in the portfolio images.

**Typography feel:** Modern stack (system-ui sans-serif). Very light weight (300–400). Typography should be nearly invisible — functional labels, not design elements. Let the images carry all visual weight.

**Layout emphasis:** Portfolio first, full-bleed images. Home page opens with the strongest work — a single hero image or curated gallery with zero intro text above the fold. Use Pattern 2 (hero) for home with a featured image, Pattern 4 (card grid) for portfolio categories. Max-width 72rem to give images room to breathe.

**Photography style:** The photographer's own work drives the entire site aesthetic. Consistent editing style across the portfolio matters more than any design decision. Standard aspect ratios: 3:2 or 2:3 for the portfolio grid. Full-bleed for hero and feature images.

**Key component:** Full-width portfolio gallery with category filtering (weddings, portraits, commercial, etc.). Click-to-expand or detail view. Minimal captions — let the images speak.

## Tools

- **HoneyBook** (~$19/mo, proprietary) — Contracts, invoicing, scheduling, client management. Very popular with photographers. honeybook.com
- **Dubsado** (~$20/mo, proprietary) — Similar to HoneyBook. Contracts, forms, invoicing, scheduling.
- **Pixieset** (free tier, proprietary) — Client galleries and digital delivery. pixieset.com
- **Cal.com** (open source, free tier) — For booking consultations or mini-sessions.
- **Ko-fi** (free, no fees) — For selling prints, presets, or digital products.

## Review platforms

- **Google Business Profile** — The baseline for any photography business. People searching "wedding photographer [city]" or "portrait photographer near me" check Google first. A photographer with 40+ reviews and a 4.9 rating gets booked more frequently than an equally talented one with 5 reviews. Respond to every review — future clients are reading.
- **The Knot / WeddingWire** (if weddings are a primary service) — Wedding photographers live on these platforms. Couples shortlist photographers based on The Knot and WeddingWire reviews before ever visiting a website. Paying for a listing is an investment in this business model; even the free profiles allow reviews. Getting 20+ reviews on The Knot is more impactful for wedding bookings than almost any other marketing.
- **Facebook** — Clients who love a photographer often tag them in wedding recap posts or write recommendations on the business page. A photographer with active engagement and visible client appreciation on Facebook signals a trusted, personable vendor.
- **Yelp** — Used for portrait and commercial photographers in some markets, less so for weddings. Worth monitoring and maintaining a profile if the business appears there.

After delivering a gallery, include a personal note: "It was such a pleasure photographing your [wedding/family/team]. If you have a moment, a Google review helps me find more clients like you — here's a direct link." Personalized, timed right (when the client is still in the glow of their photos), this request lands well.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Model releases**: If featuring clients or subjects on the website (especially children), have a model release. Mention this during the design interview when discussing gallery photos.
- **Copyright notice**: Add a copyright notice to the footer. Photographers own copyright by default, but stating it deters misuse.
- **Drone photography**: If they do drone work, FAA Part 107 certification should be mentioned on the services page. Builds credibility.

## Content ideas

Full session or wedding features (with client permission), "what to wear" guides for different session types, behind-the-scenes of a shoot, seasonal mini-session announcements, tips for getting the most out of your session, venue spotlights (great for wedding photographer SEO), gear reviews, editing before/after.

## Key dates

- **National Photography Month** (May) — Portfolio highlights, behind-the-scenes content, photography tips.
- **National Camera Day** (Jun 29) — Gear spotlights, photography history, community photo walks.
- **World Photography Day** (Aug 19) — Personal work, artistic vision posts, industry reflections.

## Structured data

Use `ProfessionalService` with:
- name, address (or service area), phone
- `knowsAbout` for specialties (wedding, portrait, etc.)

## Data tracking

- **Clients:** Name, Email, Phone, Session Type, Date, Status (Inquiry/Booked/Shot/Delivered), Gallery Link, Notes, Created Date
- **Sessions:** Client (linked), Type, Date, Location, Package, Total, Status, Delivery Date, Notes
