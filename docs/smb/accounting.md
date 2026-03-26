# Accounting & Tax Preparation

Covers: CPA firms, bookkeeping services, tax preparation (seasonal and year-round), enrolled agents, payroll services, fractional CFO.

## Pages

- **Services** — Tax preparation (individual, business), bookkeeping, payroll, QuickBooks setup/cleanup, tax planning, audit representation. Be specific about what types of returns you handle (1040, 1065, 1120, 1120-S, 990).
- **About** — Credentials, experience, philosophy. CPA, EA (Enrolled Agent), and state licenses build trust. If you specialize in an industry (restaurants, construction, nonprofits, freelancers), say so.
- **Resources / tax tips** — Tax deadlines, document checklists, IRS links, estimated payment reminders. Genuinely helpful content that also drives seasonal traffic.
- **Client portal** — Link to your secure document exchange portal (don't build one on the website — use a professional tool). Make login easy to find.
- **Pricing** — At minimum, a pricing philosophy (flat fee vs. hourly, what affects cost). Tax prep clients want to know the ballpark before they call.
- **New clients** — What to bring, how to get started, onboarding process. Engagement letter explanation.
- **Testimonials** — Reviews from business clients and individuals.
- **Contact** — Phone, email, appointment scheduling. Seasonal hours (extended during tax season).

## Design

**Visual mood:** Trustworthy, organized, professional. The design signals precision and reliability — clients trust you with their most sensitive financial data.

**Color direction:** Cool blues or navy with conservative accents. White or light gray backgrounds. Avoid bright or trendy palettes — this is a credibility-first business.

**Typography feel:** Classic stack (serif headings — Georgia) for tradition and professionalism. Sans-serif body for readability. Heading weight 600–700. Restrained, not flashy.

**Layout emphasis:** Services and pricing are the primary draw — make them easy to scan. Tax season deadlines and document checklists should be prominent seasonally. Client portal login needs to be findable in one click (header or top of contact page). Use Pattern 1 (single column) for service pages, Pattern 2 (hero + content) for home. Max-width 48rem.

**Photography style:** Professional headshots with neutral backgrounds. Office environment optional. Avoid generic stock photos of calculators and spreadsheets. Clean, simple, human.

**Key component:** Service/pricing table — clear rows for each service offering with scope description and price range or "starting at" figure. Helps prospects self-qualify before calling.

## Tools

- **Drake Tax** / **Lacerte** / **ProSeries** / **UltraTax** — Professional tax preparation software. Industry standard, never suggest replacing.
- **SmartVault** / **Sharefile** / **Canopy** — Secure document exchange portals. Clients upload documents, firm delivers returns.
- **Cal.com** (open source, free tier) — Appointment scheduling for consultations.
- **Buttondown** (open source) — Tax deadline reminders, seasonal newsletters.
- Many small firms run on the professional tax software plus a phone. Don't overcomplicate.

## Review platforms

- **Google Business Profile** — The primary channel for finding local accountants and tax preparers. Clients search "CPA near me" or "tax preparer [city]" and choose based on reviews. Reviews that mention specific situations ("they helped me navigate an audit," "explained everything clearly") are especially persuasive. Respond to every review — it signals professionalism.
- **Yelp** — Used for accountants and tax preparers in some markets, particularly urban areas. Claim the profile and keep it current. A client who had a good tax season experience is often willing to leave a quick Yelp review if asked.
- **Google** (again, via search results) — Google sometimes surfaces individual practitioner profiles (not just the business). If the firm has individual CPAs, those profiles should be complete.

The best time to ask for a review is right after a successful tax filing, audit resolution, or first year of bookkeeping. A brief email: "It was great working with you this tax season. If you have a minute, a Google review would help other small businesses find us." Keep it simple. Most clients appreciate the ask.

**Note:** AICPA and state CPA boards have ethics guidance on soliciting testimonials. Reviews from genuinely satisfied clients are generally acceptable; endorsement-style testimonials can require disclosures. Check state board guidance.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Credentials display**: CPA license numbers are state-regulated. Display state(s) of licensure. Enrolled Agents should display EA credentials and PTIN. Non-credentialed preparers must have a PTIN and comply with state registration if required.
- **IRS Circular 230**: Governs practice before the IRS. Limits how tax professionals can advertise (no guarantees of results, no misleading claims about credentials).
- **AICPA / state board ethics**: CPAs are bound by professional ethics standards regarding confidentiality, independence, and advertising.
- **Data security**: Tax returns contain the most sensitive personal data (SSN, income, bank accounts). The website itself shouldn't collect this — link to a secure portal. State clearly how documents are transmitted and stored.
- **Engagement letters**: Mention that all services begin with an engagement letter defining scope. This is both a best practice and a compliance requirement in many states.
- **E-file authorization**: IRS requires signed authorization (Form 8879) before e-filing. This is a process item, not a website item, but informs how you describe the tax prep process.
- **State licensing**: Some states require tax preparers to register even if not a CPA or EA (e.g., Oregon, California CTEC, Maryland, New York).

## Content ideas

Tax deadline reminders, "documents you need for your tax appointment" checklists, tax law change summaries (annual), deduction guides by profession, estimated tax payment reminders (quarterly), "should I itemize?" explainers, small business tax tips, retirement contribution deadline reminders, IRS notice explainers, year-end tax planning strategies, "new client" walkthroughs.

## Key dates

- **Tax Day** (Apr 15) — The biggest day. "Last chance" content, extension reminders, "what if you missed it" posts.
- **Estimated tax deadlines** (Apr 15, Jun 15, Sep 15, Jan 15) — Quarterly reminders for self-employed clients.
- **Financial Literacy Month** (Apr) — Educational content, budgeting tips, tax planning basics.

## Structured data

Use `AccountingService` (schema.org) with:
- name, address, phone, hours
- `hasOfferCatalog` for service categories

## Data tracking

- **Clients:** Name, Email, Phone, Entity Type (Individual/Business), Services, Tax Year(s), Status, Notes
- **Deadlines:** Client (linked), Filing Type, Due Date, Extended (yes/no), Status (Not Started/In Progress/Filed), Notes
