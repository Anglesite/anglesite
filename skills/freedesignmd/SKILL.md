---
name: freedesignmd
description: "Browse, fetch, and apply a design system from freedesignmd.com to the project"
user-invocable: false
allowed-tools: WebFetch, Write, Read, Edit, Glob
---

Apply a design system from [freedesignmd.com](https://freedesignmd.com) — a free catalog of 121+ `DESIGN.md` files. Called by the start, themes, design-interview, and design-import skills. Not invoked directly by the owner.

Read `${CLAUDE_PLUGIN_ROOT}/docs/freedesignmd.md` for the full reference: catalog URLs, business-type mapping, fetch pattern, and token translation rules.

## Architecture decisions

- [ADR-0004 Vanilla CSS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0004-vanilla-css-custom-properties.md) — tokens map to CSS custom properties
- [ADR-0005 System fonts](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0005-system-fonts.md) — map any custom font in the DESIGN.md to a system font stack
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — `DESIGN.md` is guidance for Claude, not a runtime dependency

## Step 1 — Recommend candidates

Read `BUSINESS_TYPE` from `.site-config`. Use the business-type → tag mapping in `${CLAUDE_PLUGIN_ROOT}/docs/freedesignmd.md` to pick 2–3 tags that fit.

Browse the catalog:

```
WebFetch(
  url: "https://freedesignmd.com/systems",
  prompt: "List 5 design systems matching these tags: <tags>. For each, return the slug (from URLs like /system/<slug>), display name, and a one-line description."
)
```

Present the candidates as a markdown list with brief descriptions and the catalog URL so the owner can browse beyond the suggestions:

> Here are a few design systems that fit your business. Browse the full catalog at https://freedesignmd.com/systems if none feel right.
>
> 1. **Linear Orbit** — minimal, premium, developer-leaning
> 2. **Magazine Bold** — editorial serif with strong hierarchy
> 3. **Devshell Mono** — monospace, dark, lab-like
>
> Which one would you like, or want me to suggest a different style?

If the owner already has a freedesignmd URL in mind, skip recommendation and go straight to Step 2 with their slug.

## Step 2 — Fetch the chosen DESIGN.md

Build the system page URL: `https://freedesignmd.com/system/<slug>` (or `/pattern/<slug>` for layout patterns).

```
WebFetch(
  url: "https://freedesignmd.com/system/<slug>",
  prompt: "Extract and return the complete DESIGN.md content shown on this page. Include the full markdown — color tokens, typography, spacing, components, layout rules. Return only the markdown content, no commentary or framing text."
)
```

If the response looks truncated or doesn't contain markdown sections, retry once with a more specific prompt asking for the raw markdown only.

## Step 3 — Save the DESIGN.md

Write the fetched markdown to `src/design/DESIGN.md` using the **Write tool**. Create the directory first if needed.

This file becomes ongoing guidance for Claude when generating new pages, components, or animations. It does not participate in the build.

## Step 4 — Translate tokens to CSS custom properties

Read `src/styles/global.css`. Update the `:root` block by mapping `DESIGN.md` tokens to the project's existing CSS custom properties:

| DESIGN.md concept | CSS custom property |
|---|---|
| Background | `--color-bg` |
| Primary / brand | `--color-primary` |
| Accent | `--color-accent` |
| Text | `--color-text` |
| Muted / secondary text | `--color-muted` |
| Surface / card | `--color-surface` |
| Border | `--color-border` |
| Heading font | `--font-heading` |
| Body font | `--font-body` |

Per ADR-0005, **map any custom font** in the DESIGN.md to a similar system font stack:

- Serif (Playfair, Merriweather, Source Serif) → `Georgia, 'Times New Roman', serif`
- Sans-serif (Inter, Geist, Manrope) → `system-ui, -apple-system, sans-serif`
- Monospace (JetBrains Mono, Fira Code) → `ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace`

If the DESIGN.md provides spacing or radius scales, map them to `--space-*` and `--radius-*` if those variables exist in the project.

Use the **Edit tool** to update `src/styles/global.css`. Preserve everything outside the token block.

## Step 5 — Verify contrast

After applying, check that body text on the chosen background meets WCAG AA (4.5:1). For large text and accent colors on background, 3:1 is the minimum. If the chosen system fails, either:

- Pick a higher-contrast variant from the same family in the catalog, or
- Adjust `--color-text` or `--color-bg` slightly to pass and note the change in `docs/brand.md`.

## Step 6 — Update docs/brand.md

Write `docs/brand.md` (or update if it exists) with:

- The chosen system name and slug
- Source URL: `https://freedesignmd.com/system/<slug>`
- The translated CSS tokens (final values applied to the project)
- A one-paragraph rationale: why this system fits the business

## Step 7 — Build verification

```
npm run build
```

If the build fails, fix the cause (usually a missing CSS variable referenced elsewhere) before reporting success.

## Step 8 — Confirm with the owner

Tell the owner:

> I've applied **\<system name\>** from freedesignmd. The full design system is saved at `src/design/DESIGN.md` so I can keep new pages consistent. Want to see the site, tweak any colors, or pick a different system?

If they want to swap systems, repeat from Step 1. If they want to tweak colors, edit `src/styles/global.css` directly and rebuild.
