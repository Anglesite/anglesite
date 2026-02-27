# Food Bank & Pantry

Covers: food banks, food pantries, soup kitchens, meal delivery programs, community fridges.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Get food / find help** — The most important page. Distribution locations, hours, eligibility (keep it simple — avoid bureaucratic language). No one should leave the website confused about how to get food.
- **Donate** — Money, food drives, corporate partnerships. Most food banks can turn $1 into multiple meals — state the multiplier.
- **Volunteer** — Shifts, sign-up link, what to expect, group volunteering for corporate/school groups
- **About / mission** — Impact stats, history, the need in the community
- **Programs** — Mobile pantry, home delivery, school backpack programs, senior boxes, SNAP enrollment help
- **Partner agencies** — If the org distributes through partner sites, list them with hours and addresses
- **Events** — Food drives, fundraisers, community meals, volunteer days
- **News / blog** — Impact stories, food drive results, program updates
- **Contact** — Office phone, helpline if applicable

## Tools

- **Link2Feed** (pricing varies, proprietary) — Purpose-built for food banks. Client intake, reporting, USDA compliance. link2feed.com
- **Pantry Soft** (~$50/mo, proprietary) — Food pantry management. Inventory, clients, volunteers, reporting. pantrysoft.com
- **SignUpGenius** (free tier, proprietary) — Volunteer shift scheduling. Simple and well-known. signupgenius.com
- **GiveButter** (free, tips-based) — Fundraising pages with built-in donor management.
- **Google Maps embed** — Critical for distribution locations. Embed a map on the "get food" page.

## Compliance

- **USDA requirements**: If receiving USDA commodities (TEFAP), display the USDA nondiscrimination statement and complaint process on the website. This is federally required.
- **Client privacy**: Never display client names, photos, or identifiable information without explicit consent. Food insecurity carries stigma — protect dignity.
- **Allergen info**: If distributing prepared meals, note common allergens.
- **Good Samaritan Act**: Food donors are protected from liability. Mention this on the "donate food" page to encourage donations.

## Content ideas

Impact numbers ("this month we served X families"), food drive announcements and results, volunteer spotlights, partner agency features, seasonal needs ("holiday meal program"), recipes using common pantry items, SNAP/benefits enrollment info, community garden updates, donor recognition (with permission), behind-the-scenes of operations.

## Key dates

- **National Food Bank Day** (1st Fri Sep) — Volunteer drives, impact stories, donation campaigns.
- **Hunger Action Month** (Sep) — Awareness content, advocacy, community events, food drive coordination.
- **Hunger and Homelessness Awareness Week** (week before Thanksgiving) — Intensified fundraising, media outreach, volunteer recruitment.

## Structured data

Use `NGO` with:
- name, address, phone
- `nonprofitStatus` — "Nonprofit501c3"
- `knowsAbout` — "food assistance", "hunger relief"
- `areaServed` for service territory

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Donor/Volunteer/Partner Agency/Corporate), Notes, Created Date
- **Volunteers:** Contact (linked), Availability, Skills, Status, Hours Logged, Notes
- **Food Drives:** Name, Organizer (linked), Date, Pounds Collected, Notes
