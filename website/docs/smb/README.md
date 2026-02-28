# Small Business Type Reference

Industry-specific guidance for the webmaster agent. Each file covers one business type with pages, tools, compliance, content, and data tracking recommendations.

## How to use

1. Read `BUSINESS_TYPE` from `.site-config` (may be comma-separated for multi-mode businesses).
2. Read the matching file from this directory.
3. When the SMB file's Tools section mentions a shared platform (Square, Cal.com, Google Business Profile, Buttondown, Mailchimp, Yelp, TripAdvisor, HoneyBook, Ko-fi, The Knot), read the matching file from `docs/platforms/` for setup and integration guidance.
4. Apply recommendations during `/start`, `/design-interview`, `/setup-customers`, and ongoing content planning.

Only read the file(s) relevant to the owner's business type. Don't load all files — keep context focused.

These files are reference material for the agent, not user-facing documentation.

## Business types

| File | Business type |
|---|---|
| [accounting.md](accounting.md) | CPA firms, tax preparation, bookkeeping, payroll services |
| [animal-shelter.md](animal-shelter.md) | Animal shelters, rescues, humane societies |
| [artist.md](artist.md) | Visual artists, sculptors, potters, woodworkers, jewelers, makers |
| [auto-dealer.md](auto-dealer.md) | Used car dealers, specialty/classic dealers, motorcycle, RV |
| [bookshop.md](bookshop.md) | Independent bookstores, used bookshops, comic stores |
| [brewery.md](brewery.md) | Breweries, wineries, distilleries, cideries, tasting rooms |
| [campground.md](campground.md) | RV parks, campgrounds, glamping, seasonal parks |
| [car-wash.md](car-wash.md) | Car washes, auto detailing, mobile detailing, ceramic coating |
| [childcare.md](childcare.md) | Daycare, preschool, in-home daycare, after-school, learning centers |
| [cleaning.md](cleaning.md) | Residential cleaning, commercial janitorial, carpet/window cleaning |
| [community-theater.md](community-theater.md) | Theater companies, orchestras, dance, arts councils |
| [creator.md](creator.md) | Bloggers, social media influencers, newsletter writers, online educators |
| [credit-union.md](credit-union.md) | Credit unions, CDFIs, cooperative banks |
| [dance-studio.md](dance-studio.md) | Ballet, hip-hop, ballroom, social dance, children's dance, competitive teams |
| [education.md](education.md) | Tutors, music teachers, driving schools, test prep |
| [entertainment.md](entertainment.md) | Bowling, escape rooms, mini golf, arcades, trampoline parks, skating rinks |
| [equipment-rental.md](equipment-rental.md) | Tool rental, party rental, tent/table/chair, inflatables, heavy equipment |
| [event-venue.md](event-venue.md) | Barn venues, estate venues, garden venues, retreat centers, event spaces |
| [farm.md](farm.md) | Farm, CSA, market garden, u-pick, farm stand |
| [fitness.md](fitness.md) | Gyms, yoga studios, martial arts, personal training |
| [florist.md](florist.md) | Flower shops, floral design, wedding/event florists, plant shops |
| [food-bank.md](food-bank.md) | Food banks, pantries, meal programs |
| [funeral-home.md](funeral-home.md) | Funeral homes, mortuaries, cremation, memorial services |
| [government.md](government.md) | Small towns, counties, special districts (water, fire, library, parks) |
| [grocery.md](grocery.md) | Independent grocery, co-ops, specialty food shops |
| [hardware.md](hardware.md) | Hardware stores, lumber yards, garden centers |
| [healthcare.md](healthcare.md) | Healthcare, wellness, therapy, dental, veterinary |
| [hospitality.md](hospitality.md) | B&Bs, boutique hotels, vacation rentals, tour operators |
| [house-of-worship.md](house-of-worship.md) | Churches, synagogues, mosques, temples |
| [insurance.md](insurance.md) | Insurance agents, brokers, benefits consultants |
| [laundry.md](laundry.md) | Dry cleaners, laundromats, wash-and-fold, laundry delivery |
| [legal.md](legal.md) | Law firms, solo attorneys, notaries, mediators |
| [marina.md](marina.md) | Marinas, boat dealers, boat repair, charter fishing, kayak rental |
| [museum.md](museum.md) | Art, history, science, and children's museums |
| [musician.md](musician.md) | Bands, solo artists, DJs, singer-songwriters, music producers |
| [nonprofit.md](nonprofit.md) | Nonprofit overview — shared traits, then see sub-types |
| [pet-services.md](pet-services.md) | Grooming, boarding, training, dog walking |
| [pharmacy.md](pharmacy.md) | Independent pharmacies, compounding, specialty pharmacies |
| [photography.md](photography.md) | Photographers, videographers |
| [podcaster.md](podcaster.md) | Podcast shows, podcast networks, podcast studios |
| [printing.md](printing.md) | Print shops, sign makers, screen printers, embroidery, custom apparel |
| [real-estate.md](real-estate.md) | Real estate agents, property management |
| [repair.md](repair.md) | Auto, electronics, appliance, bicycle, cobbler, tailor, any repair shop |
| [food-truck.md](food-truck.md) | Food trucks, food carts, pop-ups, mobile food vendors |
| [restaurant.md](restaurant.md) | Restaurants, cafés, bakeries, catering, cottage food |
| [roadside-attraction.md](roadside-attraction.md) | Roadside attractions, novelty museums, curiosity stops, tourist landmarks |
| [retail.md](retail.md) | Gift shops, boutiques, clothing, toys, antiques, thrift, specialty |
| [salon.md](salon.md) | Hair salons, spas, barbers, beauty services |
| [service.md](service.md) | Consultants, coaches, freelancers, event planners, general services |
| [social-services.md](social-services.md) | Shelters, crisis centers, housing, job training |
| [storage.md](storage.md) | Self-storage, climate-controlled, vehicle/boat/RV storage |
| [tattoo.md](tattoo.md) | Tattoo shops, piercing studios, permanent makeup |
| [tour-guide.md](tour-guide.md) | Fishing guides, adventure tours, nature tours, kayak tours, food tours |
| [trades.md](trades.md) | Contractors, plumbers, electricians, HVAC, landscaping, movers, pest control |
| [video-creator.md](video-creator.md) | YouTubers, streamers, video essayists, filmmakers |
| [youth-org.md](youth-org.md) | Youth sports, scouts, after-school, mentoring |

## Cross-cutting references

These files apply across business types. **Don't load all of them at once** — read only the ones needed for the current phase:

| File | Purpose | When to read |
|---|---|---|
| [seasonal-calendar/](seasonal-calendar/) | Month-by-month marketing hooks by quarter. | Content planning, monthly `/check` |
| [consumer-checklist.md](consumer-checklist.md) | Details consumers expect (payment methods, parking, walk-in policy, etc.). | `/design-interview` |
| [legal-checklist.md](legal-checklist.md) | Website legal requirements (privacy policy, copyright, accessibility, disclaimers). | `/design-interview`, `/deploy` |
| [../security.md](../security.md) | Contact form security, privacy by design, owner account security, incident response. | Adding forms, `/deploy`, `/check` |
| [../seo.md](../seo.md) | SEO fundamentals, discoverability, Google Business Profile, monitoring. | `/deploy`, quarterly review |
| [../accessibility.md](../accessibility.md) | Practical accessibility guidance for content changes over time. | Content changes, `/check` |
| [../measuring-success.md](../measuring-success.md) | How to know if the website is helping the business. | Monthly `/check`, quarterly review |
| [../cost-of-ownership.md](../cost-of-ownership.md) | What the website costs to run — required, optional, and scaling costs. | Annual review, owner asks about costs |
| [../handoff.md](../handoff.md) | Transferring the website to another developer, new owner, or different platform. | Owner asks about transferring |
| [info-changes.md](info-changes.md) | What to update (and where) when business details change. | Owner reports a change |
| [reviews.md](reviews.md) | Reviews, reputation, testimonials — getting, managing, and displaying them. | `/design-interview`, monthly `/check` |
| [competitor-awareness.md](competitor-awareness.md) | Understanding what competitors do online. | `/design-interview`, quarterly review |
| [../platforms/](../platforms/) | Best practices for shared SaaS platforms. Read only the relevant platform file(s). | `/start`, setting up a platform |
| [multi-mode.md](multi-mode.md) | How to merge guidance when a business spans multiple types. | `/start` if multi-type |
| [pre-launch.md](pre-launch.md) | Adjustments for businesses that haven't launched yet. | `/start` if pre-launch |

## Pre-launch businesses

Not every owner has an established business. Some are just starting out — no name, no customers, just an idea. See [pre-launch.md](pre-launch.md) for how to adjust `/start`, what to build, and free resources to share.

## Multi-mode businesses

Most businesses span multiple types. See [multi-mode.md](multi-mode.md) for how to merge guidance. Key rules:

- `BUSINESS_TYPE` in `.site-config` supports comma-separated values (primary type first)
- Read the SMB doc for each type and merge: pages are unioned, compliance is additive, tools avoid duplication
- One website, one nav — secondary modes are sections, not separate sites

## Out of scope

Some business types need more than a static site scaffold can provide. If someone asks, acknowledge that Anglesite isn't the right fit and point them to appropriate resources:

- **Local newspapers / media outlets** — Need a CMS built for journalism (article workflows, breaking news, paywall, advertising). Consider Ghost, WordPress with Flavor, or custom solutions. May be supported in a future version.

## Structure of each file

Every file follows the same format:

1. **Pages** — Priority pages for this business type
2. **Tools** — Industry-specific SaaS recommendations (following the SaaS criteria)
3. **Compliance** — Legal or regulatory considerations
4. **Content ideas** — What to post about
5. **Key dates** — Industry-specific awareness days and seasonal hooks
6. **Structured data** — JSON-LD schema type and properties
7. **Data tracking** — Suggested tables and fields for the business type
