---
name: print
description: "Generate print-ready materials (business cards, flyers, door hangers, social cards) from site branding"
user-invokable: false
allowed-tools: Write, Read, Glob, Bash(npm run ai-qr)
---

Generate print-ready marketing materials that match the site's visual identity. Produces PDF files for print (business cards, flyers, door hangers) and PNG files for digital (social media cards). Called when the owner asks about print materials, marketing collateral, or physical handouts — not invoked directly.

## Architecture decisions

- [ADR-0004 Vanilla CSS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0004-vanilla-css.md) — materials use the same CSS custom properties as the site
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — all generation happens locally

## When to invoke this skill

- When the owner asks for business cards, flyers, door hangers, or social media graphics
- When the owner mentions print materials, marketing collateral, or physical handouts
- After the QR skill generates codes and the owner wants print materials that use them
- During `/anglesite:start` if the owner mentions needing printed materials

## Prerequisites

Before generating materials, ensure:

1. **Brand identity exists** — `docs/brand.md` must be populated (run design-interview first if not)
2. **Business info is set** — `.site-config` must have `SITE_NAME`, `OWNER_NAME` at minimum
3. **Design system is configured** — `src/styles/global.css` has the CSS custom properties

If any are missing, tell the owner what's needed: "I need your brand colors and business info set up first. Want me to run through the design interview?"

## Step 1 — Read branding and business context

Read these files to extract the design system and business details:

1. **`.site-config`** — extract: `SITE_NAME`, `OWNER_NAME`, `SITE_DOMAIN`, `SITE_ADDRESS`, `SITE_PHONE`, `SITE_HOURS`, `BUSINESS_TYPE`, `SITE_EMAIL`
2. **`docs/brand.md`** — extract: brand personality, tone, tagline, any design notes
3. **`src/styles/global.css`** — extract the `:root` CSS custom properties:
   - `--color-primary`, `--color-accent`, `--color-bg`, `--color-text`
   - `--font-heading`, `--font-body`
   - `--radius-sm`, `--radius-md`
4. **`public/favicon.svg`** — the site's logo/icon for placement on materials
5. **`public/images/qr/`** — check for existing QR codes to include

If `BUSINESS_TYPE` is set, read `${CLAUDE_PLUGIN_ROOT}/docs/smb/<type>.md` for industry-specific guidance on what materials work best.

## Step 2 — Determine what to generate

Ask the owner which materials they need. Present options based on their business type:

### Print materials (PDF at 300 DPI)

| Material | Dimensions | Best for |
|---|---|---|
| **Business card** | 3.5" × 2" (1050 × 600px at 300 DPI) | Networking, customer handouts |
| **One-page flyer** | 8.5" × 11" (2550 × 3300px at 300 DPI) | Community boards, handouts, mailers |
| **Door hanger** | 4.25" × 11" (1275 × 3300px at 300 DPI) | Neighborhood canvassing |

### Digital materials (PNG)

| Material | Dimensions | Best for |
|---|---|---|
| **Instagram post** | 1080 × 1080px | Social media feed |
| **Facebook cover** | 820 × 312px | Page header |
| **Open Graph image** | 1200 × 630px | Link previews (already in site) |

If the owner isn't sure, recommend based on business type:
- **Restaurants/cafes** — table tent card, menu flyer, Instagram post
- **Services (salon, fitness, etc.)** — business card, flyer, Instagram post
- **Retail** — flyer, door hanger, Instagram post
- **Professional (accounting, legal)** — business card, flyer

## Step 3 — Create a design philosophy

Before generating materials, create a brief design philosophy (2-3 sentences) that bridges the site's brand identity with print design principles. This ensures visual coherence across all materials.

The philosophy should reference:
- The brand's primary and accent colors
- The typographic voice (heading + body fonts)
- The brand personality from `docs/brand.md`
- Print-specific considerations (high contrast for readability, bleed margins)

Example: "Bold geometry anchored by [primary color] with [accent color] as a focused highlight. [Heading font] at large scale for authority, [body font] for essential details only. White space is structural — every element earns its place."

## Step 4 — Generate print materials

Generate each requested material as a self-contained HTML file, then describe how the owner can convert it to the final format.

### Output location

All generated materials go in `public/print/`:

```
public/print/
├── business-card.html
├── business-card-back.html
├── flyer.html
├── door-hanger.html
├── instagram-post.html
└── facebook-cover.html
```

### Design principles for ALL materials

1. **Brand consistency** — use exact CSS custom property values from the site (colors, fonts, radii)
2. **Visual hierarchy** — business name largest, then headline/tagline, then contact details
3. **QR code integration** — if QR codes exist in `public/images/qr/`, embed them. If not, offer to generate one via the QR skill
4. **Minimal text** — print materials communicate through design, not paragraphs
5. **High contrast** — ensure all text meets WCAG AA contrast ratios (especially important for print)
6. **Bleed-safe** — keep critical content 0.125" (⅛") inside trim edges
7. **No external dependencies** — inline all styles, embed SVGs directly, use system fonts with web-safe fallbacks

### Business card layout

**Front:**
- Business name (prominent, using heading font)
- Owner name and title
- Tagline or one-line description (if in brand.md)
- Logo/favicon as a design element

**Back:**
- Contact info: phone, email, website URL
- Address (if set)
- QR code linking to homepage (small, corner placement)
- Primary color as background or accent band

### One-page flyer layout

- **Top third** — business name, headline, hero visual element (geometric pattern, color block, or brand illustration using primary/accent colors)
- **Middle third** — key information: services, hours, special offer, or event details. Pull from page content or ask the owner
- **Bottom third** — call to action, contact info, QR code, address/map reference

### Door hanger layout

- Compact vertical layout (narrow width)
- Die-cut hole area at top (leave 1.5" clear zone)
- Business name and logo
- One clear message or offer
- Contact info and QR code at bottom

### Social media cards

- **Instagram (1080×1080)** — bold, visual-first. Business name, one headline, strong color blocking. Minimal text per platform best practices
- **Facebook cover (820×312)** — wide format. Business name, tagline, subtle brand pattern. No critical info at edges (profile photo overlap zone)

## Step 5 — Build the HTML files

Each HTML file must be:

1. **Self-contained** — all CSS inline in a `<style>` block, no external resources
2. **Print-optimized** — use `@page` CSS rules for exact dimensions, no margins on the page itself
3. **Pixel-precise** — set width/height in pixels matching the target DPI dimensions
4. **Brand-matched** — hardcode the actual CSS custom property VALUES (not var() references) since these are standalone files

Template structure for each file:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MATERIAL_TYPE — SITE_NAME</title>
  <style>
    @page {
      size: WIDTHpx HEIGHTpx;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: WIDTHpx;
      height: HEIGHTpx;
      font-family: BODY_FONT;
      color: TEXT_COLOR;
      background: BG_COLOR;
      overflow: hidden;
    }
    /* Material-specific styles */
  </style>
</head>
<body>
  <!-- Material content -->
</body>
</html>
```

Embed any QR code SVGs directly in the HTML (read the SVG file contents and inline them).

Embed the favicon SVG directly as well for the logo.

## Step 6 — Generate QR codes if needed

If the owner wants QR codes on their materials but none exist yet:

1. Run `npm run ai-qr` to generate a homepage QR code
2. Use campaign-specific labels: `business-card`, `flyer`, `door-hanger`
3. This creates tracked QR codes so the owner can see which print material drives traffic

Tell the owner: "I generated a QR code for your business card that tracks visits separately from your flyer — you'll see which materials bring people to your site."

## Step 7 — Explain how to use the files

Tell the owner how to get print-ready files from the HTML:

**For PDF (print materials):**
> "Open `public/print/business-card.html` in your browser, then use File → Print → Save as PDF. Set margins to 'None' and scale to 100%. The file is already sized correctly for printing."

**For PNG (social media):**
> "Open `public/print/instagram-post.html` in your browser and take a screenshot, or use File → Print → Save as PDF, then convert to PNG. The dimensions are set for Instagram's square format."

**For professional printing:**
> "Take the PDF files to any print shop (Staples, FedEx Office, local printer). Tell them:
> - Business cards: 3.5×2 inches, standard cardstock
> - Flyers: Letter size, 80lb gloss or matte
> - Door hangers: 4.25×11 inches, cardstock with die-cut hole"

## Step 8 — Print kit (all materials at once)

If the owner asks for a "print kit" or "all materials", generate the full set:

1. Business card (front + back)
2. One-page flyer
3. Door hanger
4. Instagram post
5. Facebook cover

Create an index file at `public/print/index.html` that links to all materials with thumbnails and print instructions.

Tell the owner: "Your complete print kit is ready in `public/print/`. Open `public/print/index.html` to see all your materials and print instructions."

## Keep docs in sync

After generating materials, update:
- `docs/architecture.md` — note the print materials in `public/print/`
- Add `public/print/` to the site's directory structure documentation
