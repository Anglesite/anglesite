---
name: themes
description: "Present pre-built visual themes with tldraw color swatch cards"
user-invokable: false
allowed-tools: mcp__claude_ai_tldraw__create_shapes, mcp__claude_ai_tldraw__diagram_drawing_read_me, Write, Read, Glob
---

Present pre-built visual themes as color swatch cards using tldraw, then apply the owner's choice. Called by the design-interview skill — not invoked directly.

Theme definitions are in `${CLAUDE_PLUGIN_ROOT}/template/scripts/themes.ts`. Read them for exact hex values.

## Step 1 — Suggest a default theme

Read `BUSINESS_TYPE` from `.site-config`. Map it to a recommended theme using `themeForBusinessType()`:

| Business types | Suggested theme |
|---|---|
| Legal, finance, insurance, accounting | Classic |
| Healthcare, wellness, grocery, pharmacy | Fresh |
| Restaurant, bakery, brewery, hospitality | Warm |
| Fitness, trades, auto, equipment | Bold |
| Farm, florist, hardware, veterinarian | Earthy |
| Childcare, pet services, dance, youth | Playful |
| Salon, photography, jewelry, theater | Elegant |
| Nonprofit, worship, social services | Community |

## Step 2 — Show theme cards with tldraw

Use `mcp__claude_ai_tldraw__create_shapes` to render all 8 themes as a visual grid. Each theme is a card with:

1. A large rectangle as the card background (use a tldraw color that approximates the theme's background)
2. A smaller rectangle showing the primary color (use the closest tldraw color match)
3. A smaller rectangle showing the accent color (use the closest tldraw color match)
4. Text labels with the theme name, description, hex values, and "Best for" types

### Color mapping (theme hex → closest tldraw color)

| Theme | Primary tldraw | Accent tldraw |
|---|---|---|
| Classic | blue | yellow |
| Fresh | green | light-blue |
| Warm | orange | red |
| Bold | blue | yellow |
| Earthy | green | orange |
| Playful | violet | red |
| Elegant | grey | red |
| Community | green | orange |

### Layout

Arrange themes in a 4×2 grid. Each card is approximately 360px wide × 280px tall with 40px gaps.

```
Row 1: Classic    Fresh     Warm      Bold
Row 2: Earthy     Playful   Elegant   Community
```

Card structure (per theme):
- Card background: rectangle at (col × 400, row × 320), w=360, h=280
- Primary swatch: rectangle at (x+20, y+60), w=80, h=60, fill="solid", color=primary
- Accent swatch: rectangle at (x+120, y+60), w=80, h=60, fill="solid", color=accent
- Theme name: text at (x+180, y+20), size="l", font="sans"
- Description: text at (x+180, y+50), size="s", font="sans", color="grey"
- Hex values: text at (x+20, y+140), size="s", font="mono"
- Best for: text at (x+20, y+180), size="s", font="sans", color="grey", maxWidth=320

Mark the suggested theme with a star shape or a thicker border.

After rendering, tell the owner: "Here are 8 visual themes to choose from. I'd suggest **[suggested theme]** for your type of business, but pick whichever feels right. You can always customize colors later."

## Step 3 — Apply the chosen theme

When the owner picks a theme (by name), read the theme's CSS custom properties and update `src/styles/global.css`:

Replace the `:root` color and font variables with the theme's values. Keep spacing, radius, shadows, and other properties unchanged.

Example — if they pick "Warm":

```css
:root {
  /* Colors — Warm theme */
  --color-primary: #b45309;
  --color-accent: #dc2626;
  --color-bg: #fffbf5;
  --color-text: #292524;
  --color-muted: #78716c;
  --color-surface: #fef3c7;
  --color-border: #e7e0d5;

  /* Fonts — Warm theme */
  --font-heading: Georgia, 'Times New Roman', serif;
  --font-body: system-ui, -apple-system, sans-serif;
  ...
```

Update `docs/brand.md` with the theme choice and any customizations.

## Step 4 — Offer customization

After applying, ask: "Want to adjust any of the colors? For example, I can change the primary color to better match your logo, or swap the accent color."

If they want changes, update individual CSS custom properties. Run `npm run build` to verify after changes.

If they're happy, continue with the rest of the design interview.
