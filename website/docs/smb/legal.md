# Legal & Professional Services

Covers: law firms, solo attorneys, immigration consultants, notaries, mediators. See also [accounting.md](accounting.md), [insurance.md](insurance.md), [real-estate.md](real-estate.md) for specific professional subtypes.

## Pages

- **Practice areas / services** — Individual pages per practice area. "Family law" and "estate planning" are different searches with different audiences. Don't combine them.
- **About / attorney bios** — Credentials, experience, bar admissions, and a human touch. People hire people, not firms. Include a real photo.
- **FAQ** — Answer the questions clients actually ask on the first phone call. Great for SEO — people search for "do I need a lawyer for [X]?"
- **Contact** — Phone, email, office address. Include "free consultation" CTA if they offer it. Make the phone number tappable.
- **Testimonials** — Client testimonials build trust. Some jurisdictions restrict attorney testimonials — check state bar rules.
- **Blog** — Explainers on legal topics relevant to the practice. Avoid giving legal advice — frame as "general information, not legal advice." Disclaimers matter here.
- **Resources** — Court links, government forms, checklists ("what to bring to your first meeting"). Useful for clients and great for search traffic.

## Tools

- **Monica CRM** (open source, free) — Client relationship tracking. Good for solo practitioners and small firms.
- **Clio** (~$49/user/mo, proprietary, certified B-Corp) — Practice management with billing, time tracking, client portal. Expensive but purpose-built for law. B-Corp status is a plus. clio.com
- **Cal.com** (open source, free tier) — For scheduling consultations. Self-hostable alternative to Calendly.
- **LawPay** (proprietary, ~$20/mo + processing) — Trust-account compliant payment processing for attorneys. Required in many jurisdictions when accepting client payments online.

## Compliance

- **State bar advertising rules**: Every state regulates attorney advertising. Common requirements: disclaimers ("This is an advertisement"), no guarantees of outcomes, no misleading specialization claims. Check the state bar's rules before publishing.
- **Client confidentiality**: Never include client names, case details, or identifiable information without written consent. Testimonials require explicit permission.
- **IOLTA / trust accounting**: If accepting retainers or client funds online, payment processing must comply with trust accounting rules. Use a compliant processor like LawPay.
- **Disclaimer**: The website should include a disclaimer that content is for informational purposes only and does not create an attorney-client relationship. Add to footer or a dedicated page.
- **Accessibility**: Websites for government-adjacent services face higher scrutiny. Ensure ADA compliance.

## Content ideas

Answers to common client questions, explainers on legal topics (written for non-lawyers), case study summaries (anonymized), team updates, community involvement, changes in the law that affect clients, "what to expect" process guides, checklists ("what to bring to your consultation"), seasonal topics (tax law in Q1, estate planning around holidays), local court updates.

## Key dates

- **Law Day** (May 1) — ABA-sponsored. Community legal education, pro bono spotlights, "know your rights" content.
- **National Pro Bono Week** (last week Oct) — Highlight pro bono work, community involvement, access to justice.
- **Constitution Day** (Sep 17) — Relevant for civic-focused practices.

## Structured data

Use `LegalService` (or `Attorney`, `Notary`) with:
- name, address, phone, `openingHoursSpecification`
- `areaServed`
- `knowsAbout` (practice areas)
- `priceRange`

## Data tracking

- **Clients:** Name, Email, Phone, Practice Area, Status (Lead/Active/Closed), Referral Source, Notes, Created Date
- **Matters:** Client (linked), Type, Status (Consultation/Active/Closed), Open Date, Close Date, Value, Notes
- **Notes/Log:** Date, Client (linked), Subject, Details, Billable (checkbox)
