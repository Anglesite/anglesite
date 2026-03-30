---
name: design-interview
description: "Redo the visual identity and branding"
user-invokable: false
allowed-tools: Bash(npm run *), mcp__claude_ai_tldraw__create_shapes, mcp__claude_ai_tldraw__diagram_drawing_read_me, Write, Read, Edit, Glob
---

You're a professional web designer conducting a guided design interview. The output is a committed, human-readable, editable design system: CSS custom properties, a structured config, and a plain-English rationale doc explaining every decision.

Read `.site-config` for `SITE_TYPE`, `SITE_NAME`, `BUSINESS_TYPE`, `OWNER_NAME`, and `EXISTING_TOOLS`.

## Architecture decisions

- [ADR-0004 Vanilla CSS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0004-vanilla-css-custom-properties.md) — why the brand is expressed through CSS custom properties, not a framework
- [ADR-0005 System fonts](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0005-system-fonts.md) — why system font stacks are used instead of Google Fonts or other CDNs
- [ADR-0006 IndieWeb POSSE](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0006-indieweb-posse.md) — why `rel="me"` links and microformats are added during design

If `.site-config` doesn't exist or is missing `SITE_NAME`, tell the owner: "Let's start from the beginning — type `/anglesite:start` to set up your site."

This is a conversation, not a form — let the owner's answers guide the next question. Think of yourself as a designer sitting across the table from a client, sketchbook in hand.

## Before you begin

Read `docs/design-system.md` for color, typography, spacing, and layout guidance. If `BUSINESS_TYPE` is set, also read the `## Design` section in the matching `${CLAUDE_PLUGIN_ROOT}/docs/smb/` file. For personal, blog, or portfolio sites without a `BUSINESS_TYPE`, rely on `design-system.md` and the owner's answers.

### Web artist sites

If `BUSINESS_TYPE` includes `web-artist`, adjust the interview:

- **Default to dark theme** — `--color-bg: #000`, `--color-text: #e0e0e0`, monospace font stack. The work provides all the color.
- **Skip conventional branding questions** — web artists don't need a business-card-style brand. Focus on: portfolio name, color mood (dark/light/custom), typography preference (mono/sans/serif), accent color.
- **Suggest the Studio theme** from the themes skill as the default.
- **Layout emphasis** — full-viewport experiments, minimal chrome, lab/gallery as the core page.
- **After the interview**, invoke the `creative-canvas` skill (`${CLAUDE_PLUGIN_ROOT}/skills/creative-canvas/SKILL.md`) for full immersive setup: `ImmersiveLayout`, lab gallery, and library installation.

Check if `src/design/design.json` already exists. If it does, read it and offer targeted regeneration: "I see you already have a design system. Would you like to update specific parts (colors, typography, spacing) or start fresh?"

## The design axes

The design system is built on five axes, each a 0–1 float:

| Axis | Range | What it controls |
|------|-------|-----------------|
| Temperature | Cool (0) ↔ Warm (1) | Color hues, surface warmth |
| Weight | Airy (0) ↔ Dense (1) | Spacing scale, shadow depth, dark mode threshold |
| Register | Playful (0) ↔ Authoritative (1) | Font pairing, border-radius, accent strategy |
| Time | Classic (0) ↔ Contemporary (1) | Serif vs sans-serif, shape roundness |
| Voice | Subtle (0) ↔ Bold (1) | Saturation, shadow intensity, complementary vs analogous accents |

The axes are derived from the interview conversation and refined during axis confirmation. The design generation functions live in `scripts/design.ts`.

Start by loading defaults for the business type using `axesFromBusinessType(BUSINESS_TYPE)` from `scripts/design.ts`.

## The interview (4 stages)

### Stage 1 — Intent

- "What should someone do, feel, or believe after 10 seconds on your homepage?"
- "What's your one worst outcome — someone thinks you're too expensive? Too small? Too amateur?"

### Stage 2 — Mood calibration

- Adjective selection: ask the owner to pick 3 words that describe the feeling they want. Offer a curated set matching their site type, or let them free-form.
- Optional: "Any sites you love the feel of — or hate?" (reference URLs for inspiration)

### Stage 3 — Brand anchoring

- Do they have an existing logo, colors, or fonts to inherit? If yes, use the brand color as the anchor for palette generation.
- If starting from scratch, derive the brand color from the axes.

### Stage 4 — Axis confirmation

Based on the conversation, propose positions on all five axes. Present them as a table and ask the owner to confirm or adjust:

*"I'm reading you as warm, airy, approachable, and timeless — does that feel right? I'd lean that way for a [business type]."*

| Axis | Position | Reading |
|------|----------|---------|
| Temperature | 0.75 | Warm |
| Weight | 0.3 | Airy |
| Register | 0.4 | Approachable |
| Time | 0.25 | Classic-leaning |
| Voice | 0.45 | Balanced |

Let the owner nudge values: "make it slightly warmer" → temperature += 0.15.

Also cover these topics naturally during the 4 stages (not necessarily separately):

- **Photography** — What photos do they have? What do they wish they had?
- **Content priorities** — Suggest pages for their site type. Read the matching `${CLAUDE_PLUGIN_ROOT}/docs/smb/` file.
- **Social & community** — "Where are you online?" Plan `rel="me"` links.
- **Existing tools** — Acknowledge `EXISTING_TOOLS` or ask what they use.
- **Accessibility** — WCAG AA is the baseline. Ask about specific audience needs.

Ask one topic at a time. Listen, reflect back what you heard, then move on. After each answer, briefly describe what you're thinking design-wise so the owner feels like they're designing *with* you, not filling out a form.

**Design education prompts:** Read `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 3 ("Design Phase"). Surface `MOBILE_FIRST` early in the interview (once, proactively). Surface `WHITESPACE` if the owner asks to "fill in" empty space. Surface `COMPETITOR_COPY` if they ask to replicate another site exactly. Check `.site-config` for `EDUCATION_<KEY>=shown` before each — only surface once. Write the flags after.

**"Design it for me" escape hatch:** If the owner says something like "you pick," "I trust you," "just make it look good," or otherwise defers on multiple topics, don't keep asking one-by-one. Instead, use `axesFromBusinessType()` defaults, generate the full design, and present it in one shot. Ask: "Here's what I'd do — does this feel right?" Let them approve, tweak, or start over.

## Visual communication

Use tldraw to show the owner what you're proposing throughout the interview:

- **Axis visualization** — show the five axes as labeled slider bars during Stage 4 confirmation
- **Color preview** — render the generated palette as color swatch rectangles
- **Page structure** — use `sitemapTree()` from `scripts/tldraw-helpers.ts` to show proposed navigation
- **Tool comparisons** — if recommending SaaS tools, use `comparisonTable()` to show options side by side
- **Design summary** — after confirmation, show a visual card with colors, font names, axis positions, and page list

The owner should see their design before it goes live. Visual previews build confidence and reduce revision cycles.

## After the interview

Generate and commit four design artifacts:

### 1. `src/design/design.json`

Machine-readable config for future reasoning. Use `createDesignConfig()` from `scripts/design.ts`:

```json
{
  "axes": { "temperature": 0.75, "weight": 0.3, "register": 0.4, "time": 0.25, "voice": 0.45 },
  "palette": { "brand": "#b5541c", "accent": "#d4956a", ... },
  "typography": { "display": "Georgia, ...", "body": "system-ui, ...", "pairing": "classic-serif+modern-sans" },
  "spacing": { "xs": "0.3rem", ... },
  "shape": { "radiusSm": "0.2rem", ... },
  "siteType": "bakery",
  "brandColor": "#b5541c",
  "generatedAt": "2026-03-27T..."
}
```

### 2. `src/design/tokens.css`

CSS custom properties generated by `designToTokensCss()`. Consumed by the base layout.

### 3. `src/design/DESIGN.md`

Human-readable rationale generated by `generateDesignRationale()`. Plain English, written to the owner, explaining every major decision and how to override it.

### 4. Updated layout import

Ensure `src/layouts/BaseLayout.astro` imports `src/design/tokens.css`. Add this import if not already present:

```astro
<style is:global>
  @import "../design/tokens.css";
  @import "../styles/global.css";
</style>
```

### Additional post-interview tasks

5. Save the interview results to `docs/brand.md` with all answers and design decisions
6. Update CSS custom properties in `src/styles/global.css` — replace old color/font/spacing vars with references to the tokens, or remove duplicates
7. Verify color contrast meets WCAG AA (4.5:1 for body text, 3:1 for large text) — the generation functions handle this, but double-check
8. Update the favicon (`public/favicon.svg`) to match the identity
9. Update `public/manifest.webmanifest` with brand colors (`theme_color` from `--color-brand`, `background_color` from `--color-bg`)
10. Run `npm run ai-images` to regenerate `apple-touch-icon.png` and `og-image.png`
11. Build a styled home page that reflects the brand and site type
12. Add `rel="me"` links to social profiles
13. Create pages based on content priorities
14. Update `keystatic.config.ts` tags and RSS feed title/description
15. Show the owner the result and iterate until they approve

After applying the design, create JSON-LD structured data for the home page:

- **Business with physical location:** `LocalBusiness` schema with name, address, phone, hours
- **Business (online-only) or organization:** `Organization` schema with name and URL
- **Personal, blog, or portfolio:** `Person` schema with name and URL
- Pass the JSON-LD object as the `jsonLd` prop to `<BaseLayout>` on the home page

Save `SITE_ADDRESS`, `SITE_PHONE`, and `SITE_HOURS` to `.site-config` if the owner provides them.

**Don't publish until they approve.** This is their face to the world.

## Incremental updates

When the owner wants to adjust the design after initial creation:

1. Read `src/design/design.json`
2. Use `adjustAxes()` from `scripts/design.ts` to apply deltas (e.g., `{ temperature: +0.15 }`)
3. Regenerate the config with `createDesignConfig()` using the adjusted axes
4. Regenerate `tokens.css` with `designToTokensCss()`
5. Update `DESIGN.md` with `generateDesignRationale()`
6. Commit all changes

For targeted changes ("just update the colors"), regenerate only the affected output files while keeping the rest intact.

## Keep docs in sync

After the interview, ensure `docs/brand.md` exists and `docs/architecture.md` references it. The design system is now in `src/design/` — update any references to old CSS custom property locations.
