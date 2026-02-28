# Business Info Changes

What to update — and where — when business details change. Reference for the webmaster agent. Applied when the owner reports a change or during routine `/check` maintenance.

Business info lives in multiple places. When something changes, it's easy to update the website and forget the map listings, or vice versa. This checklist ensures nothing is missed.

## Where business info lives

### On the website

| Location | What's there | How to update |
|---|---|---|
| `.site-config` | `SITE_NAME`, `SITE_DOMAIN`, `SITE_EMAIL`, `SITE_PHONE`, `SITE_ADDRESS` | Edit the file directly |
| JSON-LD structured data | Name, address, phone, hours, `areaServed` | Edit the `<script type="application/ld+json">` block in the layout or home page |
| Contact page | Address, phone, email, hours, map | Edit the page content |
| Footer | Business name, phone, address (if shown) | Edit the layout component |
| About page | Business name, story, team | Edit the page content |
| `h-card` microformat | Name, address, phone, URL | Edit the markup in the site header/footer |
| Blog posts | May reference hours, locations, services | Search existing posts for outdated info |
| Privacy policy | Business name, contact email | Edit the privacy page |

### Outside the website

| Platform | What's there | How to update |
|---|---|---|
| Google Business Profile | Name, address, phone, hours, photos, categories, description | business.google.com |
| Apple Business Connect | Name, address, phone, hours, photos, categories | businessconnect.apple.com |
| OpenStreetMap | Name, address, phone, hours | openstreetmap.org (edit directly) |
| Social media profiles | Business name, bio, link, hours | Each platform |
| Yelp | Business info, hours, categories | biz.yelp.com |
| Industry directories | Varies by business type | Check SMB file for relevant directories |
| Email signature | Name, title, phone, address | Owner's email client |
| Print materials | Business cards, signs, menus | Owner handles offline |

## Common changes and what to update

### New phone number

1. `.site-config` → `SITE_PHONE`
2. JSON-LD structured data → `telephone`
3. Contact page
4. Footer (if phone is displayed)
5. `h-card` microformat
6. Google Business Profile
7. Apple Business Connect
8. OpenStreetMap
9. Social media profiles
10. Rebuild and deploy

### New address / relocation

1. `.site-config` → `SITE_ADDRESS`
2. JSON-LD structured data → `address`
3. Contact page (including map embed or link)
4. Footer (if address is displayed)
5. `h-card` microformat
6. Google Business Profile (triggers re-verification)
7. Apple Business Connect
8. OpenStreetMap
9. Social media profiles
10. If the service area changed: update `areaServed` in JSON-LD, review service page content
11. Update any "directions" or "how to find us" content
12. Rebuild and deploy

### New hours

1. JSON-LD structured data → `openingHours`
2. Contact page or hours section
3. Google Business Profile
4. Apple Business Connect
5. OpenStreetMap
6. Rebuild and deploy

### Seasonal hours

Many businesses have different hours by season (farms, ice cream shops, tourist-area businesses).

1. Update the hours on the website and map listings when the season changes
2. Consider adding a "Current hours" section that's clearly dated: "Winter hours (Nov–Mar): Thu–Sun 10am–4pm"
3. Set a reminder in the owner's calendar to update hours at each season change
4. Google Business Profile supports "special hours" and "more hours" for seasonal patterns

### New or dropped services

1. Update the services page — add or remove the service
2. Update JSON-LD if services are listed in structured data
3. Update Google Business Profile categories and services
4. If a service was removed: check blog posts that reference it, add a note or redirect
5. If a new service was added: consider a blog post announcing it, update the home page if it's a primary offering
6. Rebuild and deploy

### New email address

1. `.site-config` → `SITE_EMAIL`
2. Contact page
3. Contact form submission handler (Cloudflare Worker or Formspree destination)
4. Privacy policy (if email is listed for data deletion requests)
5. Social media profiles
6. If the domain changed: see `docs/handoff.md`

### Temporary closure

Vacation, renovation, weather, family emergency — the business is closed temporarily.

1. Update the home page with a banner: "We're closed [dates] for [reason]. We'll reopen on [date]."
2. Update Google Business Profile: set as "temporarily closed" (this prevents bad reviews from people who showed up and found you closed)
3. Update Apple Business Connect
4. Consider an email to the mailing list if the closure is unexpected
5. After reopening: remove the banner, reset Google Business Profile status, post a "we're back" update
6. Rebuild and deploy after each change

### Business name change

This is rare but consequential:

1. `.site-config` → `SITE_NAME`
2. JSON-LD structured data → `name`
3. Every page title and meta description that includes the business name
4. Footer copyright notice
5. About page
6. Privacy policy
7. Accessibility statement
8. `h-card` microformat
9. Google Business Profile
10. Apple Business Connect
11. OpenStreetMap
12. Social media profiles
13. If the domain changes too: see `docs/handoff.md`
14. Consider keeping the old name visible somewhere temporarily: "Formerly [old name]"
15. Rebuild and deploy

## Routine info audit

During monthly `/check`, quickly verify:

- Hours on the website match Google Business Profile
- Phone number is current
- Contact form is receiving submissions (ask the owner: "Have you gotten any form submissions recently?")
- No blog posts reference outdated info (seasonal hours from last year, old location, discontinued services)

During annual maintenance (see `docs/webmaster.md` → Maintenance schedule):

- Verify all map listings are still claimed and accurate
- Check that directory listings are current
- Update the copyright year in the footer
- Review the About page — has the team changed?
