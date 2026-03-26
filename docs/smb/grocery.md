# Grocery & Specialty Food

Covers: independent grocery stores, co-op markets, specialty food shops (cheese, wine, butcher, bakery), ethnic/international grocery, natural foods stores.

## Pages

- **What we carry** — Categories, highlight local/specialty products, sourcing philosophy. Not a full inventory — highlight what makes the shop different.
- **Local producers** — Profiles of farms and makers the shop sources from. This is the story that differentiates from chain grocers.
- **Hours / location** — With parking, delivery area if applicable
- **About** — The shop's story, mission, community role. Co-ops should explain the membership model.
- **Weekly specials / flyer** — Updated regularly. Can be a blog post series or a dedicated page.
- **Events** — Tastings, cooking classes, farmer meet-and-greets, seasonal markets
- **Blog** — Recipes, producer spotlights, seasonal eating guides, store news
- **Catering / gift baskets** — If offered
- **Contact** — Phone, email, delivery/order info

## Design

**Visual mood:** Fresh, local, community-oriented. Clean and wholesome — the site should feel like walking into a well-kept neighborhood market. Approachable, not corporate.

**Color direction:** Bright greens, warm yellows, earth tones. White or cream background. Green as primary (freshness), warm accent (gold, orange) for specials and CTAs. Avoid anything that feels like a big-box chain.

**Typography feel:** Humanist stack (Segoe UI/Roboto) for friendly readability. Heading weight 600–700. Clean and welcoming, not overly stylized.

**Layout emphasis:** Hours, location, and weekly specials above the fold. Home page uses Pattern 2 (hero + content) with fresh produce photography. Specials section updated weekly. Max-width 56rem.

**Photography style:** Fresh produce and store interior photos with natural lighting. Bright, clean, appetizing. Show the real store and real products. 4:3 aspect ratio. Avoid stock photos — authenticity matters for local grocers.

**Key component:** Weekly specials or featured products section — a card or list highlighting this week's deals, seasonal items, or local producer features. Updated regularly to give customers a reason to check back.

## Tools

- **Square** (free POS, proprietary) — Good for in-person sales. Handles inventory basics.
- **IT Retail** or **Catapult** — Grocery-specific POS with inventory, pricing, vendor management. If the shop already uses one, don't replace it.
- **Open Food Network** (open source, nonprofit) — If the shop also does CSA boxes, farm pickup, or online ordering. openfoodnetwork.org
- For co-ops: **Co-op Management Software (CMS)** from NCGA or similar. Help them integrate the member portal with the website.

## Compliance

- **Food safety**: Display any required food handling certifications or licenses.
- **Alcohol (wine/beer shops)**: Alcohol sales online are heavily regulated by state. Don't build online alcohol ordering. Link to in-store availability. Display any required liquor license number.
- **Organic certification**: If the shop claims organic products, note the USDA certification. Display the certifier name.
- **WIC/SNAP/EBT**: If accepted, mention prominently — it's important for community access.
- **Co-op membership**: Clearly explain membership vs. non-member pricing if applicable.

## Review platforms

- **Google Business Profile** — "Grocery stores near me" and "natural food store [city]" searches resolve through Google. Reviews here often focus on the shopping experience, selection, staff knowledge, and freshness. Keep the profile updated with current hours and reply to reviews — especially those mentioning specific staff or products.
- **Yelp** — Yelp is actively used for specialty food shops, co-ops, and ethnic grocers. Detailed reviews about specialty products and sourcing help differentiate from chain grocers.

See `docs/smb/reviews.md` for full review management guidance.

## Content ideas

Weekly specials and seasonal highlights, recipes using products from the shop, local producer spotlights with photos, seasonal eating guides ("what's fresh this month"), cooking tips and techniques, event announcements (tastings, classes), community stories, holiday gift guides, co-op membership benefits and updates, food preservation tips.

## Key dates

- **National Nutrition Month** (Mar) — Healthy eating features, dietitian partnerships, recipe content.
- **World Food Day** (Oct 16) — Food access, local sourcing stories, community partnerships.
- **National Co-op Month** (Oct) — For co-ops. Member appreciation, cooperative values, community ownership stories.

## Structured data

Use `GroceryStore` with:
- name, address, phone, hours
- `paymentAccepted` — mention EBT/SNAP if applicable

## Data tracking

- **Contacts:** Name, Email, Phone, Type (Customer/Vendor/Producer/Member), Notes, Created Date
- **Producers:** Name, Contact (linked), Products, Location, Notes
- **Events:** Name, Date, Type (Tasting/Class/Market), Notes
