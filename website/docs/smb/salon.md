# Salon & Spa

Covers: hair salons, barbershops, nail salons, spas, aestheticians, lash/brow studios, tattoo studios.

## Pages

- **Services & pricing** — Full menu with prices. This is the most-visited page after home.
- **Stylists / providers** — Bio, photo, specialties, booking link per provider
- **Gallery** — Before/after photos, portfolio of work (especially important for hair, nails, tattoos)
- **Book** — Direct link to booking platform or embeddable widget
- **About** — Studio story, philosophy, vibe
- **Location** — Address, parking, hours (often non-standard hours — evenings, weekends)
- **Blog** — Style tips, product recommendations, seasonal trends
- **Contact** — Phone (many clients still call), social links

## Tools

- **Square Appointments** (free for individuals, proprietary) — Booking, payments, client management. Good starting point. squareup.com
- **Fresha** (free, commission on new clients only) — Salon-specific booking and POS. fresha.com
- **Vagaro** (~$25/mo, proprietary) — Booking, payments, marketing. Popular with salons and spas. vagaro.com
- If they already use Booksy, GlossGenius, or Boulevard — keep it. Link from the website.
- **Instagram** is often the primary portfolio for visual businesses. Link prominently and keep `rel="me"` for verification.

## Compliance

- **Licensing**: Many jurisdictions require displaying cosmetology/barbering license numbers. Add to the footer or about page.
- **Skin/health disclaimers**: Spa treatments, chemical peels, microblading, etc. may need disclaimers about risks and contraindications.
- **Tattoo**: Age verification requirements vary by jurisdiction. Note the minimum age policy on the booking page.

## Content ideas

Style transformations with before/after photos (with client consent), seasonal trend posts, product recommendations, stylist spotlights, "how to maintain your [service] at home" guides, new service announcements, behind-the-scenes of the studio.

## Structured data

Use `BeautySalon`, `BarberShop`, or `HealthAndBeautyBusiness` with:
- name, address, phone, hours
- `priceRange` — approximate price range

## Airtable schema

- **Clients:** Name, Email, Phone, Preferred Provider, Notes, Last Visit, Created Date
- **Services:** Name, Category, Price, Duration, Provider (linked)
