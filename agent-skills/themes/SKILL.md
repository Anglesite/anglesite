---
name: themes
description: "Present pre-built visual themes from freedesignmd plus built-in quick-picks, then apply the owner's choice"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: WebFetch, Write, Read, Edit, Glob
metadata:
  author: "David W. Keith"
  version: "1.2.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "model-only"
---

Present pre-built visual themes and apply the owner's choice. Called by the design-interview, start, and design-import skills — not invoked directly.

Two paths:

1. **freedesignmd catalog** — 121+ curated `DESIGN.md` files at [freedesignmd.com](https://freedesignmd.com). The primary path. Delegate to the `freedesignmd` skill.
2. **Built-in quick-picks** — 9 small presets defined in `references/template/scripts/themes.ts`. Useful when the owner wants a one-line decision without browsing.

## Step 1 — Suggest a default and offer both paths

Read `BUSINESS_TYPE` from `.site-config`. Map it to a recommended built-in theme using `themeForBusinessType()`:

| Business types | Suggested built-in |
|---|---|
| Legal, finance, insurance, accounting | Classic |
| Healthcare, wellness, grocery, pharmacy | Fresh |
| Restaurant, bakery, brewery, hospitality | Warm |
| Fitness, trades, auto, equipment | Bold |
| Farm, florist, hardware, veterinarian | Earthy |
| Childcare, pet services, dance, youth | Playful |
| Salon, photography, jewelry, theater | Elegant |
| Nonprofit, worship, social services | Community |
| Web artist, creative coder, generative art | Studio |

Tell the owner:

> You have two ways to pick a look:
>
> 1. **Browse the freedesignmd catalog** — 121+ curated design systems with different visual styles (minimal, premium, editorial, glass, dark, etc.). I'll suggest a few that fit your business and you can pick one or browse more at https://freedesignmd.com/systems.
> 2. **Quick-pick from 9 built-ins** — fast preset choice. I'd suggest **\<suggested built-in\>** for your type of business, but pick whichever feels right.
>
> Which would you prefer?

If the owner picks the catalog, follow Step 2 (freedesignmd path). If they pick a built-in, follow Step 3 (built-in path).

## Step 2 — freedesignmd path

Delegate to the freedesignmd skill: read and follow the `freedesignmd` skill. It handles candidate recommendation, fetching the chosen `DESIGN.md`, translating tokens to CSS custom properties, updating `docs/brand.md`, and verifying the build.

When that skill finishes, return to the caller.

## Step 3 — Built-in quick-pick path

Read `references/template/scripts/themes.ts` for exact hex values and font stacks of the 9 built-in themes (Classic, Fresh, Warm, Bold, Earthy, Playful, Elegant, Community, Studio).

Present them as a markdown list with the suggested theme highlighted:

> Here are the 9 built-in themes. The one I'd recommend for your business is **\<suggested\>**, but pick whichever feels right:
>
> - **Classic** — traditional, trustworthy. Navy + gold, serif headings.
> - **Fresh** — clean, modern, health-conscious. Green + sky blue, sans-serif.
> - **Warm** — welcoming, cozy. Amber + red, serif headings.
> - **Bold** — energetic, confident. Blue + amber on dark, sans-serif.
> - **Earthy** — grounded, hand-made. Olive + terracotta, serif headings.
> - **Playful** — friendly, approachable. Violet + coral, sans-serif.
> - **Elegant** — refined, considered. Charcoal + crimson, serif headings.
> - **Community** — sincere, focused. Forest + amber, sans-serif.
> - **Studio** — dark mode for creative coders. Mono green on black, monospace.
>
> Which one would you like?

When the owner picks a name, update `:root` in `src/styles/global.css` with the theme's color and font variables (use the **Edit tool**). Keep spacing, radius, shadows, and other properties unchanged.

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

For the **Studio** theme (web-artist sites), the values are:

```css
:root {
  --color-primary: #e0e0e0;
  --color-accent: #00ff88;
  --color-bg: #000000;
  --color-text: #e0e0e0;
  --color-muted: #888888;
  --color-surface: #111111;
  --color-border: #222222;
  --font-heading: ui-monospace, 'Cascadia Code', 'Source Code Pro', 'Fira Code', monospace;
  --font-body: ui-monospace, 'Cascadia Code', 'Source Code Pro', 'Fira Code', monospace;
}
```

The accent (`#00ff88`) is high-contrast green for dark backgrounds. Any saturated hue works — the key is high contrast against black.

Update `docs/brand.md` with the theme choice. Run `npm run build` to verify.

## Step 4 — Offer customization

After applying (either path), ask:

> Want to adjust any of the colors? For example, I can change the primary color to better match your logo, or swap the accent color.

If they want changes, update individual CSS custom properties and rebuild. If they want to switch styles entirely, repeat from Step 1.

If they're happy, return to the caller.
