# Artist, Maker & Craftsperson

Covers: visual artists, sculptors, potters, woodworkers, jewelers, fiber artists, printmakers, glassblowers, leatherworkers, any handmade goods maker. See also [photography.md](photography.md) for photographers/videographers and [tattoo.md](tattoo.md) for tattoo artists.

## Pages

- **Portfolio / gallery** — The core of the site. Organized by medium, series, or chronology. Large, high-quality images. This is what people come for.
- **Shop** — If selling directly. Link to Big Cartel, Ko-fi, Etsy, or an on-site store. Even a simple "available works" page with prices and a "contact to purchase" CTA works.
- **About** — Artist statement, background, influences, process. Collectors and galleries want to understand the person behind the work.
- **Commissions** — If they take custom work. Process, pricing guidance, timeline, examples of past commissions. Clear "how to commission" steps reduce friction.
- **Events / exhibitions** — Upcoming shows, markets, open studio dates, gallery exhibitions. Past events build credibility.
- **Process** — Behind-the-scenes photos or write-ups of how work is made. Fascinating to buyers and great for social sharing.
- **Contact** — Email, social links, studio visit policy. Include wholesale/gallery inquiries if applicable.
- **Press / CV** — If they exhibit or sell to galleries. Exhibition history, publications, awards, residencies. Standard format for the art world.

## Tools

- **Big Cartel** (free for 5 products, proprietary) — Simple online store built for makers. Clean, minimal. bigcartel.com
- **Ko-fi** (free, no fees on donations) — Commissions, memberships, shop. Indie-friendly and creator-focused. ko-fi.com
- **Etsy** (listing fee + 6.5% transaction fee) — Marketplace for discovery. Use alongside the website, not instead of it. Good for SEO and finding new customers.
- **Square** (free POS, proprietary) — For in-person sales at markets, fairs, and studio visits.

## Compliance

- **Sales tax**: Applies to physical goods sold in most states. Online sales may trigger nexus in multiple states. Market platforms (Etsy, Big Cartel) handle collection in most cases.
- **Resale certificates**: If selling wholesale to galleries or shops, understand resale certificate exemptions.
- **Copyright**: The artist owns copyright to their work by default. Consider adding a copyright notice to the website. If selling prints or reproductions, be clear about edition sizes and licensing.
- **Shipping hazmat**: Some materials (solvents, certain paints) can't be shipped standard. If selling supplies or materials, check carrier restrictions.
- **Craft fair/market permits**: Many require business licenses, sales tax permits, or liability insurance. Check each venue's requirements.

## Content ideas

New work, process photos, commission availability, exhibition announcements, inspiration and influences, behind-the-scenes of studio life, material spotlights, "from sketch to finished piece" progressions, market and fair schedules, customer stories (who bought what and why), packaging and shipping stories, seasonal collections, collaboration announcements, tips for collectors.

## Key dates

- **World Art Day** (Apr 15) — Share your process, studio tour, or new work.
- **Arts & Humanities Month** (Oct) — Broader cultural celebration. Open studio events, community art projects, exhibition announcements.
- **Small Business Saturday** (Sat after Thanksgiving) — Many makers participate in holiday markets and pop-ups.

## Structured data

Use `ArtGallery` or `Store` with:
- name, address (if studio/gallery), phone
- `makesOffer` for available works
- Use `Product` for individual pieces with `name`, `image`, `price`, `availability`
- Use `VisualArtwork` for portfolio pieces with `artMedium`, `artworkSurface`, `width`, `height`

## Data tracking

- **Customers:** Name, Email, Phone, Type (Collector/Gallery/Wholesale/Commission), Interests, Source, Created Date
- **Works:** Title, Medium, Dimensions, Price, Status (Available/Sold/NFS/Commission), Date Completed, Location, Photo
- **Commissions:** Client (linked), Description, Size, Medium, Price, Deposit Paid, Status (Inquiry/Accepted/In Progress/Complete/Delivered), Due Date, Notes
- **Events:** Name, Type (Exhibition/Market/Fair/Open Studio), Venue, Dates, Status, Notes
