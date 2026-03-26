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

## Design

- **Visual mood:** Warm, dignified, and community-focused. Never poverty-tourism imagery. The design must respect the people it serves.
- **Color direction:** Warm greens, oranges, and earthy browns. Approachable and grounded. Avoid clinical whites or charity-cliche reds.
- **Typography feel:** Humanist sans-serif (Segoe UI/Roboto stack). Clear and legible — many visitors may be reading on older devices or in stressful situations.
- **Layout emphasis:** Pattern 2 (hero + content) for the home page. Hours, location, and "How to Get Help" above the fold. Accessibility of information is the number one design priority — large text, clear hierarchy, minimal clutter. Max-width 48rem.
- **Photography style:** Community photos showing dignity and agency, not despair. Volunteers in action, food distribution in progress, community meals. 4:3 aspect ratio. Warm, natural lighting.
- **Key component:** Location and hours finder — clear, large text, easy to scan on any device. If multiple distribution sites exist, each one gets its own entry with address, hours, and what to bring.

## Tools

- **Link2Feed** (pricing varies, proprietary) — Purpose-built for food banks. Client intake, reporting, USDA compliance. link2feed.com
- **Pantry Soft** (~$50/mo, proprietary) — Food pantry management. Inventory, clients, volunteers, reporting. pantrysoft.com
- **SignUpGenius** (free tier, proprietary) — Volunteer shift scheduling. Simple and well-known. signupgenius.com
- **GiveButter** (free, tips-based) — Fundraising pages with built-in donor management.
- **Map embed** — Critical for distribution locations. Embed OpenStreetMap (privacy-friendly, no third-party JS) or link to Google Maps, Apple Maps, and OpenStreetMap on the "get food" page.

## Compliance

- **USDA requirements**: If receiving USDA commodities (TEFAP), display the USDA nondiscrimination statement and complaint process on the website. This is federally required.
- **Client privacy**: Never display client names, photos, or identifiable information without explicit consent. Food insecurity carries stigma — protect dignity.
- **Allergen info**: If distributing prepared meals, note common allergens.
- **Good Samaritan Act**: Food donors are protected from liability. Mention this on the "donate food" page to encourage donations.

## Review platforms

Review platforms are less relevant for food banks — people seeking help don't rely on Yelp stars, and donors are driven by trust and mission alignment rather than review scores.

If the organization has a Google Business Profile (many food banks do, since they have a physical location), keep it accurate — especially hours and holiday closures. Volunteers and donors sometimes find the pantry via Google Maps, and reviews there occasionally reflect donor or volunteer experiences.

See `docs/smb/reviews.md` for general review management guidance.

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
