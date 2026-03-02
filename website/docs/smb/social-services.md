# Social Services

Covers: homeless shelters, domestic violence shelters, crisis centers, housing assistance programs, job training organizations, substance abuse recovery, legal aid, refugee resettlement.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Get help** — The most important page. Services offered, eligibility, how to access help, crisis hotline numbers. Must be clear, compassionate, and barrier-free. Available in multiple languages if the community needs it.
- **Programs** — Detailed descriptions of each program: who it serves, what's provided, how to enroll, what to expect
- **Crisis resources** — Hotline numbers, 24/7 contacts, text lines, chat links. For DV shelters: safety planning info. Display prominently — not buried.
- **About** — Mission, impact stats, leadership, staff, history
- **Donate** — Financial support, wish lists (toiletries, clothing, furniture for housing programs), corporate partnerships, in-kind donations
- **Volunteer** — Opportunities, requirements (background checks, training), sign-up
- **Referral partners** — For agencies that refer clients: how to make a referral, intake process
- **Events** — Fundraisers, awareness campaigns, community events
- **News / blog** — Impact stories (with great care for client privacy), program updates, advocacy updates
- **Contact** — Office hours, intake phone, referral contacts

## Design

- **Visual mood:** Dignified, accessible, and reassuring. Many visitors arrive in crisis. The design must feel calm, trustworthy, and immediately useful.
- **Color direction:** Warm, calming colors — soft blues, greens, and warm neutrals. Must not feel clinical or bureaucratic. Avoid harsh whites, institutional grays, or anything that feels cold or impersonal.
- **Typography feel:** Humanist sans-serif (Segoe UI/Roboto stack). Large, clear text. Many visitors are reading under stress, on older devices, or in unfamiliar languages. Legibility is paramount.
- **Layout emphasis:** Pattern 2 (hero + content) for the home page. "How to get help" and crisis contact numbers above the fold in large text. Accessibility is paramount — many visitors are in crisis and need information immediately. Max-width 48rem. Minimal visual noise.
- **Photography style:** Warm community photos showing support, connection, and agency. Never show clients in identifiable or vulnerable situations. 4:3 aspect ratio. Soft, warm treatment.
- **Key component:** Help finder — clear categories of assistance (housing, food, safety, jobs, legal) with phone numbers and next steps for each. A person in crisis should find the right resource within seconds.

## Tools

- **Apricot by Bonterra (formerly Social Solutions)** — Case management built for human services. Client tracking, outcomes, reporting. apricot.socialsolutions.com
- **CaseWorthy** — Case management for housing, homelessness, workforce development.
- **CiviCRM** (open source, nonprofit-backed) — Donor and volunteer management. Not case management, but good for the fundraising side.
- **SignUpGenius** (free tier) — Volunteer scheduling.
- **GiveButter** (free, tips-based) — Fundraising campaigns.
- Most social service orgs have case management requirements from funders (HUD, SAMHSA, etc.) that dictate their system. Don't try to replace it.

## Compliance

- **Client privacy**: This is paramount. Never display client names, photos, stories, or any identifying information without explicit written consent. Many clients face safety risks (DV survivors, undocumented individuals). Default to full anonymity.
- **DV shelter location**: NEVER publish the physical address of a domestic violence shelter on the website. Use a P.O. box or office address. This is a safety issue.
- **HIPAA**: If the organization provides health or mental health services, HIPAA applies. Don't collect health information through the website.
- **Funder requirements**: Many programs have reporting and visibility requirements from government funders. Display required funder logos and nondiscrimination statements.
- **Nondiscrimination**: Display a nondiscrimination policy. Many funders (HUD, FEMA, etc.) require this.
- **Language access**: If serving a multilingual community, key pages (especially "get help" and "crisis resources") should be available in the primary languages of the community served.

## Content ideas

Impact stories (anonymized or with explicit consent — never pressure clients), program milestone announcements ("we housed 50 families this year"), volunteer spotlights, donor recognition, awareness month features (Hunger and Homelessness Awareness Week, DV Awareness Month), policy and advocacy updates, community resource roundups, staff spotlights, fundraiser announcements and recaps.

## Key dates

- **Social Work Month** (Mar) — Staff spotlights, impact stories, advocacy, volunteer appreciation.
- **Domestic Violence Awareness Month** (Oct) — Resource sharing, awareness campaigns, community partnerships.
- **Hunger and Homelessness Awareness Week** (Nov) — Fundraising push, volunteer drives, media outreach.

## Structured data

Use `NGO` with:
- name, address (office, not shelter location), phone
- `nonprofitStatus` — "Nonprofit501c3"
- `knowsAbout` for service areas
- `areaServed`

## Data tracking

Note: Case management data should NOT be in Airtable — use a proper case management system. Airtable is only for the fundraising/volunteer side:

- **Contacts:** Name, Email, Phone, Type (Donor/Volunteer/Partner Agency/Funder), Notes, Created Date
- **Volunteers:** Contact (linked), Role, Availability, Background Check Date, Training Date, Status, Notes
- **Campaigns:** Name, Goal Amount, Raised Amount, Start Date, End Date, Notes
