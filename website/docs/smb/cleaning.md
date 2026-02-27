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

## Tools

- **Jobber** (~$40+/mo, proprietary) — Scheduling, quoting, invoicing, client management, GPS tracking. jobber.com
- **ZenMaid** (~$49+/mo, proprietary) — Built specifically for maid services. Scheduling, booking, client management. zenmaid.com
- **Launch27 / BookingKoala** (~$70+/mo, proprietary) — Online booking, automated pricing, recurring schedules.
- **Square** (free POS, proprietary) — Invoicing and payments for smaller operations.
- **Cal.com** (open source, free tier) — Estimate scheduling.
- Many cleaning businesses run on a phone, a calendar, and a payment app. If volume is under 10 clients/week, that's fine.

## Compliance

- **Bonding and insurance**: General liability insurance and a surety bond protect the client and the business. Display "Licensed, bonded, and insured" prominently — it's the #1 trust signal.
- **Employee vs. contractor**: Cleaning businesses frequently misclassify workers as 1099 contractors. This is an IRS and state labor law issue. Not a website item, but if the business mentions "our team," they should be W-2 employees or this creates liability.
- **Cleaning product safety**: If advertising "green" or "non-toxic" cleaning, be truthful. EPA Safer Choice certification exists. Don't make health claims about cleaning products.
- **Background checks**: If entering homes, state clearly that employees are background-checked.
- **Service agreements**: Terms of service should cover cancellation, lockouts, breakage, and scope of work.

## Content ideas

Cleaning tips and hacks, seasonal deep-clean reminders, product recommendations, "what's included" breakdowns, before/after photos, team spotlights, green cleaning explainers, move-in/move-out checklists, home maintenance tips, myth-busting ("do you really need to clean your oven that often?").

## Structured data

Use `HousekeepingService` or `ProfessionalService` with:
- name, address, phone, hours
- `areaServed` for service zone
- `hasOfferCatalog` for service tiers

## Data tracking

- **Clients:** Name, Email, Phone, Address, Home Size, Service Type, Frequency, Access Instructions, Notes
- **Jobs:** Client (linked), Date, Service Type, Cleaner Assigned, Status (Scheduled/In Progress/Completed), Notes
