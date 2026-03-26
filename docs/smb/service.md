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

## Design

**Visual mood:** Clean, professional, and adaptable. Service businesses vary widely — the design should feel competent and polished without being locked to any one industry aesthetic.

**Color direction:** Adaptable palette based on the specific service type. Neutrals (white, warm gray, charcoal) as a foundation with one or two accent colors that reflect the owner's personality and field. Consultants can go bolder than bookkeepers. Avoid overly corporate palettes for solo practitioners.

**Typography feel:** Modern stack (system-ui) for a clean, contemporary look. Heading weight 600–700. Professional and current. The typography should feel confident without being heavy-handed.

**Layout emphasis:** Clear service descriptions and a booking CTA are the core conversion path. The "process" page reduces buyer anxiety — make it prominent. Blog content drives search traffic and demonstrates expertise. Use Pattern 2 (hero + content) for home, Pattern 4 (card grid) for services. Max-width 56rem.

**Photography style:** Professional headshot of the owner is essential — clients hire the person. Natural, approachable, well-lit. Workspace or in-action photos add authenticity. Avoid generic stock. If using lifestyle photography, it should reflect the actual client base.

**Key component:** Service card — service name, brief description, who it's for, outcome, and CTA ("book a call" or "learn more"). Each card should help a prospect self-select into the right service.

## Tools

- **Monica CRM** (open source, free) — Client relationship tracking. Good for solo practitioners. monicahq.com
- **Cal.com** (open source, free tier) — Scheduling. Self-hostable alternative to Calendly. cal.com
- **HoneyBook** (~$19/mo, proprietary) — Full client management with contracts, invoicing, and scheduling. Polished for creative and consulting businesses. honeybook.com
- **Dubsado** (~$20/mo, proprietary) — Similar to HoneyBook. Workflows, forms, contracts, invoicing. dubsado.com
- **Wave** (free, proprietary) — Invoicing and accounting. Good for solo service providers who don't need a full practice management tool. waveapps.com

## Review platforms

- **Google Business Profile** — The baseline for all service businesses. When a referral checks out a consultant or coach, Google is the first stop. A service business with 15+ reviews and a strong rating looks legitimate and established. Reviews that describe specific outcomes ("helped me increase revenue by 40%," "completely transformed how I run my calendar") convert better than generic praise. Respond to every review.
- **Yelp** — Relevant for some service categories (event planners, bookkeepers, coaches) in urban markets. Claim the profile if the business appears there.
- **LinkedIn** (recommendations, not traditional reviews) — For B2B service businesses — consultants, coaches, fractional CFOs — LinkedIn recommendations are often more credible than Google reviews. Encourage clients to write a recommendation on LinkedIn. These feed directly into the profile that business clients will check.
- **Clutch.co** (for agencies and B2B services) — A review platform specifically for agencies, software companies, and B2B service providers. If the business serves other businesses, Clutch is worth claiming and building reviews on.
- **Facebook** — For consumer-facing service businesses (event planners, life coaches, virtual assistants), a Facebook business page with visible recommendations provides social proof for clients who found the business through social referrals.

Testimonials displayed on the website (case studies, client quotes) are often more persuasive than platform reviews for high-ticket service businesses — a detailed case study outweighs 50 one-sentence Google reviews for a six-month consulting engagement. Both matter; they serve different audiences at different points in the decision process.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **Contracts**: Always use a written agreement. Scope of work, payment terms, cancellation policy, intellectual property ownership. Templates from SCORE or SBA are a starting point.
- **Professional licensing**: Some services require licenses (financial advising, certain coaching certifications, bookkeeping in some states). Check state requirements.
- **Insurance**: General liability at minimum. Professional liability (errors & omissions) for advice-based businesses. Required by some clients before engagement.
- **Tax obligations**: Service income is self-employment income (Schedule C). Quarterly estimated taxes apply.
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
