# Salon & Spa

Covers: hair salons, barbershops, nail salons, spas, aestheticians, lash/brow studios, tattoo studios, chair/booth renters, and independent beauty professionals.

**Chair renters and booth renters:** Many beauty professionals rent a chair or suite in someone else's salon. They're independent businesses that need their own website, booking, and online presence — separate from the salon that houses them. Everything in this file applies. During `/start`, ask: "Do you own the salon, or do you rent a chair or suite?" If they rent, the website is about *them* (the provider), not the salon. The location page should mention the salon by name and address but make clear the provider is the focus.

## Pages

- **Services & pricing** — Full menu with prices. This is the most-visited page after home.
- **Stylists / providers** — Bio, photo, specialties, booking link per provider
- **Gallery** — Before/after photos, portfolio of work (especially important for hair, nails, tattoos)
- **Book** — Direct link to booking platform or embeddable widget
- **About** — Studio story, philosophy, vibe
- **Location** — Address, parking, hours (often non-standard hours — evenings, weekends)
- **Blog** — Style tips, product recommendations, seasonal trends
- **Contact** — Phone (many clients still call), social links

## Design

**Visual mood:** Polished, aspirational, visually-driven. The site should feel like the experience of walking into a well-designed salon — clean, inviting, and confidence-building.

**Color direction:** Warm neutrals and muted tones — blush, mauve, warm gray, champagne, soft black. Pops of gold or rose gold for accents. High-end salons: dark backgrounds with light text. Casual salons: light and airy. Avoid neon or harsh colors.

**Typography feel:** Modern stack for clean professionalism, or humanist stack for warmth. Light to medium heading weight (400–600) for elegance. All-caps headings with letter-spacing work well in this space.

**Layout emphasis:** Visual portfolio is critical — before/after photos, style galleries. Services and pricing must be scannable (table or card layout, not paragraphs). Book-now CTA on every page. Use Pattern 4 (card grid) for gallery, Pattern 2 (hero) for home with the best transformation photo.

**Photography style:** High-quality before/after photos are the most powerful marketing tool. Consistent backgrounds and lighting. Individual stylist portraits. 4:5 portrait aspect ratio for person-focused shots. 1:1 for grid thumbnails.

**Key component:** Service card — service name, brief description, price, duration, and "Book" button. Optionally grouped by category (hair, nails, skin, etc.). Clean alignment with consistent pricing format.

## Tools

- **Square Appointments** (free for individuals, proprietary) — Booking, payments, client management. Good starting point. squareup.com
- **Fresha** (free, commission on new clients only) — Salon-specific booking and POS. fresha.com
- **Vagaro** (~$25/mo, proprietary) — Booking, payments, marketing. Popular with salons and spas. vagaro.com
- If they already use Booksy, GlossGenius, or Boulevard — keep it. Link from the website.
- **Instagram** is the primary portfolio for most beauty professionals — often more important than the website gallery. Embed or link the feed prominently on the home page and gallery. Keep `rel="me"` for verification. During `/start`, ask for the Instagram handle early and feature it in the site design.
- **Reviews** — Clients choose beauty providers based on reviews. Encourage and link to reviews on Google, Yelp, and the booking platform (Booksy, Fresha, etc.). Add a "Reviews" section to the home page or a dedicated page with a link to leave a review.

## Compliance

- **Licensing**: Many jurisdictions require displaying cosmetology/barbering license numbers. Add to the footer or about page.
- **Skin/health disclaimers**: Spa treatments, chemical peels, microblading, etc. may need disclaimers about risks and contraindications.
- **Tattoo**: Age verification requirements vary by jurisdiction. Note the minimum age policy on the booking page.

## Content ideas

Style transformations with before/after photos (with client consent), seasonal trend posts, product recommendations, stylist spotlights, "how to maintain your [service] at home" guides, new service announcements, behind-the-scenes of the studio.

## Key dates

- **National Hairstylist Day** (Apr 30) — Stylist spotlights, team appreciation, behind-the-chair content.
- **National Nail Tech Day** (1st Sun May) — Nail art showcases, technician features.
- **National Barber Day** (Sep 16) — For barbershops. History, community role, style spotlights.

## Structured data

Use `BeautySalon`, `BarberShop`, or `HealthAndBeautyBusiness` with:
- name, address, phone, hours
- `priceRange` — approximate price range

## Data tracking

- **Clients:** Name, Email, Phone, Preferred Provider, Notes, Last Visit, Created Date
- **Services:** Name, Category, Price, Duration, Provider (linked)
