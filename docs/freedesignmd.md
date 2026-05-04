# freedesignmd integration

[freedesignmd.com](https://freedesignmd.com) is a free, curated catalog of `DESIGN.md` files — markdown design-system specs (color tokens, typography, spacing, components, layout rules) intended to be dropped into a project so AI agents generate consistent UI from them.

Anglesite uses freedesignmd as the primary source for visual identity. The lighter approach: a `DESIGN.md` lives in the project at `src/design/DESIGN.md` as guidance for Claude. Tokens are translated **once** into `src/styles/global.css` (vanilla CSS custom properties, per ADR-0004). No build-time integration, no runtime dependency, no external request after the initial fetch.

## Catalog

- **Browse**: `https://freedesignmd.com/systems` and `https://freedesignmd.com/patterns`
- **System detail page**: `https://freedesignmd.com/system/<slug>` (e.g., `/system/linear-orbit`)
- **Pattern detail page**: `https://freedesignmd.com/pattern/<slug>` (e.g., `/pattern/stacked-bands`)
- **Tags**: minimal, modern, premium, dark, light, editorial, glass, gradient, serif, monochrome, plus 70+ more

## Fetching a `DESIGN.md`

The site exposes "Copy .md" and "Download .md" buttons on each system page, but the underlying URL is JS-driven and not stable. Use **WebFetch** with this prompt to extract the markdown content from the rendered page:

```
WebFetch(
  url: "https://freedesignmd.com/system/<slug>",
  prompt: "Extract and return the complete DESIGN.md content shown on this page. Include the full markdown — colors, typography, spacing, components, layout rules. Return only the markdown, no commentary."
)
```

Save the result to `src/design/DESIGN.md`.

## Business-type → recommended style

When recommending a system for a business, match the business type to a freedesignmd style. Browse `https://freedesignmd.com/systems` filtered by tag and pick 3–5 candidates to present.

| Business types | Suggested tags / vibe |
|---|---|
| legal, finance, insurance, accounting, real-estate | `serif`, `editorial`, `premium` — authoritative, trustworthy |
| healthcare, wellness, pharmacy, cleaning | `minimal`, `light`, `modern` — clean, calm |
| restaurant, bakery, brewery, hospitality | `editorial`, `serif`, `warm` — inviting, hospitality-first |
| fitness, trades, auto, equipment-rental | `bold`, `dark`, `monochrome` — energetic, confident |
| farm, florist, hardware, veterinarian | `editorial`, `serif`, `earthy` — grounded, hand-made |
| childcare, pet-services, dance, youth-org | `light`, `gradient`, `playful` — friendly, approachable |
| salon, photography, jewelry, theater | `editorial`, `serif`, `premium` — refined, considered |
| nonprofit, house-of-worship, social-services | `minimal`, `light`, `editorial` — sincere, focused |
| web-artist, creative-coder, generative-art | `dark`, `monochrome`, `minimal` — work-forward, lab-like |
| tech, SaaS, developer-tool | `minimal`, `dark`, `monochrome`, `premium` — Linear-orbit style |
| personal, blog, portfolio (general) | `editorial`, `minimal`, `serif` — content-forward |

This is a starting point — let the owner's mood and references override the default. The freedesignmd catalog evolves; use the live tag filter to surface current options.

## Applying a `DESIGN.md` to the project

Once the owner has chosen a system:

1. **Save the markdown** to `src/design/DESIGN.md`.
2. **Translate tokens** to CSS custom properties in `src/styles/global.css`. Map `DESIGN.md` color tokens, typography, spacing, and shape values into the project's existing CSS variable names:

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
   | Spacing scale | `--space-*` |
   | Radius | `--radius-*` |

   Per ADR-0005 (system fonts), map any custom font in the `DESIGN.md` to a similar **system font stack** rather than loading from a CDN. Common mappings:

   - Serif fonts (Playfair, Merriweather, Source Serif) → `Georgia, 'Times New Roman', serif`
   - Sans-serif fonts (Inter, Geist, Manrope) → `system-ui, -apple-system, sans-serif`
   - Monospace fonts (JetBrains Mono, Fira Code) → `ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace`

3. **Update `docs/brand.md`** with the chosen system name, source URL, and the translated tokens, plus a one-paragraph rationale.

4. **Verify contrast**: WCAG AA — 4.5:1 for body text, 3:1 for large text. Adjust if needed.

5. **Build** — `npm run build` to verify nothing is broken.

The `DESIGN.md` stays in the project as ongoing guidance for Claude when generating new pages, components, or animations. It does **not** participate in the build.

## When to use freedesignmd vs the design interview

- **freedesignmd** — owner wants a fast, polished result and is happy to pick from a catalog. One-time decision per site.
- **design-interview** (`/anglesite:design-interview`) — owner wants something bespoke that emerges from a conversation about their brand, voice, and audience.

Skills should offer **both paths** when appropriate. The fast path is usually right for owners who say "just make it look good" or "I trust your judgment."

## License

freedesignmd is free for all uses — download, remix, commercial deployment. No account or attribution required.
