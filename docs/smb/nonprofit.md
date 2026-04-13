# Nonprofit — Overview

Nonprofits vary enormously. A museum, a food bank, and a church have almost nothing in common website-wise. Use the sub-type files for specific guidance:

| File | Type |
|---|---|
| [house-of-worship.md](house-of-worship.md) | Churches, synagogues, mosques, temples |
| [food-bank.md](food-bank.md) | Food banks, pantries, meal programs |
| [animal-shelter.md](animal-shelter.md) | Animal shelters, rescues, humane societies |
| [museum.md](museum.md) | Art, history, science, and children's museums |
| [youth-org.md](youth-org.md) | Youth sports, scouts, after-school, mentoring |
| [community-theater.md](community-theater.md) | Theater companies, orchestras, dance, arts councils |
| [social-services.md](social-services.md) | Shelters, crisis centers, housing, job training |

If the nonprofit doesn't match any sub-type, use this file as a starting point.

## Shared nonprofit traits

Every nonprofit website needs these regardless of sub-type:

- **Mission page** — Who you are, what you do, why it matters. The most important page.
- **Donate page** — Clear call to action, link to donation platform. Display EIN and 501(c)(3) status so donors know their gift is tax-deductible.
- **Transparency** — Annual reports, financials, board members. Builds donor trust.
- **Get involved** — Volunteer opportunities, events, committees.

## Shared compliance

- **501(c)(3) status**: Display EIN and tax-exempt status on the donation page.
- **Solicitation registration**: Many US states require registration before soliciting donations online.
- **Gift acknowledgment**: Written acknowledgment required for gifts over $250. Donation platforms usually handle this.
- **Churches**: Generally exempt from 501(c)(3) filing but should still display nonprofit status.

## Design

- **Visual mood:** Mission-driven, trustworthy, and emotionally engaging. The design should convey purpose and invite participation without feeling like a corporate annual report.
- **Color direction:** Warm, approachable colors — not corporate. Earth tones, warm blues, and mission-related accent colors. Avoid sterile grays or overly bright palettes that undermine seriousness.
- **Typography feel:** Humanist sans-serif (Segoe UI/Roboto stack) for warmth and approachability. Medium weight. Readable at all sizes since donors and volunteers span every age group.
- **Layout emphasis:** Pattern 2 (hero + content) for the home page with the mission statement and a donate CTA above the fold. Pattern 5 (alternating features) for impact stories and program descriptions. Max-width 48rem for narrative content.
- **Photography style:** Impact photography — real people, real community, real work. Avoid stock photos. 4:3 for general use, 16:9 for hero banners. Warm and authentic treatment.
- **Key component:** Impact stat cards — a large number with a brief description (e.g., "1,200 meals served this month"). These build donor confidence and make the mission tangible.

## Review platforms

Review platforms matter less for general nonprofits than for for-profit businesses, but Google Business Profile is worth claiming for any nonprofit with a physical location.

- **Google Business Profile** — Donors, volunteers, and people seeking services may find the organization via Google. Reviews here sometimes reflect volunteer or donor experiences. Keep the profile accurate (especially hours) and respond to any reviews.
- **Charity Navigator / GuideStar (Candid)** — These nonprofit-specific platforms rate organizations on financial health and transparency. A strong Charity Navigator rating builds donor confidence far more than Yelp stars. Make sure the nonprofit's financials are current on both platforms.
- **GreatNonprofits** — A review platform specifically for nonprofits where volunteers, donors, and clients can leave testimonials. Often integrated with Charity Navigator.

For nonprofit sub-types, see the specific vertical file for more targeted guidance.

See `docs/smb/reviews.md` for general review management guidance.

## Shared tools

- **Donorbox** (free up to $1000/mo) — Embeddable donation forms. donorbox.org
- **GiveButter** (free, tips-based) — Fundraising, events, donor CRM. givebutter.com
- **CiviCRM** (open source, nonprofit-backed) — Full CRM with donor management, memberships, events. civicrm.org
- **Open Collective** (open source) — Transparent fundraising and expenses. Good for community groups. opencollective.com
- Avoid payment platforms that take large percentages. Nonprofits need every dollar.

## Domain

**.org** is the default for nonprofits — widely recognized and trusted for mission-driven organizations. Available on Cloudflare.

For environmental nonprofits, consider **.eco** — it requires a sustainability pledge and signals environmental credibility. For cooperatives (food co-ops, cooperative businesses), consider **.coop** — restricted to verified cooperatives. Neither is available on Cloudflare; register externally and point nameservers to Cloudflare.

Avoid .ngo/.ong (expensive, low recognition outside international development circles). Never use .xyz, .biz, or .info — donor trust and email deliverability suffer.
