# Construction & Trades

Covers: general contractors, plumbers, electricians, HVAC, roofers, painters, landscapers, handymen, pressure washing, cleaning services.

## Pages

- **Services** — What they do, service descriptions in plain language
- **Service area** — Map or list of cities/neighborhoods served. Critical for local SEO.
- **Gallery / projects** — Before/after photos of completed work
- **About** — Experience, philosophy, team, story
- **Testimonials** — Client reviews (especially important for trust in home services)
- **Licensing / insurance** — License numbers, bonded/insured status. Builds trust.
- **Free estimate / contact** — Phone number prominent, contact form for estimate requests
- **Blog** — Maintenance tips, seasonal checklists, project spotlights

## Tools

- **Jobber** (~$49/mo, proprietary) — Job scheduling, quoting, invoicing, client management. Built for field service businesses. getjobber.com
- **Housecall Pro** (~$49/mo, proprietary) — Similar to Jobber. Scheduling, dispatching, invoicing. housecallpro.com
- **Cal.com** (open source, free tier) — For scheduling estimates or consultations.
- **Square Invoices** (free, 2.9% + 30¢ on card payments) — Simple invoicing if they don't need full job management.
- **Monica CRM** (open source, free) — If they just need to track clients and jobs.

## Compliance

- **Licensing display**: Most jurisdictions require contractors to display their license number on advertising, including websites. Add to the footer on every page.
- **Bonded and insured**: Displaying this builds trust. Include policy details or a badge on the about or home page.
- **Home improvement regulations**: Some states require specific disclosures (cooling-off periods, lien rights, etc.) on contracts. Not a website concern, but mention it during `/setup-customers` if relevant.

## Content ideas

Project spotlights with before/after photos, seasonal maintenance checklists ("winterize your plumbing," "spring lawn prep"), "when to call a professional vs. DIY" guides, behind-the-scenes of a project, team member spotlights, community involvement, answers to common questions (great for SEO).

## Structured data

Use `HomeAndConstructionBusiness` (or more specific: `Plumber`, `Electrician`, `RoofingContractor`, `HousePainter`, `LockSmith`, `GeneralContractor`) with:
- name, address, phone, hours
- `areaServed` — list of cities or regions
- `hasOfferCatalog` for services

## Data tracking

- **Clients:** Name, Email, Phone, Address, Source (referral/search/ad), Status, Notes, Created Date
- **Jobs:** Client (linked), Service Type, Status (Lead/Quoted/Scheduled/In Progress/Complete), Address, Start Date, Value, Notes
- **Estimates:** Client (linked), Description, Amount, Date, Status (Sent/Accepted/Declined)
