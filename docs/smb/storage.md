# Storage Facility

Covers: self-storage units, climate-controlled storage, vehicle/boat/RV storage, portable storage (pods), business storage.

## Pages

- **Unit sizes & pricing** — Size chart with dimensions, suggested uses ("fits a 1-bedroom apartment"), monthly rates. This is the #1 page — people compare storage facilities almost entirely on size and price.
- **Features** — Climate control, security (cameras, gated access, individual alarms), lighting, pest control, drive-up access, elevator, loading dock. List what makes the facility safe and convenient.
- **Reserve / rent online** — Online rental or reservation form. Storage is increasingly rented online before visiting.
- **Location & access hours** — Address, gate access hours (often 6am–10pm), office hours (shorter), directions, parking for loading.
- **About** — Facility history, management, community involvement. Storage is a trust business — people store valuables and irreplaceable items.
- **FAQ** — What can't be stored (hazmat, perishables, animals), insurance options, payment methods, lease terms, late fees, what happens at auction.
- **Contact** — Phone, email, office hours.

## Design

**Visual mood:** Clean, organized, and secure. The site should feel like the facility itself — orderly, trustworthy, and simple to navigate.

**Color direction:** Blues, grays, and white. Trustworthy and straightforward. Avoid clutter or bright colors — simplicity signals security.

**Typography feel:** Modern stack (system-ui). Clean and functional. Nothing decorative — storage is a utility purchase.

**Layout emphasis:** Unit sizes, rates, and availability above the fold — this is a comparison-driven purchase and people want numbers fast. Pattern 2 (hero + content) for the home page. Max-width 56rem.

**Photography style:** Clean facility exterior and interior shots, security features (cameras, gates, lighting). Show that the facility is well-maintained and safe. 16:9 for facility overview, 4:3 for unit type photos.

**Key component:** Unit size comparison — dimensions, description of what fits (e.g., "fits a 1-bedroom apartment"), monthly rate, and availability status. A clear, scannable table or card layout that lets visitors compare options at a glance.

## Tools

- **SiteLink** (pricing varies, proprietary) — Industry-leading self-storage management: rentals, payments, gate access, reporting. sitelink.com
- **storEDGE** (pricing varies, proprietary) — Online rentals, website integration, marketing.
- **Tenant Inc** (pricing varies, proprietary) — Cloud-based storage management.
- **Map listings** — Critical. Most storage customers search "[city] storage" — local SEO drives this business. Claim on Google Business Profile, Apple Business Connect, and OpenStreetMap. See `docs/webmaster.md` → Map listings.
- Small storage facilities (under 100 units) may manage with a spreadsheet and a payment processor. That's fine.

## Compliance

- **Lien laws**: Every state has self-storage lien laws governing how and when you can auction a delinquent tenant's belongings. You must follow notice requirements (certified mail, waiting periods) before auction. Note your lien/auction policy in the rental agreement and FAQ.
- **Insurance**: Most storage facilities don't cover tenant belongings. State this clearly. Offer or recommend tenant insurance (many management systems include this).
- **Hazardous materials**: Prohibit storage of hazardous, flammable, and perishable materials. List restrictions on the FAQ page.
- **ADA**: Office and facility must be ADA accessible.
- **Zoning**: Storage facilities are subject to local zoning. Not a website issue, but impacts expansion.
- **Privacy**: Access logs contain personally identifiable information. Gate access systems must be secure.
- **Vehicle/RV/boat storage**: If offering outdoor or covered vehicle storage, check local ordinances and note any size or height restrictions.

## Content ideas

Packing and organization tips, "what size storage unit do I need?" guides, moving checklists, seasonal storage tips (holiday decorations, winter gear), business storage use cases, climate control explainers, security feature spotlights, local moving guides, decluttering advice, "how to prepare items for long-term storage."

## Key dates

- **National Organize Your Home Day** (Jan 14) — Decluttering tips, storage solutions, "start fresh" promotions.
- **National Moving Month** (Jun) — Moving tips, storage unit specials, packing resources.

## Structured data

Use `SelfStorage` (schema.org) with:
- name, address, phone, hours
- `hasOfferCatalog` for unit sizes and pricing

## Data tracking

- **Units:** Number, Size, Type (Standard/Climate/Vehicle), Floor, Rate, Status (Available/Rented/Reserved), Notes
- **Tenants:** Name, Phone, Email, Unit(s), Lease Start, Rate, Autopay (yes/no), Insurance (yes/no), Notes
