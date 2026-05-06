# Claude Design and open alternatives

Reference for Claude when an owner asks about [Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs), [opendesign](https://github.com/manalkaff/opendesign), or [open-design](https://github.com/nexu-io/open-design). These tools generate polished HTML mockups, decks, and one-pagers from a prompt. They are **ideation tools**, not site generators — their output does not drop into Astro + Keystatic without translation.

The Anglesite skills that already cover the same ground are:

- `design-interview` — visual identity questionnaire (the canonical starting point)
- `themes` and `freedesignmd` — pre-built design system pickers
- `design-import` — extract tokens and layouts from a Canva site or freedesignmd system
- `print` and `og-images` — print collateral and social images

Reach for the tools below only when those skills don't fit the job.

## Tools at a glance

| Tool | License | How it runs | Output | Fits Anglesite when |
|---|---|---|---|---|
| **Claude Design** | Anthropic, paid (Pro/Max/Team/Enterprise) | Hosted in Claude.ai | HTML, PDF, PPTX, Canva export | Owner already has a Claude subscription and wants pitch decks, sales one-pagers, or hero visuals |
| **opendesign** | Apache-2.0 | Plugin (`/plugin install opendesign`) — runs inside Claude Code, Cursor, Gemini CLI | Interactive HTML on `localhost:8289`, design-system docs in repo | Developer wants design-system extraction and wireframes during build |
| **open-design** | Apache-2.0 | Local Next.js + Express + SQLite app, also exposes an MCP server | HTML, PDF, PPTX, video; can import Claude Design ZIPs | Developer wants a Claude-Design-shaped workflow without the subscription |

## When to recommend (and when not to)

**Recommend** when the asset lives **outside** the website:
- Pitch decks, investor one-pagers, sales collateral
- Conference handouts, print flyers (alongside `print`)
- Hero or about-page imagery the owner wants to ideate visually before committing

**Don't recommend** for building the website itself. Anglesite produces semantic Astro pages with Keystatic-editable content. Pasting a Claude Design HTML mockup into `src/pages/*.astro` is manual rewriting — slower than running `design-interview` in the first place. And the mockups bring patterns Anglesite explicitly avoids: third-party fonts (ADR-0005), absolute-positioned layouts, embedded scripts (ADR-0008).

## Workflow: ideate externally, import deliberately

1. **Generate** the asset in Claude Design, opendesign, or open-design.
2. **Export** as a static artifact:
   - **Images** (PNG, JPG, WebP) — the cleanest path. Drop into `public/images/` and reference from Astro.
   - **PDF / PPTX** — link from the site, don't embed. Store in `public/downloads/` if it must be hosted on the site.
   - **HTML** — extract tokens (colors, type) by hand, then run `/anglesite:design-interview` with those tokens as starting input. Don't ship the HTML.
3. **Optimize** images via the `optimize-images` skill before committing (resize, WebP, strip EXIF).
4. **Update** `docs/brand.md` if the exercise produced a stronger visual direction than what's in the site's design system.

## Tool-specific notes

### Claude Design

- Owner-driven. The owner runs Claude Design in their Anthropic account and shares exports with Claude Code.
- `share` URLs are not stable for programmatic ingest — ask the owner to download the artifact (PNG/PDF/PPTX) and place it in the repo.
- The "build a design system from your codebase" feature is interesting but redundant with `design-interview` + `freedesignmd`. Skip it for Anglesite sites.

### opendesign

- Markdown-based skill plugin, runs inside Claude Code. Compatible with Anglesite as a sibling plugin — they don't conflict.
- Useful for **wireframing** new pages before scaffolding them in Astro. Treat the served HTML on `:8289` as a sketch, not a deliverable.
- Its "extract design system from codebase" can read the scaffolded site's `src/styles/global.css` tokens — handy for keeping its mockups on-brand.

### open-design

- Heavier setup (Next.js + Express + SQLite). Only suggest to owners with developer comfort.
- Can ingest a Claude Design ZIP, which is the practical route if the owner generated something in Claude Design but doesn't want Anglesite to re-do the work.
- Outputs can include video (Seedance, HyperFrames) — treat generated video like any other media asset (host on the site or link to a privacy-friendly host).

## Boundaries

- **Never** import third-party scripts from a generated mockup into the site. The deploy gate blocks unauthorized JS (ADR-0008) and would fail anyway.
- **Never** paste a Claude Design HTML page directly into `src/pages/`. Translate the design intent through `design-interview` or `design-import` so the result follows ADR-0004 (vanilla CSS) and BaseLayout conventions.
- **Don't promote a paid tool unprompted.** Claude Design requires a paid Anthropic plan beyond Cowork; mention it only if the owner asks, has already mentioned it, or specifically wants pitch-deck-style output.
