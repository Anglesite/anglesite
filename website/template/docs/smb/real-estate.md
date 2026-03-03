# Real Estate

Covers: real estate agents, brokerages, property management companies.

## Pages

- **About / agent bio** — Photo, credentials, experience, areas served, personal story
- **Areas served** — One page per neighborhood or city, great for local SEO
- **Buyers** — Process overview, first-time buyer info, how to get started
- **Sellers** — What to expect, home prep tips, pricing strategy
- **Testimonials** — Client reviews with names (with permission)
- **Blog** — Market updates, neighborhood guides, home tips
- **Contact** — Phone, email, office address, scheduling link

## Design

**Visual mood:** Aspirational, local expertise. The design should feel polished and confident — this agent knows the market and the neighborhoods. Warm but sharp.

**Color direction:** Warm neutrals (cream, sand, warm gray) with a bold accent color (deep teal, terracotta, navy). The accent should feel distinctive — agents need to stand out from brokerage templates. Avoid cold or generic corporate palettes.

**Typography feel:** Modern stack (system-ui) with bold headings (weight 700+). Clean, contemporary, confident. The typography should feel current without being trendy — real estate moves fast but trust is timeless.

**Layout emphasis:** Property search and current listings are the primary draw — link prominently to the agent's MLS/IDX profile. Neighborhood pages are individual landing pages for local SEO. Agent bio and credentials must be visible early. Use Pattern 4 (card grid) for listings and area pages, Pattern 2 (hero + content) for home. Max-width 64rem for visual impact.

**Photography style:** Property photography in 16:9 aspect ratio. High quality, well-lit, professionally staged when possible. Agent headshot should be polished and approachable. Neighborhood photos add local flavor. Avoid generic stock — every photo should feel like it belongs to this market.

**Key component:** Property listing card — featured image (16:9), address, price, bed/bath/sqft, status badge (active, pending, sold), and link to full listing on the brokerage IDX site.

## Tools

- **Cal.com** (open source, free tier) — Schedule showings and consultations.
- **Monica CRM** (open source, free) — Track clients and leads.
- For listings: link to the agent's MLS profile or brokerage listing page. Don't try to replicate MLS on the website — the data changes too frequently and requires IDX compliance.
- **Canva** (free tier) — For social media graphics, just-listed flyers, open house announcements.

## Compliance

- **Fair Housing Act (US)**: Website content must not express preference or limitation based on race, color, religion, sex, familial status, national origin, or disability. Avoid language like "perfect for young couples" or "family neighborhood." Use inclusive descriptions.
- **Brokerage disclosure**: Most states require the brokerage name and license number on marketing materials, including websites. Add to the footer.
- **MLS/IDX**: Don't scrape or embed MLS data without proper IDX authorization. Link to listings on the brokerage's IDX-enabled site instead.

## Content ideas

Monthly market reports for the service area, neighborhood spotlight posts, home maintenance tips by season, "what to expect" guides for buying/selling, open house announcements, client success stories, local business features (builds community ties).

## Key dates

- **National Homeownership Month** (Jun) — First-time buyer resources, homeownership stories, market updates.
- **National Open House Weekend** (varies) — Listing push, open house events, buyer education.

## Structured data

Use `RealEstateAgent` with:
- name, address, phone, email
- `areaServed` for neighborhoods/cities
- Link to brokerage as `memberOf`

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Buyer/Seller/Both/Investor/Lead), Status, Source, Notes, Created Date
- **Properties:** Address, Type (listing/sold/buyer interest), Price, Status, Contact (linked), Notes
