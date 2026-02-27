# Dry Cleaner & Laundromat

Covers: dry cleaners, laundromats (self-service), wash-and-fold services, laundry pickup/delivery, alterations (when combined with dry cleaning).

## Pages

- **Services** — Dry cleaning, wash-and-fold, self-service, alterations, specialty items (wedding gowns, leather, drapes). Pricing per item or per pound.
- **Pricing** — Prices for common items (shirt, pants, suit, dress, comforter). Transparency avoids sticker shock at pickup.
- **Pickup & delivery** — Service area, schedule, minimum order, how it works. Pickup/delivery is a growing differentiator.
- **Hours & location** — Drop-off/pickup hours (often different from self-service hours). Parking, accessibility, machine availability.
- **Specials** — Loyalty programs, first-time discounts, bulk pricing. Laundry is a repeat business — loyalty matters.
- **About** — Story, how long you've been operating, eco-friendly practices, garment care expertise.
- **FAQ** — Turnaround times, stain treatment, how to handle delicates, what can't be dry cleaned.
- **Contact** — Phone, email, pickup scheduling.

## Tools

- **Starchup** (pricing varies, proprietary) — Dry cleaning POS, pickup/delivery management, customer portal. starchup.com
- **CleanCloud** (~$50+/mo, proprietary) — Laundry and dry cleaning management: POS, delivery, customer app. cleancloud.com
- **Cents** (pricing varies, proprietary) — Laundromat management: machine monitoring, payment, CRM.
- **Square** (free POS, proprietary) — For smaller operations.
- For self-service laundromats, the website is mostly informational — hours, location, machine types, payment methods.

## Compliance

- **Environmental (PERC)**: Perchloroethylene (PERC) is the traditional dry cleaning solvent and is heavily regulated. EPA, state, and local agencies regulate air emissions, wastewater, and disposal. If using alternative solvents (hydrocarbon, liquid CO2, wet cleaning), promote it — it's a selling point.
- **Environmental cleanup liability**: Dry cleaning sites are common EPA Superfund and state brownfield sites due to historical PERC contamination. Not a website issue, but impacts insurance and property.
- **Fire codes**: Laundromats with gas dryers must comply with local fire codes. Self-service facilities have occupancy and safety requirements.
- **ADA**: Self-service facilities must be ADA accessible — aisles, machine heights, accessible payment.
- **Sales tax**: Laundry services are taxable in some states, exempt in others. Varies by service type (self-service vs. drop-off).
- **Lost/damaged garments**: Have a clear policy for handling lost or damaged items. Display or link to your terms of service.

## Content ideas

Garment care tips, stain removal guides, "what those laundry symbols mean," seasonal wardrobe care (winter coat cleaning, summer whites), eco-friendly cleaning explainers, behind-the-scenes of the cleaning process, alterations tips, wedding dress preservation guide, "what to do before you donate clothes."

## Key dates

- **National Laundry Day** (Apr 15) — Promotions, fabric care tips, service spotlights.
- **Clean Out Your Closet Week** (varies) — Seasonal wardrobe transitions, donation drives, cleaning specials.

## Structured data

Use `DryCleaningOrLaundry` (schema.org) with:
- name, address, phone, hours
- `areaServed` for pickup/delivery zone

## Data tracking

- **Customers:** Name, Phone, Email, Preferences, Pickup Address (if delivery), Notes
- **Orders:** Customer (linked), Items, Service Type, Date In, Date Out, Status (Received/In Process/Ready/Picked Up), Total, Notes
