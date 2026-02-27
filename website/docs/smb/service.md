# Service Business

Covers: consultants, coaches (business, life, executive), freelancers, virtual assistants, bookkeepers, event planners, marketing agencies, and other client-based service businesses. See also [trades.md](trades.md) for physical trades, [cleaning.md](cleaning.md) for cleaning services, [education.md](education.md) for teaching/tutoring, and [legal.md](legal.md) / [accounting.md](accounting.md) for licensed professions.

## Pages

- **Services** — Individual pages or sections per service offering. Clear descriptions of what's included, who it's for, and what the outcome is. Avoid jargon. Price ranges or "starting at" figures reduce tire-kicker inquiries.
- **About** — Credentials, experience, and personality. Clients hire the person. Include a real photo and a human bio alongside professional qualifications.
- **Process** — How an engagement works, step by step. "Here's what to expect" reduces anxiety for first-time buyers. First call → proposal → kickoff → delivery → follow-up.
- **Testimonials / case studies** — Results-focused. "Before working with [name], we had X problem. After, we achieved Y." Anonymize if needed, but get permission for named testimonials.
- **Blog** — Demonstrate expertise by answering the questions clients ask before they hire. This is the #1 search traffic driver for service businesses.
- **Book / schedule** — Link to Cal.com, Calendly, or a contact form. Reduce friction — every click between "I'm interested" and "I booked a call" loses people.
- **Contact** — Email, phone, scheduling link. Include timezone and response time expectations ("I respond within 24 hours").
- **Resources** — Templates, guides, checklists, tools the owner recommends. Builds authority and gives visitors a reason to return.

## Tools

- **Monica CRM** (open source, free) — Client relationship tracking. Good for solo practitioners. monicahq.com
- **Cal.com** (open source, free tier) — Scheduling. Self-hostable alternative to Calendly. cal.com
- **HoneyBook** (~$19/mo, proprietary) — Full client management with contracts, invoicing, and scheduling. Polished for creative and consulting businesses. honeybook.com
- **Dubsado** (~$20/mo, proprietary) — Similar to HoneyBook. Workflows, forms, contracts, invoicing. dubsado.com
- **Wave** (free, proprietary) — Invoicing and accounting. Good for solo service providers who don't need a full practice management tool. waveapps.com

## Compliance

- **Contracts**: Always use a written agreement. Scope of work, payment terms, cancellation policy, intellectual property ownership. Templates from SCORE or SBA are a starting point.
- **Professional licensing**: Some services require licenses (financial advising, certain coaching certifications, bookkeeping in some states). Check state requirements.
- **Insurance**: General liability at minimum. Professional liability (errors & omissions) for advice-based businesses. Required by some clients before engagement.
- **Tax obligations**: Service income is self-employment income (Schedule C). Quarterly estimated taxes apply. Mention during `/setup-customers`.
- **Non-compete / non-disclosure**: If working with business clients, understand confidentiality obligations. Don't share client information on the website without permission.

## Content ideas

Tips related to the service, client success stories, process explanations, availability updates, FAQ answers, industry news, "common mistakes" posts, before/after case studies, tool and resource recommendations, seasonal business planning advice, "what to look for when hiring a [service provider]" guides, behind-the-scenes of project work, templates and checklists (lead magnets), collaboration and partnership announcements.

## Key dates

- **National Small Business Week** (1st week May) — SBA-sponsored. Share your story, client wins, business milestones. Good for social media engagement.
- **Small Business Saturday** (Sat after Thanksgiving) — Not just retail. Service businesses can offer consultations, gift cards, or special packages.

## Structured data

Use `ProfessionalService` (or `ConsultingService`, `FinancialService`) with:
- name, address (if applicable), phone, `openingHoursSpecification`
- `areaServed`
- `knowsAbout` (specialties)
- `priceRange`

## Data tracking

- **Clients:** Name, Email, Phone, Company, Service Type, Status (Lead/Active/Completed/Inactive), Source, Notes, Created Date
- **Projects:** Client (linked), Service, Status (Proposal/Active/Completed), Start Date, End Date, Value, Notes
- **Invoices:** Client (linked), Project (linked), Amount, Date Sent, Date Paid, Status
