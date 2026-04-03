---
name: menu
description: "Create, import, or edit a restaurant menu from PDF, photo, or scratch"
allowed-tools: Bash(npm run dev), Bash(npm run build), Read, Write, Glob, Grep
disable-model-invocation: true
---

Create, import from PDF/image, or edit an existing restaurant menu. Generates Keystatic collections, responsive HTML pages, structured data, and optional kiosk mode.

## Architecture decisions

- [ADR-0001 Astro](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro-static-site-generator.md) — static pages, file-based routing
- [ADR-0002 Keystatic](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0002-keystatic-local-cms.md) — menu data lives in local `.mdoc` files, editable in CMS
- [ADR-0009 Industry tools](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — HTML menu over PDF downloads

## References

- Restaurant industry guide: `${CLAUDE_PLUGIN_ROOT}/docs/smb/restaurant.md`
- Menu extraction utilities: `${CLAUDE_PLUGIN_ROOT}/scripts/import/menu-extract.mjs`
- Menu JSON-LD generation: `template/scripts/menu.ts`
- Menu page template: `template/src/pages/menu.astro`
- Individual menu pages: `template/src/pages/menu/[slug].astro`
- Menu styles: `template/src/styles/menu.css`
- QR skill (post-creation): `${CLAUDE_PLUGIN_ROOT}/skills/qr/SKILL.md`

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Determine entry path

Read `.site-config` for `SITE_TYPE` and `BUSINESS_TYPE`. Read the restaurant industry guide at `${CLAUDE_PLUGIN_ROOT}/docs/smb/restaurant.md` for context on what restaurant owners need from a menu page.

Check whether menu content already exists:

1. Glob for `src/content/menuItems/*.mdoc`
2. Glob for `src/content/menus/*.mdoc`

Then determine the entry path:

- **Owner provides a file** (PDF or image) → go to Step 1 (From PDF/image)
- **No existing menu content, no file** → go to Step 2 (From scratch)
- **Existing menu content found** → go to Step 3 (Edit existing)

If the owner's intent is ambiguous, ask: "Do you have a menu PDF or photo to work from, or would you like to create one from scratch?"

---

## Step 1 — From PDF/image

### 1a. Accept files

Ask the owner for the file path(s): "Where is your menu file? You can share a PDF or a photo of your menu board."

Accept one or more PDF files or images. Read each file using the Read tool (which supports PDF and image formats).

### 1b. Extract structured data

For each file, extract:
- **Sections** (e.g., Appetizers, Entrees, Desserts, Drinks)
- **Items** with name, description, and price
- **Dietary indicators** (V, VG, GF, DF, etc.) — use the parsing logic from `${CLAUDE_PLUGIN_ROOT}/scripts/import/menu-extract.mjs` (`parseDietaryIndicators`)
- **Design tokens** (colors, fonts, layout cues) — use `extractDesignTokens` from the same file

For multi-page PDFs, stitch pages together using `stitchMenuPages` logic — sections that continue across page breaks are merged, not duplicated.

### 1c. Present for review

Show the extracted menu to the owner in plain English:

> "Here's what I found on your menu:"
>
> **Dinner**
> - *Appetizers:* Caesar Salad ($14, vegetarian, gluten-free), Bruschetta ($12)...
> - *Entrees:* Grilled Salmon ($28), ...
>
> "Does this look right? Let me know if I missed anything or got a price wrong."

### 1d. Dietary tag verification (mandatory)

Show all detected dietary labels and ask the owner to confirm each one:

> "I found these dietary labels on your menu. Please confirm each one — it's important for customers with allergies:"
>
> - Caesar Salad: **Vegetarian, Gluten-free** ✓?
> - Pad Thai: **Vegan** ✓?
>
> "Are there any items I missed? Should any items have dietary labels added or removed?"

Suggest standardized icons for each dietary tag (🌿 vegetarian, 🌱 vegan, 🌾 gluten-free, 🥛 dairy-free).

### 1e. Menu organization

Ask about page layout:

> "How would you like your menu organized on the website?"
>
> - **Single page** — everything on one scrollable page with jump links (best for most restaurants)
> - **Tabbed** — switch between menus (Lunch / Dinner) without page reload
> - **Separate pages** — each menu gets its own page at `/menu/lunch`, `/menu/dinner`
>
> Suggest based on the imported structure: if there's only one menu, recommend single page. If there are multiple menus (Lunch, Dinner, Brunch), suggest tabbed or separate pages.

### 1f. Kiosk mode

Ask: "Will customers scan a QR code at the table to see this menu? If so, I can create a simplified kiosk view — larger text, no site navigation, just the menu."

### 1g. Save imported files

Save the original files to `docs/menu-imports/` for future re-import:

```
docs/menu-imports/dinner-menu.pdf
docs/menu-imports/import-log.md   ← date, source file, extraction notes
```

Then proceed to Step 4 (Generate).

---

## Step 2 — From scratch

### 2a. Cuisine and style

Ask: "What kind of food do you serve? And how would you describe the vibe — casual, fine dining, fast-casual, food truck?"

### 2b. Suggest sections

Based on cuisine type, suggest menu sections. Examples:

- **Italian** → Antipasti, Primi, Secondi, Contorni, Dolci
- **Mexican** → Appetizers, Tacos, Burritos, Platos Fuertes, Sides, Drinks
- **American** → Starters, Mains, Sandwiches, Sides, Desserts
- **Japanese** → Appetizers, Sushi, Sashimi, Rolls, Ramen, Sides
- **Café** → Breakfast, Lunch, Pastries, Drinks
- **Bakery** → Breads, Pastries, Cakes, Cookies, Custom Orders

Ask: "Here's what I'd suggest for your menu sections. Want to adjust these?"

### 2c. Add items

Walk through each section:

> "Let's fill in your [Section Name]. Tell me each item — the name, a short description, and the price. Also let me know if it's vegetarian, vegan, gluten-free, or has other dietary info."
>
> "When you're done with this section, just say 'next' and we'll move on."

### 2d. Organization and kiosk

Ask the same organization (single page, tabbed, separate pages) and kiosk questions as Step 1e–1f.

Then proceed to Step 4 (Generate).

---

## Step 3 — Edit existing

### 3a. Read current menu

Read the existing menu collections:

```
src/content/menus/*.mdoc
src/content/menuSections/*.mdoc
src/content/menuItems/*.mdoc
```

### 3b. Present current structure

Show the owner their current menu:

> "Here's your current menu:"
>
> **Dinner** (12 items across 3 sections)
> - Appetizers (4 items)
> - Entrees (5 items)
> - Desserts (3 items)
>
> "What would you like to change? You can:"
> - Add or remove items
> - Change prices
> - Add or reorganize sections
> - Update descriptions or dietary info

### 3c. Accept edits

Process the owner's requested changes. For each edit, update the corresponding `.mdoc` file.

### 3d. Re-import option

If the owner has a new PDF: "I can re-import from your updated menu file and show you what changed. Want to do that?"

If yes, run the import flow (Step 1) and diff the result against existing content. Show the owner what's new, changed, or removed before applying.

### 3e. Keystatic reminder

Tell the owner: "You can also edit menu items, prices, and descriptions anytime in Keystatic — just look under 'Menu Items' in the sidebar."

---

## Step 4 — Generate

### 4a. Build the hierarchy

Use the `buildMenuHierarchy` logic from `${CLAUDE_PLUGIN_ROOT}/scripts/import/menu-extract.mjs` to structure the data into menus → sections → items with slugs and ordering.

### 4b. Generate Keystatic collection files

Use `toKeystatic` from `${CLAUDE_PLUGIN_ROOT}/scripts/import/menu-extract.mjs` to generate `.mdoc` files:

- `src/content/menus/{slug}.mdoc` — menu metadata (name, description, order)
- `src/content/menuSections/{slug}.mdoc` — section metadata (name, menu relationship, order)
- `src/content/menuItems/{slug}.mdoc` — item data (name, section, price, dietary, available, order)

Write each file to disk. Create the content directories if they don't exist.

### 4c. Apply design tokens (import path only)

If the menu was imported with design tokens, use `extractDesignTokens` and `generateMenuCSS` from `${CLAUDE_PLUGIN_ROOT}/scripts/import/menu-extract.mjs` to generate custom CSS properties. Append them to `src/styles/menu.css` or create a `src/styles/menu-tokens.css` that `menu.css` imports.

### 4d. Generate kiosk page (if requested)

If the owner opted for kiosk mode, create `src/pages/menu/kiosk.astro`:

- Full-viewport layout (no header, footer, or site navigation)
- Large text optimized for phone screens
- Same menu data, simplified presentation
- Add a "View full site" link at the bottom

### 4e. Verify build

Run `npm run build` to confirm everything compiles.

---

## Step 5 — Post-creation

### 5a. QR code offer

Ask: "Would you like a QR code for table cards or your window? Customers can scan it to see the menu on their phone."

If yes, invoke the QR skill at `${CLAUDE_PLUGIN_ROOT}/skills/qr/SKILL.md` with the menu URL.

### 5b. Kiosk mode offer

If the owner didn't choose kiosk mode in Step 1f/2d but has a physical location, offer it now: "Some restaurants put a QR code on each table that opens the menu directly — no app download needed. Want me to set that up?"

### 5c. Update site navigation

Check if the site's navigation already includes a "Menu" link. If not, add it to the header navigation in `src/layouts/BaseLayout.astro` or the site's nav config.

### 5d. Update docs

Update `docs/architecture.md` to document the menu pages and collections.

Update `docs/content-guide.md` to explain the three menu content collections (menus, menuSections, menuItems) and how they relate.

### 5e. Tell the owner

> "Your menu is live on the site! Here's what we set up:"
>
> - A `/menu` page showing all your menus with prices, descriptions, and dietary labels
> - [If separate pages] Individual pages at `/menu/dinner`, `/menu/lunch`, etc.
> - [If kiosk] A kiosk view at `/menu/kiosk` for QR code scanning
> - Schema.org structured data so Google can show your menu in search results
>
> "You can edit menu items, prices, and descriptions anytime in Keystatic — just look under 'Menu Items' in the sidebar."
>
> "Run `/anglesite:deploy` when you're ready to publish."

---

## Re-running the command

If `/anglesite:menu` is run again, it enters the edit existing flow (Step 3). The command is idempotent — running it again detects existing content and lets the owner modify it.
