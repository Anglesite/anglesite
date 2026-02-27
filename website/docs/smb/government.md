# Municipal Government

Covers: small towns, villages, boroughs, counties, townships, special districts (water, fire, library, parks, school boards).

## Pages

- **Services** — What the government provides and how residents access it. Permits, licenses, utilities, waste collection, parks, transit. Link to online portals where they exist. This is the most-visited section after the home page.
- **Meetings / agendas** — Meeting schedule, agendas (posted in advance — often legally required), minutes, how to attend (in person and remote). For elected boards, this is the transparency backbone.
- **Officials / departments** — Elected officials with photos and contact info, department heads, staff directory. Residents need to know who to call.
- **News / announcements** — Road closures, water advisories, meeting notices, event announcements, public hearings. Time-sensitive content that drives repeat visits.
- **Calendar / events** — Public meetings, community events, seasonal programs, public hearings, election dates
- **About** — History, demographics, government structure, charter or code links
- **Contact** — Main office phone, department numbers, physical address, office hours. A "who do I call about X?" guide is extremely useful.
- **Documents / records** — Ordinances, budgets, annual reports, plans, public records request process. Often legally required to be publicly available.
- **Parks / recreation** — Facilities, programs, reservations, trail maps. Often the most-used community amenity.
- **Public safety** — Police/fire/EMS info, emergency contacts, community alerts, preparedness info
- **Permits / forms** — Building permits, business licenses, zoning applications, utility signup. Link to or embed forms.

For special districts, focus on the district's specific function:
- **Water/sewer district:** rates, service area, water quality reports, outage notifications, connection applications
- **Fire district:** station locations, fire prevention info, burn permits, board meetings
- **Library district:** catalog, hours/locations, programs, card registration, meeting rooms
- **Parks district:** facilities, programs, reservations, trail maps, seasonal hours

## Tools

- **CivicPlus** or **Municode** — Government website platforms. Many municipalities already use one. If they do, the Anglesite scaffold may not be the right fit — but small towns and special districts often don't have a website at all, which is exactly where Anglesite helps.
- **Granicus** — Meeting management, agendas, minutes, video archiving. govdelivery.com
- **Boardable** (~$99/mo, proprietary) — Board management for small boards. Meeting scheduling, document sharing, voting.
- **Nextdoor** — Community communication platform. Link from the website, don't rely on it as the primary channel.
- **Google Calendar embed** — Simple way to display meeting schedules and community events.
- **JotForm** or **Google Forms** — For permit applications, public records requests, feedback forms. JotForm has a government plan.
- Most small towns and special districts have no tools at all. Start simple — a static website with meeting info and contact numbers is a massive improvement over nothing.

## Compliance

- **Open meetings laws**: Every state has open meetings requirements. Post meeting agendas in advance (timing varies by state — often 24–72 hours). Post minutes after approval. The website is the easiest way to comply.
- **Public records**: Most states require governments to make records available upon request. Include a public records request process on the website. Link to the relevant state law.
- **ADA / Section 508**: Government websites must be accessible under ADA Title II and Section 508. WCAG AA is the minimum. This is not optional — it's federal law. Ensure all PDFs posted are accessible or provide alternative formats.
- **Election information**: Post election dates, polling locations, candidate information (for nonpartisan offices), and ballot measures. Be factual and nonpartisan.
- **Budget transparency**: Many states require publishing budgets, audits, and financial reports. Post these in the documents section.
- **Nondiscrimination**: Display Title VI nondiscrimination notice and ADA coordinator contact information.
- **FOIA/state equivalent**: Link to the public records request process and name the records custodian.
- **Posted document formats**: Avoid posting scanned image PDFs — they're not accessible. Use text-based PDFs or HTML. If scanning is unavoidable, OCR the document.

## Content ideas

Meeting summaries in plain language (not just posting raw minutes), road and infrastructure project updates, seasonal reminders (leaf pickup, snow plowing, water conservation), community event announcements, new ordinance explainers, budget breakdowns in simple terms, "meet your officials" profiles, public hearing notices, park and recreation program announcements, emergency preparedness tips, water quality reports with plain-language summaries.

## Structured data

Use `GovernmentOrganization` with:
- name, address, phone
- `department` for sub-offices
- `areaServed` for jurisdiction

For special districts, `GovernmentOrganization` is still appropriate. Add `description` with the district type.

## Airtable schema

Most government record-keeping has legal requirements that Airtable can't meet (retention schedules, FOIA compliance). Use Airtable only for non-sensitive operational tracking:

- **Contacts:** Name, Email, Phone, Role (Resident/Business/Vendor/Official), Notes, Created Date
- **Meetings:** Body (Council/Board/Commission), Date, Agenda URL, Minutes URL, Status (Scheduled/Complete), Notes
- **Projects:** Name, Department, Status (Planned/In Progress/Complete), Start Date, End Date, Budget, Notes
