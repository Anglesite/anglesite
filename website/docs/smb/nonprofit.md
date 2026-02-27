# Nonprofit & Community Organization

Covers: charities, churches, community associations, clubs, advocacy groups, foundations.

## Pages

- **Mission / about** — Who you are, what you do, why it matters. This is the most important page.
- **Programs / services** — What the organization provides, who it serves
- **Get involved** — Volunteer opportunities, events, committees
- **Donate** — Clear call to action, link to donation platform
- **Events** — Upcoming events, past event recaps with photos
- **News / blog** — Impact stories, program updates, community news
- **Contact** — Office info, staff directory, board members (optional)
- **Transparency** — Annual reports, financials, 990 (builds donor trust)

## Tools

- **CiviCRM** (open source, nonprofit-backed) — Full CRM with donor management, memberships, event registration, mailings. Free. civicrm.org
- **Open Collective** (open source) — Transparent fundraising and expense tracking. Good for community groups. opencollective.com
- **Donorbox** (free up to $1000/mo in donations) — Embeddable donation forms. donorbox.org
- **GiveButter** (free, tips-based model) — Fundraising pages, events, donor CRM. givebutter.com
- **Cal.com** (open source, free tier) — For scheduling volunteer orientations or meetings.
- Avoid payment platforms that take large percentages. Nonprofits need every dollar.

## Compliance

- **501(c)(3) status**: Display the EIN and tax-exempt status on the donation page so donors know their gift is tax-deductible.
- **Solicitation registration**: Many US states require registration before soliciting donations online. The website should mention the state registration if applicable.
- **Gift acknowledgment**: If the site processes donations, the organization must provide written acknowledgment for gifts over $250. The donation platform usually handles this.
- **Churches**: Generally exempt from 501(c)(3) filing but should still display their nonprofit nature for donor confidence.

## Content ideas

Impact stories with specific numbers ("we served 200 families this month"), volunteer spotlights, event announcements and recaps, program milestones, seasonal campaigns, behind-the-scenes of operations, "where your dollar goes" breakdowns, community partner features.

## Structured data

Use `NGO` or `Church` or `EducationalOrganization` as appropriate, with:
- name, description, address (if physical), phone
- `nonprofitStatus` — "Nonprofit501c3" etc.
- `knowsAbout` for cause areas

## Airtable schema

- **Contacts:** Name, Email, Phone, Type (Donor/Volunteer/Member/Partner), Status, Notes, Created Date
- **Donations:** Contact (linked), Amount, Date, Campaign, Recurring (checkbox), Notes
- **Events:** Name, Date, Type, Volunteers Needed, RSVP Count, Notes
