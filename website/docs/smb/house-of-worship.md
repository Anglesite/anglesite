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

## Structured data

Use `Church` (or `Mosque`, `Synagogue`, `HinduTemple`, `BuddhistTemple`) with:
- name, address, phone
- `openingHours` for service times
- `event` for special services

## Airtable schema

- **Members:** Name, Email, Phone, Family, Membership Date, Groups, Status, Notes
- **Events:** Name, Date, Type (Service/Class/Social/Outreach), Location, Notes
- **Volunteers:** Name (linked to Members), Ministry, Role, Availability
