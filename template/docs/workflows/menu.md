# Restaurant menu

Create, import, or edit a restaurant menu. Supports PDF/photo import, building from scratch, and editing existing menus through Keystatic.

## What gets created

- Three Keystatic collections: **menus**, **menu sections**, and **menu items**
- `/menu` index page with responsive layout (scroll, tabs, or separate pages)
- `/menu/[slug]` individual menu pages (when multiple menus exist)
- `/menu/kiosk` headerless page for QR/NFC table access
- Schema.org `Menu`/`MenuSection`/`MenuItem` structured data
- Dietary badges with standardized icons (vegetarian, vegan, gluten-free, dairy-free, nut-free, halal, kosher, spicy, raw, contains-alcohol)
- Design tokens extracted from the original PDF/image (optional)

## Entry paths

| Starting point | What happens |
|---|---|
| **PDF or photo** | Claude reads the file, extracts items/sections/prices/dietary info, and asks you to verify before generating |
| **From scratch** | Claude suggests sections based on your cuisine type, then you add items conversationally |
| **Edit existing** | Claude reads your current menu and presents it for changes |

## Multi-menu support

If you have multiple menus (lunch, dinner, brunch, catering), the layout adapts automatically:

| Menu count | Default layout |
|---|---|
| 1 | Single scrolling page |
| 2-4 | Tabbed navigation |
| 5+ | Separate pages with index cards |

You can override the layout in Keystatic by editing each menu's **Layout** field.

## Dietary tags

Dietary labels are always confirmed with you before publishing. Claude will suggest tags based on ingredients but never auto-publish allergen information.

Custom tags (e.g., a spice scale, house specialties) are supported alongside the standardized set.

## Re-importing an updated menu

When you re-run the command with a new PDF, Claude diffs it against the existing menu:

- Shows what changed (new items, removed items, price updates)
- Preserves your manual edits (descriptions you rewrote, images you added)
- Asks you to approve each change before applying

## Kiosk mode

The `/menu/kiosk` page is designed for QR codes at tables:

- No site header or footer — just the menu
- Fixed section tabs for quick navigation
- Dietary filter buttons to narrow by dietary need
- Works on phones in any orientation

Use `/anglesite:qr` after setup to generate table cards linking to the kiosk page.

## Editing after creation

All menu content lives in Keystatic collections. Open the CMS to update prices, add items, toggle availability, or reorder sections without re-importing.

## Configuration

These values are saved to `.site-config`:

| Key | Purpose |
|---|---|
| `MENU_ENABLED` | Whether the menu feature is active |
| `MENU_LAYOUT` | Override for layout (scroll, tabs, pages) |
| `MENU_KIOSK` | Whether kiosk mode is enabled |
| `MENU_LAST_IMPORT` | Date of last PDF/image import |
