# House of Worship

Covers: churches, synagogues, mosques, temples, meeting houses, spiritual communities.

See [nonprofit.md](nonprofit.md) for shared nonprofit traits (donate page, transparency, compliance).

## Pages

- **Service times / schedule** — The single most important page. When and where to show up. Keep it updated.
- **About / beliefs** — Denomination, values, what to expect as a visitor. "What to expect on your first visit" is the #1 search query for congregations.
- **Staff / leadership** — Pastor, rabbi, imam, board/elders. Photos and brief bios.
- **Ministries / programs** — Groups, classes, small groups, youth ministry, outreach
- **Events** — Upcoming events, recurring programs. Calendar format is helpful.
- **Sermons / messages** — Archive of past sermons (audio, video, or text). Many congregations' most-visited section.
- **Give** — Online giving link. Simple, prominent.
- **Contact / visit** — Address, parking, childcare info, accessibility, what to wear. Remove every barrier to a first visit.
- **Blog / news** — Congregation updates, devotionals, event recaps

## Design

- **Visual mood:** Welcoming, warm, and community-centered. The design should reflect the congregation's tradition and make visitors feel invited before they ever walk through the door.
- **Color direction:** Warm golds and earth tones for traditional congregations; clean blues and whites for contemporary ones. Let the faith tradition guide the palette. Avoid cold or corporate palettes.
- **Typography feel:** Classic serif headings (Georgia stack) for traditional congregations; Humanist sans-serif (Segoe UI/Roboto stack) for contemporary communities. Medium weight — authoritative but not heavy.
- **Layout emphasis:** Pattern 2 (hero + content) for the home page. Service times and a clear "Visit Us" call to action above the fold. Max-width 48rem for reading comfort on sermon and program pages.
- **Photography style:** Community gathering photos, building exterior and interior shots that show the space people will enter. 16:9 for hero images, 4:3 for event and program photos. Warm, natural lighting.
- **Key component:** Service times display — day, time, service type, and brief description. This is the single most important piece of information on the site.

## Tools

- **Planning Center** (~$0–$200/mo, tiered by module, proprietary) — Church management: people, giving, services, groups, registration. The most widely used platform for US churches. planningcenter.com
- **Tithe.ly** (free app, 2.9% per transaction, proprietary) — Online giving and church management. tithe.ly
- **Breeze ChMS** (~$72/mo, proprietary) — Simple church management. Good for smaller congregations. breezechms.com
- **ChurchCenter** (part of Planning Center) — Congregation-facing app for giving, events, groups.
- For synagogues/mosques/temples: **ShulCloud** (synagogues), or use **CiviCRM** (open source) for membership and event management.
- **YouTube** or **Facebook Live** — For livestreaming services. Link from the website.
- Most congregations already have a management tool. Integrate rather than replace.

## Compliance

- **Tax-exempt status**: Churches are automatically tax-exempt under IRC 501(c)(3) without filing for recognition. Still display this status for donor confidence.
- **Child safety**: If the congregation has youth programs, note any child protection policies (background checks, safe sanctuaries). Parents look for this.
- **Accessibility**: Note physical accessibility — ramp, elevator, hearing loop, large-print materials, ASL interpretation. Congregations serve all ages and abilities.
- **Livestream/recording consent**: If recording services, note this on the website and at the venue.

## Content ideas

Weekly devotionals or reflections, event announcements, sermon summaries or follow-up discussion questions, volunteer spotlights, outreach project updates, seasonal content (Advent, Lent, Ramadan, High Holidays), new member welcomes, community service recaps, "meet our staff" series.

## Key dates

Varies by faith tradition. Major observances the agent should surface:
- **Christian**: Advent/Christmas, Lent/Easter, Pentecost
- **Jewish**: Rosh Hashanah, Yom Kippur, Hanukkah, Passover, Sukkot
- **Muslim**: Ramadan, Eid al-Fitr, Eid al-Adha
- **Hindu**: Diwali, Holi, Navratri
- **Buddhist**: Vesak, Bodhi Day
- **Interfaith**: National Day of Prayer (1st Thu May), Interfaith Harmony Week (1st week Feb)

Post service times, special programming, and community events well in advance.

## Structured data

Use `Church` (or `Mosque`, `Synagogue`, `HinduTemple`, `BuddhistTemple`) with:
- name, address, phone
- `openingHours` for service times
- `event` for special services

## Data tracking

- **Members:** Name, Email, Phone, Family, Membership Date, Groups, Status, Notes
- **Events:** Name, Date, Type (Service/Class/Social/Outreach), Location, Notes
- **Volunteers:** Name (linked to Members), Ministry, Role, Availability
