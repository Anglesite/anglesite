---
name: business-info
description: "Collect and display business hours, address, phone, and LocalBusiness JSON-LD"
user-invokable: false
allowed-tools: Write, Read, Glob
---

Collect business hours, address, and phone number, then generate LocalBusiness structured data and a location page. Called by the start and design-interview skills when business info is provided — not invoked directly.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — OpenStreetMap embed via iframe, not Google Maps JavaScript API

## When to invoke this skill

- During `/anglesite:start` when the owner provides address/hours/phone
- During `/anglesite:design-interview` when collecting business details
- When the owner asks to update their hours, address, or location page

## Step 1 — Collect business info

If not already in `.site-config`, ask the owner for:

1. **Address** — street, city, state, zip (store as `SITE_ADDRESS=123 Main St, City, ST 12345`)
2. **Phone** — primary contact number (store as `SITE_PHONE=(555) 123-4567`)
3. **Hours** — opening hours (store as `SITE_HOURS=Mon-Fri 9am-5pm, Sat 10am-3pm, Sun Closed`)

Hours format supports:
- Day ranges: `Mon-Fri 9am-5pm`
- Individual days: `Mon 9am-5pm, Tue 10am-6pm`
- Split hours: `Mon 11am-2pm 5pm-10pm`
- Closed days: `Sun Closed`
- Full names: `Monday-Friday 9am-5pm`

Save all values to `.site-config` using the Write tool.

Add the phone number to the PII allowlist so the pre-deploy scan doesn't flag it:
- Extract digits from the phone number
- If `PII_EMAIL_ALLOW` exists, ensure the phone won't be blocked (phone scan looks for patterns, not exact matches — the allowlist is for emails only, but the phone is intentionally published)

## Step 2 — Generate LocalBusiness JSON-LD

Read `.site-config` for: `SITE_NAME`, `BUSINESS_TYPE`, `SITE_ADDRESS`, `SITE_PHONE`, `SITE_HOURS`, `SITE_DOMAIN`.

Build a LocalBusiness JSON-LD object. The `@type` should match the business type:

| Business type | Schema.org @type |
|---|---|
| restaurant | Restaurant |
| salon | BeautySalon |
| accounting | AccountingService |
| healthcare | MedicalBusiness |
| florist | Florist |
| brewery | Brewery |
| fitness | HealthClub |
| (others) | See `scripts/business-info.ts` mapping |
| (unknown) | LocalBusiness |

Update the home page (`src/pages/index.astro`) to pass the JSON-LD object as the `jsonLd` prop to `<BaseLayout>`. If there's already a `jsonLd` prop, replace it.

## Step 3 — Create or update the location page

Create `src/pages/location.astro` with:

1. **Address** — displayed with `itemprop` microdata attributes
2. **Phone** — displayed as a `tel:` link
3. **Hours** — formatted as a readable table, grouped by day range
4. **Map** — OpenStreetMap embed (iframe, no JavaScript):

```html
<iframe
  title="Map"
  width="100%"
  height="400"
  style="border: 0; border-radius: var(--radius-md);"
  loading="lazy"
  src="https://www.openstreetmap.org/export/embed.html?bbox=BBOX&layer=mapnik&marker=LAT,LON">
</iframe>
```

To get coordinates, tell the owner: "I'll search for your address on OpenStreetMap to embed a map. Is that OK?" Then construct the embed URL using the Nominatim search (no API key needed):

The coordinates can be found by the owner pasting their address into openstreetmap.org. Store the map URL in `.site-config` as `OSM_EMBED_URL`.

## Step 4 — Update CSP for OpenStreetMap

Read `public/_headers`. The `frame-src` directive needs to include `https://www.openstreetmap.org` for the map embed. Update it.

## Step 5 — Update the footer

Add hours and address to the site footer in `src/layouts/BaseLayout.astro` so they appear on every page. Keep it compact:

```html
<footer>
  <p>ADDRESS | PHONE</p>
  <p>HOURS_SUMMARY</p>
  <p>&copy; YEAR</p>
</footer>
```

Read the values from `.site-config` at build time (same pattern as SITE_NAME).

## Step 6 — Verify

Run `npm run build` to confirm the structured data is valid and the location page renders.

Tell the owner: "Your business info is set up! You have a /location page with your address, hours, and map. Google can now find your business hours and address in search results."

## Keep docs in sync

After setup, update:
- `docs/architecture.md` — note the location page
- `.site-config` — all business info values saved
