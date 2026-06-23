# Repair Business

Covers: auto repair, auto body/collision, computer/phone/electronics repair, appliance repair, bicycle repair, cobbler/shoe/leather repair, tailor/clothing alterations, watch/jewelry repair, furniture repair/upholstery, musical instrument repair, small engine repair, sewing machine repair, lawnmower repair.

## Pages

- **Services** — What you fix, with plain-language descriptions. Organized by device/product type or service category. Include what you don't repair to save everyone's time.
- **Pricing / estimates** — Flat-rate services if applicable, "starting at" ranges, free estimate policy. Transparency is the #1 trust builder in repair. People fear being overcharged.
- **About** — Experience, certifications, philosophy. Many repair businesses are one person with deep expertise — tell that story. If the business is motivated by Right to Repair values, say so.
- **Before & after / gallery** — Photos of repairs, restorations, and recoveries. Especially powerful for auto body, furniture, and electronics.
- **Warranty / guarantee** — What's covered, for how long. A repair warranty signals confidence in the work.
- **Hours / location** — Drop-off and pickup hours, parking, accessibility. If mobile/on-site repair, note the service area.
- **Testimonials** — Reviews are critical for repair businesses. People search for a repair shop when something is broken — they need trust fast.
- **FAQ** — Common questions: turnaround times, whether to repair vs. replace, data safety (electronics), what to do before bringing it in.
- **Blog** — Maintenance tips, repair guides, Right to Repair news
- **Contact** — Phone (people call when something breaks), email, drop-off instructions

## Design

**Visual mood:** Trustworthy, practical, competent. The site should feel like handing your broken item to someone who knows exactly what they're doing. Similar to trades but more focused on specific items — precision and care, not brute force.

**Color direction:** Navy, dark green, or dark gray paired with white. Grounded, professional palette. One clear accent color for CTAs (request estimate, drop off). Avoid flashy or trendy colors — repair customers want reliability, not novelty.

**Typography feel:** Modern stack (system-ui sans-serif). Medium-bold headings (600–700). Clean and readable. Body text at 1rem–1.125rem for easy scanning of service lists and pricing.

**Layout emphasis:** "What we fix" and contact info (phone, drop-off hours) prominent above the fold. Trust signals — experience, warranty, reviews — visible on the home page. Use Pattern 2 (hero + content) for home, Pattern 4 (card grid) for services organized by item type. Max-width 56rem.

**Photography style:** Before/after repair photos are the most compelling content. Clean workshop shots, tools of the trade, finished work. Authentic over polished. 4:3 aspect ratio for project photos.

**Key component:** Repair service list — item types (phones, appliances, bikes, etc.), typical turnaround time, and pricing ranges ("starting at" or flat-rate). Organized by category with clear visual separation.

## Tools

- **RepairDesk** (~$50/mo, proprietary) — Repair shop management: tickets, inventory, POS, customer communication. For electronics/phone repair. repairdesk.co
- **RepairShopr** (~$60/mo, proprietary) — Tickets, invoicing, inventory, CRM. Works for any repair type. repairshopr.com
- **Shop-Ware** (pricing varies, proprietary) — Auto repair shop management: digital inspections, estimates, communication. shop-ware.com
- **Mitchell 1** or **AllData** — Auto repair information systems. Industry standard for automotive.
- **Square** (free POS, proprietary) — Good for smaller shops. Payments, invoicing, basic inventory.
- **Cal.com** (open source, free tier) — Appointment booking for drop-offs or estimates.
- Many small repair shops run on paper tickets or a simple spreadsheet. If volume is low (<10 jobs/week), that's fine — don't overcomplicate it.

## Review platforms

- **Google Business Profile** — The first place people turn when something breaks. "Phone repair near me" or "appliance repair [town]" goes straight to Google Maps results. Reviews that say "they were honest about whether to repair or replace" and "fast turnaround, kept me updated" are the most persuasive for repair businesses. Respond to every review, including complaints — showing you address problems professionally is as important as the good reviews.
- **Yelp** — Active for auto repair, phone repair, and electronics repair shops. Some customers specifically use Yelp because they believe its filter catches fake reviews and provides more authentic signal. A strong Yelp presence with recent reviews and owner responses is worth building.
- **RepairShopr / RepairDesk reviews** (if using these platforms) — If the shop uses job management software with customer portals, some platforms have review prompts built in. Enable them.
- **Better Business Bureau** — For auto repair specifically, an accredited BBB profile with positive reviews is a meaningful trust signal, especially for first-time customers who are nervous about being overcharged.
- **Facebook** — Neighborhood groups are where people ask "anyone have a good mechanic?" A business page with visible reviews and quick responses to comments positions the shop to be recommended when those questions come up.

Timing matters: ask for the review when the customer picks up their item and says they're happy — not a week later by email when the moment has passed. A receipt or pickup notice with a direct review link makes it easy.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Right to Repair laws**: Landscape is changing fast. As of 2025, several US states and the EU have enacted repair legislation requiring manufacturers to provide parts, tools, and documentation. If the business advocates for Right to Repair, feature this on the about page — it's a differentiator and a values statement.
- **Auto repair**: Many states require a posted repair estimate before work begins, written authorization for work exceeding the estimate, and return of replaced parts on request. Display your license number (required in most states). BAR (Bureau of Automotive Repair) registration in California.
- **Electronics/data**: If handling devices with personal data (phones, laptops), note your data privacy practices. Customers worry about data theft. State clearly: "We do not access personal data during repairs" or describe your data handling policy.
- **Environmental**: Auto body (paint, solvents), electronics (e-waste), and appliance repair (refrigerants) all have environmental regulations. Mention responsible disposal practices if applicable.
- **Warranty disclaimers**: Be clear about what the repair warranty covers and what voids it (e.g., subsequent water damage on a phone screen repair). Display warranty terms on the website.
- **Licensing**: Auto repair, HVAC, and some appliance repair require specific trade licenses. Display license numbers in the footer.

## Content ideas

Repair tips and maintenance guides ("how to extend your phone battery life," "when to change your oil"), before-and-after photo features, Right to Repair news and advocacy, "repair vs. replace" decision guides, common problem explainers, seasonal maintenance reminders (winterize your car, spring appliance checkup), customer save stories ("they said it was dead, we brought it back"), new capability announcements, tool and parts spotlights.

## Key dates

- **International Repair Day** (3rd Sat Oct) — Repair culture, sustainability messaging, special offers, "repair don't replace" content.
- **Right to Repair** advocacy days (varies) — If relevant to the shop. Consumer rights, repairability, community education.

## Structured data

Use `LocalBusiness` with a more specific type if available (`AutoRepair`, `AutoBodyShop`, `ElectronicsRepair` — note: not all repair types have schema.org subtypes):
- name, address, phone, hours
- `areaServed` if mobile/on-site
- `hasOfferCatalog` for service categories

## Data tracking

- **Customers:** Name, Email, Phone, Device/Vehicle Info, Status, Notes, Created Date
- **Tickets:** Customer (linked), Device/Item, Issue Description, Status (Received/Diagnosing/Waiting for Parts/In Repair/Ready/Picked Up), Estimate, Final Cost, Date In, Date Out, Notes
- **Inventory:** Part Name, Category, Quantity, Cost, Supplier, Notes
