# Small Business Type Reference

Industry-specific guidance for the webmaster agent. These files supplement the core business types that are documented inline in the slash commands.

## How to use

When the owner selects "Other" during `/start` or `/design-interview`, check if their business matches one of these specialties. If so, read the relevant file and apply its recommendations for pages, tools, content, structured data, and compliance.

These files are reference material for the agent, not user-facing documentation.

## Core types (inline in prompts)

These have full coverage in `/start`, `/design-interview`, `/setup-customers`, and `docs/content-guide.md`:

- Farm or CSA
- Restaurant or food business
- Retail shop
- Legal or professional services
- Artist, maker, or craftsperson
- Content creator or influencer
- Service business (consulting, coaching, trades)

## Extended types (this directory)

| File | Business type |
|---|---|
| [farm.md](farm.md) | Farm, CSA, market garden, u-pick, farm stand (supplements core type) |
| [healthcare.md](healthcare.md) | Healthcare, wellness, therapy, dental, veterinary |
| [real-estate.md](real-estate.md) | Real estate agents, property management |
| [nonprofit.md](nonprofit.md) | Nonprofit overview — shared traits, then see sub-types: |
| [house-of-worship.md](house-of-worship.md) | Churches, synagogues, mosques, temples |
| [food-bank.md](food-bank.md) | Food banks, pantries, meal programs |
| [animal-shelter.md](animal-shelter.md) | Animal shelters, rescues, humane societies |
| [museum.md](museum.md) | Art, history, science, and children's museums |
| [youth-org.md](youth-org.md) | Youth sports, scouts, after-school, mentoring |
| [community-theater.md](community-theater.md) | Theater companies, orchestras, dance, arts councils |
| [social-services.md](social-services.md) | Shelters, crisis centers, housing, job training |
| [fitness.md](fitness.md) | Gyms, yoga studios, martial arts, personal training |
| [salon.md](salon.md) | Hair salons, spas, barbers, beauty services |
| [trades.md](trades.md) | Contractors, plumbers, electricians, HVAC, landscaping |
| [photography.md](photography.md) | Photographers, videographers |
| [pet-services.md](pet-services.md) | Grooming, boarding, training, dog walking |
| [hospitality.md](hospitality.md) | Bed & breakfasts, vacation rentals, tour operators |
| [education.md](education.md) | Tutors, music teachers, driving schools, test prep |
| [bookshop.md](bookshop.md) | Independent bookstores, used bookshops, comic stores |
| [grocery.md](grocery.md) | Independent grocery, co-ops, specialty food shops |
| [hardware.md](hardware.md) | Hardware stores, lumber yards, garden centers |
| [government.md](government.md) | Small towns, counties, special districts (water, fire, library, parks) |

## Multi-mode businesses

Most businesses span multiple types. See [multi-mode.md](multi-mode.md) for how to identify, merge, and structure guidance when a business has more than one mode (e.g., farm+hospitality, church+food bank). Key rules:

- `BUSINESS_TYPE` in `.site-config` supports comma-separated values (primary type first)
- Read the SMB doc for each type and merge: pages are unioned, compliance is additive, tools avoid duplication
- One website, one nav — secondary modes are sections, not separate sites

## Structure of each file

Every file follows the same format:

1. **Pages** — Priority pages for this business type
2. **Tools** — Industry-specific SaaS recommendations (following the SaaS criteria)
3. **Compliance** — Legal or regulatory considerations
4. **Content ideas** — What to blog about
5. **Structured data** — JSON-LD schema type and properties
6. **Data tracking** — Suggested tables and fields for the business type
