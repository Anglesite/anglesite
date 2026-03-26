# Cleaning Service

Covers: residential cleaning (housekeeping, maid service), commercial/janitorial, move-in/move-out cleaning, post-construction cleaning, carpet cleaning, window cleaning, pressure washing.

## Pages

- **Services** — Residential, commercial, deep clean, move-in/move-out, recurring (weekly/biweekly/monthly). Be specific about what's included in each — customers need to know what "standard clean" means.
- **Pricing** — Starting rates, flat rate vs. hourly, how quotes work. Transparency reduces phone calls from poor-fit leads.
- **Booking** — Online booking or quote request. Include home size, frequency, and special requests.
- **About** — Story, values, why you started. Cleaning businesses enter people's homes — trust is everything. Background checks, bonding, insurance should be front and center.
- **Service area** — Map or list. Cleaning is hyperlocal.
- **Testimonials** — Reviews from verified customers. Before/after photos.
- **Checklist** — What's included in each service tier. Customers love checklists — it sets expectations.
- **FAQ** — Do I need to be home? What products do you use? Do you bring your own supplies? How do I prepare? Cancellation policy?
- **Contact** — Phone, email, booking link.

## Design

**Visual mood:** Clean, bright, fresh. The design should embody the service — when someone lands on the page, it should feel like a room that was just cleaned. Airy, uncluttered, and inviting.

**Color direction:** Light palette — whites, light blues, fresh greens, touches of lemon. Crisp and sparkling. Avoid dark or heavy backgrounds. Accent color for booking CTAs should pop against the light base.

**Typography feel:** Modern stack (system-ui sans-serif). Clean weight (400–500) for body, medium weight for headings. Light and breathable. Generous line-height. The typography should feel as tidy as the service.

**Layout emphasis:** Before/after photos and booking CTA prominent above the fold. Service tiers with clear "what's included" checklists. Use Pattern 2 (hero + content) for home, Pattern 5 (alternating features) for before/after showcase sections. Max-width 56rem.

**Photography style:** Bright, well-lit before/after shots are the strongest content. Natural light, clean compositions. Show the transformation. 16:9 for before/after comparisons (side by side). Facility and team photos should feel warm and professional.

**Key component:** Before/after photo slider or side-by-side comparison — showing the cleaning transformation. Each pair with a brief caption (room type, service performed). On desktop, side by side; on mobile, stacked with clear "before" and "after" labels.

## Tools

- **Jobber** (~$40+/mo, proprietary) — Scheduling, quoting, invoicing, client management, GPS tracking. jobber.com
- **ZenMaid** (~$49+/mo, proprietary) — Built specifically for maid services. Scheduling, booking, client management. zenmaid.com
- **Launch27 / BookingKoala** (~$70+/mo, proprietary) — Online booking, automated pricing, recurring schedules.
- **Square** (free POS, proprietary) — Invoicing and payments for smaller operations.
- **Cal.com** (open source, free tier) — Estimate scheduling.
- Many cleaning businesses run on a phone, a calendar, and a payment app. If volume is under 10 clients/week, that's fine.

## Review platforms

- **Google Business Profile** — The primary channel. People search "house cleaning service [city]" or "maid service near me" and choose based on reviews. A cleaning service with 40+ reviews and a consistent 4.8–5.0 rating looks trustworthy enough to invite into someone's home. Reviews that mention consistency ("they clean it the same way every time"), trust ("I leave them my key"), and specific cleaners by name are especially persuasive.
- **Yelp** — Active for cleaning services in most markets. Clients who are comparison-shopping often check both Google and Yelp. Claim the listing, add photos of before/after work, and respond to reviews.
- **Nextdoor** — Hyperlocal and high-trust. A recommendation on Nextdoor from a neighbor is more persuasive than a generic Google review for cleaning services — it's a neighbor vouching for someone who was inside their home. Claim the Nextdoor Business Page and ask satisfied clients to recommend you on the platform.
- **HomeAdvisor / Angi** — If the business generates leads from these platforms, keep the review profiles current. Clients who found the service through Angi may leave reviews there that new leads will see.

After each cleaning, send a brief follow-up: "Thanks for having us today! If everything looked great, a quick Google review helps other homeowners find us." Include the direct review link. Services with scheduling software (Jobber, ZenMaid) can automate this follow-up.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Bonding and insurance**: General liability insurance and a surety bond protect the client and the business. Display "Licensed, bonded, and insured" prominently — it's the #1 trust signal.
- **Employee vs. contractor**: Cleaning businesses frequently misclassify workers as 1099 contractors. This is an IRS and state labor law issue. Not a website item, but if the business mentions "our team," they should be W-2 employees or this creates liability.
- **Cleaning product safety**: If advertising "green" or "non-toxic" cleaning, be truthful. EPA Safer Choice certification exists. Don't make health claims about cleaning products.
- **Background checks**: If entering homes, state clearly that employees are background-checked.
- **Service agreements**: Terms of service should cover cancellation, lockouts, breakage, and scope of work.

## Content ideas

Cleaning tips and hacks, seasonal deep-clean reminders, product recommendations, "what's included" breakdowns, before/after photos, team spotlights, green cleaning explainers, move-in/move-out checklists, home maintenance tips, myth-busting ("do you really need to clean your oven that often?").

## Key dates

- **National Cleaning Week** (last week Mar) — Spring cleaning promotions, deep-clean packages, tips content.
- **Spring Cleaning Month** (Apr) — Extended spring cleaning content and booking push.

## Structured data

Use `HousekeepingService` or `ProfessionalService` with:
- name, address, phone, hours
- `areaServed` for service zone
- `hasOfferCatalog` for service tiers

## Data tracking

- **Clients:** Name, Email, Phone, Address, Home Size, Service Type, Frequency, Access Instructions, Notes
- **Jobs:** Client (linked), Date, Service Type, Cleaner Assigned, Status (Scheduled/In Progress/Completed), Notes
