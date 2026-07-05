# Insurance Agency

Covers: independent insurance agents, captive agents (State Farm, Allstate, Farmers), insurance brokers, benefits consultants.

## Pages

- **Products** — Auto, home, renters, life, business/commercial, umbrella, health, Medicare supplements. Organized by personal and commercial. Brief descriptions of each, not policy details.
- **About** — Agent bio, carrier appointments (which companies you represent), community involvement, years in business. Independent agents should emphasize choice — "we shop multiple carriers for you."
- **Get a quote** — Quote request form: type of insurance, basic info, contact. Keep the form short — complex quoting happens by phone or in the carrier system. The form captures the lead.
- **File a claim** — Links to each carrier's claims process, main claims phone numbers. Clients look for this when something bad has happened — make it easy to find.
- **Client resources** — Policy change requests, certificate requests, payment links, carrier login pages. Reduce phone calls for routine tasks.
- **Testimonials** — Trust is central to insurance. Reviews from long-term clients.
- **Blog** — Seasonal risk reminders, coverage explainers, local risk factors.
- **Contact** — Phone, email, hours, appointment scheduling.

## Design

**Visual mood:** Approachable but credible. Warm professionalism — clients need to feel safe and confident, not intimidated. The design should say "we'll take care of you."

**Color direction:** Blues, greens, and warm grays. A touch of warmth to avoid feeling corporate. Avoid stark or cold palettes. Earth tones as accents work well for independent agents.

**Typography feel:** Humanist stack (Segoe UI / Roboto) for approachability and warmth. Heading weight 600. Friendly but not casual — insurance is a trust business.

**Layout emphasis:** Quote request CTA is the primary conversion — keep it prominent on every page. Carrier logos build credibility for independent agents. Claims links need to be easy to find when something bad has happened. Use Pattern 2 (hero + content) for home. Max-width 56rem.

**Photography style:** Family and lifestyle stock photography is acceptable here — insurance is about protecting what matters. Local community photos are even better. Avoid staged corporate imagery. Warm, natural lighting.

**Key component:** Coverage comparison cards or quote request form. Comparison cards show product types (auto, home, life, business) with brief descriptions and "get a quote" CTAs. The quote request form should be short — name, insurance type, contact info — complex quoting happens offline.

## Tools

- **Agency management systems** (Applied Epic, HawkSoft, EZLynx, AMS360) — Core agency systems. Never suggest replacing these. The website links to client portals if available.
- **Cal.com** (open source, free tier) — Appointment scheduling for policy reviews.
- **Buttondown** (open source) — Policy renewal reminders, seasonal tips newsletters.
- **Map listings** — Critical for local insurance agents. Claim the business on Google Business Profile, Apple Business Connect, and OpenStreetMap. Most clients find agents through local search. See `docs/webmaster.md` → Map listings.
- Most agencies have a carrier-provided or vendor website. Independent agents may want something better — that's the Anglesite opportunity.

## Review platforms

- **Google Business Profile** — The primary channel for local insurance agents. "Insurance agent near me" or "State Farm agent [city]" goes to Google. Clients researching an agent before their policy review or after getting a referral will check Google. Reviews that mention responsiveness and help at claim time ("when our basement flooded, they were there immediately") are the most persuasive.
- **Yelp** — Used for insurance agencies in some markets, particularly for independent agents. Claim the listing and respond to reviews. Yelp is more relevant in urban markets.
- **Facebook** — Insurance clients often stay with an agent for years and refer friends and family. A Facebook business page where satisfied clients can leave recommendations and share their experience is a natural fit for a referral-based business. Ask long-term clients to leave a Facebook recommendation.

**Note:** State insurance department advertising regulations may restrict certain kinds of testimonials (no guarantees of outcomes, no misleading claims). Review your state's advertising rules before featuring specific client quotes or outcome claims. In general, reviews describing service quality and responsiveness are safe; reviews that sound like they promise savings or specific outcomes need more care.

See `docs/smb/reviews.md` for full review management guidance.

## Compliance

- **State licensing**: Insurance agents and agencies must be licensed in every state where they sell. Display license numbers. Individual agent licenses are public record.
- **Carrier appointments**: Agents can only sell for carriers they're appointed with. If listing carriers, only list those you're actively appointed with.
- **E&O (Errors & Omissions)**: Professional liability insurance for agents. Not displayed on website but essential.
- **Advertising regulations**: State insurance departments regulate advertising. Don't guarantee coverage, don't make misleading comparisons, don't use "lowest price" claims unless substantiated.
- **Privacy (GLBA)**: Gramm-Leach-Bliley Act requires a privacy policy for financial institutions, including insurance agencies. Must be prominently linked.
- **Medicare-specific rules**: If selling Medicare supplements or Medicare Advantage, CMS marketing guidelines are strict. No unsolicited contact, specific disclaimers required, scope of appointment rules.
- **Do Not Call**: Insurance telemarketing is regulated. Not a website item, but quote form submissions don't constitute consent to unlimited calls — note your contact practices.

## Content ideas

Seasonal risk tips (winter driving, hurricane prep, wildfire defense), "do I need umbrella insurance?" explainers, home inventory guides, coverage gap warnings, local weather/risk alerts, life event coverage reviews (new baby, new home, retirement), small business insurance guides, teen driver tips, claim process walkthroughs, carrier spotlight posts, community sponsorship recaps.

## Key dates

- **Financial Literacy Month** (Apr) — Insurance education, coverage review reminders, "are you underinsured?" content.
- **National Insurance Awareness Day** (Jun 28) — Coverage checkup promotions, policy review offers.
- **National Preparedness Month** (Sep) — Disaster insurance, emergency planning, flood/hurricane coverage.

## Structured data

Use `InsuranceAgency` (schema.org) with:
- name, address, phone, hours
- `areaServed` for service area

## Data tracking

- **Clients:** Name, Phone, Email, Policy Types, Carrier(s), Renewal Date(s), Notes
- **Leads:** Name, Phone, Email, Insurance Type, Source, Status (New/Contacted/Quoted/Sold/Lost), Notes
