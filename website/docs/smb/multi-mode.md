# Multi-Mode Businesses

Most small businesses don't fit one category. A farm hosts Airbnb guests. A church runs a food pantry. A bookshop has a stage. A salon teaches classes. This is normal — don't force a single label.

## Identifying multi-mode businesses

During `/start`, listen for clues:

- "We're a farm, but we also rent out cabins"
- "It's a church — we run a food pantry and after-school program too"
- "We're a bookshop with a small stage for readings and comedy nights"
- "I'm a photographer but I also teach workshops"

If the owner describes multiple activities, ask: **"Which of these is the primary thing — the one most visitors come for?"** That's the primary type. The others are secondary modes.

## How to store it

Use comma-separated values in `BUSINESS_TYPE`:

```sh
echo "BUSINESS_TYPE=farm,hospitality" >> .site-config
```

The first value is the primary type. The agent reads the SMB doc for each type and merges the guidance.

## How to merge

### Pages — union, then prioritize

Combine the page lists from all types. Remove exact duplicates (every type has "About" and "Contact"). The primary type's pages come first in navigation. Secondary mode pages can be nested or grouped:

- A farm+hospitality site: main nav has farm pages (what we grow, CSA, markets), plus a "Stay with us" section for the hospitality pages (rooms, rates, book)
- A church+food bank: main nav has worship pages (service times, sermons), plus a "Food pantry" section (get food, donate food, volunteer)

Don't create a flat nav with 20 items. Group secondary modes under clear headings.

### Tools — prefer multi-purpose, avoid duplicates

If both types recommend the same tool category (e.g., both suggest Square for payments), list it once. If one type has a specialized tool (e.g., Planning Center for churches), keep it — it won't conflict with the farm tools.

Watch for redundancy: don't recommend separate CRMs for each mode. One CRM with tagged contacts is better than two systems.

### Compliance — union of all requirements

This is non-negotiable. Compliance requirements are additive. A farm+hospitality business must follow both agricultural regulations AND lodging regulations. A church+food bank must follow both tax-exempt rules AND USDA food distribution requirements.

Never drop a compliance requirement because it came from a secondary mode. When in doubt, include it.

### Structured data — multiple types

JSON-LD supports multiple types. Use an array:

```json
{
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "Farm", "LodgingBusiness"],
  "name": "...",
  "address": "..."
}
```

Or use separate JSON-LD blocks on relevant pages — farm schema on the home page, LodgingBusiness schema on the "stay with us" page.

### Content ideas — blend the streams

The most interesting content often comes from the intersection of modes:

- Farm+event venue: "Our barn in every season" photo series, wedding features on the farm
- Farm+hospitality: "A weekend on the farm" guest experience posts
- Church+food bank: impact stories connecting both missions
- Bookshop+theater: event previews that cross both worlds
- Photographer+educator: teaching posts that showcase portfolio work
- Food-as-craft: process videos that show the art of decorating, recipe-adjacent content, "behind the order" stories

### Data tracking — merge tables, add a Mode/Type field

Don't create separate tracking for each mode. Merge into shared tables with a field that distinguishes the mode:

- **Contacts** table serves all modes — add a Type field with values from each mode (e.g., "CSA Member", "Cabin Guest", "Workshop Student")
- **Events** table serves all modes — add a Category field
- Mode-specific tables are fine when the data is truly different (e.g., Animals table for a shelter, Reservations for hospitality)

## Common multi-mode patterns

These combinations appear frequently. The agent should recognize them:

| Pattern | Primary | Secondary | Key consideration |
|---|---|---|---|
| **Agritourism** | Farm | Hospitality, Event venue | Separate booking for farm activities vs. lodging vs. events. Agritourism liability statutes. Zoning check required for each activity type. |
| **Farm-to-table** | Farm | Restaurant | Menu changes seasonally. Content connects plate to field. |
| **Farm + retail** | Farm | Retail | Farm stand or on-farm shop. Square POS for both. |
| **Church + food bank** | House of worship | Food bank | Separate "get food" page from worship info. Different audiences. |
| **Church + social services** | House of worship | Social services | Client privacy rules from social services apply. Never mix congregation directory with client records. |
| **Church + youth org** | House of worship | Youth org | Child safety policies from youth org apply to all youth ministry. |
| **Bookshop + events** | Bookshop | Community theater | Events calendar pulls double duty. One ticketing system. |
| **Museum + education** | Museum | Education | School visit booking, teacher resources. Already covered in museum.md but depth in education.md. |
| **Salon + education** | Salon | Education | Training academy or continuing ed. Separate class schedule from appointment booking. |
| **Photographer + educator** | Photography | Education | Workshop booking separate from client session booking. |
| **Food as craft** | Artist/maker | Restaurant | Custom decorated cookies, cake design, artisan chocolate, bread art. Portfolio organized by occasion, not a restaurant menu. Custom order workflow, not catering. If baking from home, cottage food compliance (see restaurant.md), not health department permits. |
| **Maker + marketplace** | Artist/maker | Retail | Sells on Etsy/Faire plus own website. Website is home base for custom orders and repeat customers; marketplace is for discovery. See marketplace integration in artist.md. |
| **Retail + maker** | Retail | Artist/maker | Shop page doubles as portfolio. Commission and custom order process. |
| **Farm + event venue** | Farm | Event venue | Zoning is critical — agricultural zoning may not permit commercial events. Agritourism statutes may help. Separate booking for farm activities vs. venue rental. |
| **Farm + hospitality** | Farm | Hospitality | Separate booking for farm activities vs. lodging. Agritourism liability statutes. |
| **Property + mixed use** | Varies | Varies | Landowner with multiple uses (events, lodging, farm, campground). Primary type is whatever drives the most revenue. Zoning review essential — different uses may require different permits. |
| **Fitness + wellness** | Fitness | Healthcare | Practitioner bios need credentials. Waivers for both fitness and treatment. |
| **Hospitality + restaurant** | Hospitality | Restaurant | Menu page, reservation system. Guests vs. walk-in diners. |
| **Nonprofit + retail** | Any nonprofit | Retail | Thrift stores, museum gift shops, shelter resale. Revenue supports mission. |

## What NOT to do

- **Don't create separate websites.** One site, one domain, one navigation. Modes are sections, not silos.
- **Don't overwhelm the home page.** The primary type dominates the home page. Secondary modes get clear links but don't compete for hero space.
- **Don't duplicate contact pages.** One contact page with sections if needed ("For lodging inquiries..." / "For CSA questions...").
- **Don't recommend separate tools per mode** unless the tools genuinely serve different functions. One booking system, one payment processor, one CRM.
