# QR codes, shortlinks, and campaign tracking

Generate branded QR codes for print materials, set up shortlink redirects, and create UTM-tracked URLs for advertising.

## QR codes

SVG QR codes saved to `public/images/qr/` — scalable to any print size.

Each QR code includes UTM tracking so you can see in `/anglesite:stats` how many people scanned it.

### Use cases
- Business cards — homepage QR
- Table tents / menus — page-specific QR
- Flyers — event or promotion QR
- Window signage — general website QR

## Shortlink redirects

Memorable URLs like `example.com/menu` or `example.com/podcast` that redirect to the right page with tracking. Uses Cloudflare Pages `_redirects` (instant, at the edge).

Example: "Visit example.com/podcast" in a podcast ad → redirects to homepage with `utm_source=podcast&utm_medium=audio&utm_campaign=episode-42`.

## Campaign URLs for advertising

UTM-tagged URLs for ad agencies, social media campaigns, or email marketing. The system enforces best practices automatically:

| Parameter | Purpose | Example |
|---|---|---|
| `utm_source` | Platform | facebook, newsletter, qr |
| `utm_medium` | Channel type | paid-social, email, print |
| `utm_campaign` | Campaign name | spring-sale-2026 |
| `utm_content` | A/B variant (optional) | headline-a |
| `utm_term` | Keyword (optional) | pizza-near-me |

### Automatic enforcement
- All values lowercased (prevents fragmented data)
- Spaces → dashes
- Platform suffixes (.com) stripped
- Medium validated against standard channel types
- Redundancy between params flagged

## Viewing results

Run `/anglesite:stats` to see campaign performance:
- How many visitors came from each QR code
- Which shortlinks are getting traffic
- Ad campaign visit counts

## Configuration

| Key | File | Purpose |
|---|---|---|
| QR code SVGs | `public/images/qr/` | Print-ready vector files |
| Shortlinks | `public/_redirects` | Cloudflare Pages redirects |
| `SITE_DOMAIN` | `.site-config` | Used to build full URLs |
