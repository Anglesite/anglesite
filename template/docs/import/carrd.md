# Importing from Carrd

Carrd is a single-page website builder popular for landing pages, link-in-bio pages, and simple business sites. It has no API, no RSS feed, and no export. WebFetch is the only extraction method. Carrd sites are almost always a single page, making the import fast but simple.

## How it detects this platform

Check for Carrd indicators:
- `.carrd.co` in the domain (e.g., `username.carrd.co`)
- `<meta name="generator" content="Carrd">` (not always present)
- `static.carrd.co` in script or stylesheet URLs
- `carrd.co` in the page source or footer
- Characteristic Carrd HTML structure: `<div id="wrapper">` with `<div id="main">`
- `crd.co` in tracking/analytics URLs

For custom domains (Pro plan), use WebFetch on the homepage and check for these markers.

## Extraction methods

### WebFetch (only option)

Use WebFetch on SITE_URL with this prompt:

> "This is a Carrd single-page website. Extract all content from the page:
> 1. The site/business name (from the largest heading or logo alt text)
> 2. A tagline or subtitle (if present)
> 3. All text sections with their headings
> 4. All links (especially social media links, contact links, external service links)
> 5. All image URLs (from src attributes)
> 6. Any email addresses or phone numbers displayed
> 7. A description of each section's purpose (hero, about, services, contact, etc.)
> Report the content in order as it appears on the page."

Carrd sites are single-page — one WebFetch call captures everything.

### Multi-page Carrd sites (Pro plan)

Carrd Pro supports multiple pages. Check for internal navigation links. If found, WebFetch each linked page.

Common multi-page patterns:
- `example.com/about`
- `example.com/services`
- `example.com/contact`

## Frontmatter mapping

Carrd sites don't have blog posts. Content imports as **static pages**. No frontmatter mapping is needed for blog posts.

For the page content:

| Carrd content | Anglesite output | Notes |
| --- | --- | --- |
| Site name / main heading | Page `<h1>` and site title | May inform `.site-config` |
| Tagline | Hero subtitle | Goes into the home page hero section |
| About section | About page content | Create as `src/pages/about.astro` |
| Services/offerings | Services page | Create as `src/pages/services.astro` |
| Social links | Footer links | Add to site footer/layout |
| Contact info | Contact page | Create as `src/pages/contact.astro` |

## Content conversion

Carrd content is minimal HTML. Convert to structured pages:

**Elements to handle:**
- `<section>` blocks — Carrd uses sections for each content area → map to page sections
- `<h1>` / `<h2>` — headings within sections
- `<p>` — text content
- `<a class="button">` — CTA buttons → convert to links
- `<ul>` / `<ol>` — lists (pricing tiers, feature lists)
- Icon elements — Carrd uses icon fonts/SVGs for visual elements → strip icons, keep associated text
- Form elements — Carrd has built-in forms → strip and note for replacement

**Elements to strip:**
- Carrd's JavaScript runtime
- Animation/transition attributes
- Countdown timers
- Payment/checkout widgets
- Embedded third-party widgets
- Form handlers (Carrd forms use their own backend)

## Image handling

Carrd images are hosted on:
- `static.carrd.co` — Carrd's CDN
- User may link to external images (Unsplash, etc.)

Carrd sites typically have few images (hero background, profile photo, a few section images). Download all to `public/images/`.

```sh
mkdir -p public/images
curl -L -s -o "public/images/hero.jpg" "IMAGE_URL"
```

Carrd CDN URLs are tied to the account and will stop working after cancellation.

## URL patterns for redirects

Carrd sites are single-page:
- `https://username.carrd.co` → everything on one page
- `https://username.carrd.co/#section-id` → anchor links to sections

For the single-page import, the main redirect is just:
```
/ / 200
```

If the Carrd site used a custom domain, and the new Anglesite site uses the same domain, no redirects are needed for the main page.

For multi-page Pro sites:
```
/about /about 200
/services /services 200
```

## How to structure the imported content

Since Carrd sites are landing pages (not blogs), the import creates pages rather than posts:

1. **Home page** — Use the hero section and primary content to populate `src/pages/index.astro`
2. **About page** — If there's a bio/about section, create `src/pages/about.astro`
3. **Services page** — If services/offerings are listed, create `src/pages/services.astro`
4. **Contact page** — If contact info is present, create `src/pages/contact.astro`
5. **Social links** — Add to the site footer in the layout

Tell the owner:
> "Your Carrd site is a single-page design. I've expanded it into separate
> pages — a home page, about page, and contact page. This gives you room
> to add more content over time. All the same information is there."

## Common issues

- **No export or API**: Carrd has zero export capabilities. WebFetch is the only option.
- **Single-page sites**: Most Carrd sites fit on one page. The import is quick but the resulting site may need more content.
- **Link-in-bio pages**: Many Carrd sites are just a list of links (social profiles, Etsy shop, etc.). For these, create a simple landing page with the links and suggest building out more content.
- **Form replacement**: Carrd's built-in forms won't transfer. Suggest alternatives: a simple `mailto:` link, Cal.com for scheduling, or a form service like Tally.
- **Background images**: Carrd uses full-bleed background images extensively. These need to be downloaded and may need different treatment in the Astro layout.
- **Minimal content**: Carrd sites are intentionally minimal. The owner should know the new site can grow beyond what the Carrd site had.
- **Payment buttons**: Carrd Pro supports payment buttons (Stripe, PayPal). These can't be imported — note for the owner and suggest Stripe payment links.
