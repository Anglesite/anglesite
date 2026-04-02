# Style Guide

Coding standards for HTML, CSS, and TypeScript in Anglesite-generated sites. Read this before creating or modifying pages and components. For design token values, color palettes, and layout patterns, see `template/docs/design-system.md`.

## Design principles

1. **Use templates and shared components** — When the same visual pattern appears on two or more pages, extract it into a reusable Astro component in `src/components/`. Don't duplicate markup and styles across pages.
2. **Design tokens over magic numbers** — Use CSS custom properties (`--space-md`, `--color-primary`, etc.) for all colors, spacing, font sizes, radii, and shadows. Never hardcode values.
3. **Semantic HTML first** — Choose the right element (`section`, `nav`, `article`, `aside`) before reaching for classes. Add ARIA attributes only when native semantics are insufficient.
4. **Zero runtime JS** — No third-party JavaScript in production. Interactive features use external provider embeds or CSS-only solutions. Astro's `is:inline` directive is allowed for provider scripts (booking widgets, analytics).
5. **Mobile-first progressive enhancement** — Base styles target small screens. Larger viewports add enhancements via `min-width` media queries.

## HTML

### When to create a shared component

Extract a component when:

- The same visual pattern appears on two or more pages (cards, grids, badges)
- The pattern takes varying data (title, image, link) — make those props
- The markup exceeds ~20 lines and has internal structure worth naming

Keep inline when:

- The markup is page-specific and unlikely to repeat
- The pattern is trivially simple (a single styled `<div>`)

Place reusable components in `src/components/`. Name them in PascalCase matching their purpose: `TileCard.astro`, `BuyButton.astro`, `BookingWidget.astro`.

### Class naming conventions

Use **BEM-inspired naming**: `block__element--modifier`.

```css
.lab__card              /* block__element */
.lab__thumbnail--placeholder  /* block__element--modifier */
.kiosk-filter           /* block (hyphenated compound) */
.kiosk-tab.is-active    /* state via .is- prefix (JS-toggled) */
```

Rules:

- Block names use lowercase with hyphens: `.menu-section`, `.kiosk-topbar`
- Elements use double underscores: `.lab__card`, `.lab__title`
- Modifiers use double hyphens: `.lab__thumbnail--placeholder`
- State classes use `.is-` prefix: `.is-active`, `.is-visible`
- ARIA-driven states use attribute selectors: `[aria-selected="true"]`, `[aria-pressed="true"]`
- Microformat classes (`.h-card`, `.h-entry`, `.p-name`, `.u-url`) follow IndieWeb conventions — don't rename them

### Accessibility

Accessibility is a design requirement, not an afterthought. Minimums:

- **Landmarks**: Every page has `<header>`, `<main id="main">`, `<footer>`. Use `<nav>` for navigation, `<article>` for self-contained content.
- **Skip link**: `<a href="#main" class="skip-link">Skip to content</a>` as the first child of `<body>`.
- **Alt text**: Descriptive `alt` on meaningful images. Empty `alt=""` on decorative images. Never omit the attribute.
- **Form labels**: Every `<input>` and `<textarea>` has a visible `<label>` with a matching `for` attribute.
- **Focus indicators**: `outline: 2px solid var(--color-primary); outline-offset: 2px` on all interactive elements. Never remove outlines without a visible replacement.
- **Touch targets**: Minimum 44×44px on mobile. Add padding if the element itself is smaller.
- **Color independence**: Never convey information through color alone — pair with text, icons, or patterns.
- **Reduced motion**: Wrap animations in `@media (prefers-reduced-motion: no-preference)`.
- **ARIA**: Use native HTML semantics first. Add `aria-label`, `aria-expanded`, `aria-selected`, `aria-pressed` only when native semantics don't communicate the state.
- **Contrast**: WCAG AA minimum — 4.5:1 for body text, 3:1 for large text (18px+ or 14px+ bold).

### Microformats

Anglesite sites are IndieWeb-first. Use microformat classes on semantic elements:

| Class | Element | Purpose |
|---|---|---|
| `.h-card` | `<header>` | Site/author identity |
| `.p-name` | heading or `<span>` | Name within h-card or h-entry |
| `.u-url` | `<a>` | Canonical URL |
| `.h-entry` | `<article>` | Blog post container |
| `.dt-published` | `<time datetime="">` | Publication date |
| `.p-summary` | `<p>` | Post excerpt |
| `.e-content` | `<div>` | Post body |
| `.p-category` | `<li>` or `<span>` | Tags/categories |
| `.u-syndication` | `<a rel="syndication">` | Cross-posted URLs |

## CSS

### Linting

The template includes [Stylelint](https://stylelint.io/) with [`stylelint-declaration-strict-value`](https://github.com/AndyOGo/stylelint-declaration-strict-value) to enforce design token usage. Run it with:

```sh
npm run lint:css
```

The linter flags raw values for `color`, `background`, `font-size`, `border-radius`, and `box-shadow` that should use `var(--token)` instead. Allowed raw values: `inherit`, `none`, `transparent`, `currentColor`, `auto`, `0`, `#fff`, `#000`, `white`, `black`, `50%`.

To disable the rule for a block with a documented reason (e.g., print styles, semantic color pairs):

```css
/* stylelint-disable scale-unlimited/declaration-strict-value -- reason */
.example { color: #custom; }
/* stylelint-enable scale-unlimited/declaration-strict-value */
```

### Scoped vs. global styles

| Where | When to use |
|---|---|
| `src/styles/global.css` | Design tokens, resets, base element styles, utility classes used across multiple pages (`.post-list`, `.contact-form`, `.btn`) |
| Layout-specific CSS (`menu.css`, `kiosk.css`, `immersive.css`) | Styles that apply only within a specific layout context |
| Scoped `<style>` in `.astro` files | Styles unique to a single component with no reuse potential |

**Default to global.css** for anything used on more than one page. Astro's scoped styles add specificity and can make overrides harder. Use them sparingly.

### Design tokens (CSS custom properties)

All visual values come from custom properties defined in `:root`. The design interview generates `src/design/tokens.css` which overrides the defaults in `global.css`.

**Required tokens** — never use raw values for these:

| Category | Tokens |
|---|---|
| Colors | `--color-primary`, `--color-accent`, `--color-bg`, `--color-text`, `--color-muted`, `--color-surface`, `--color-border` |
| Typography | `--font-heading`, `--font-body`, `--font-size-sm` through `--font-size-4xl` |
| Spacing | `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl` |
| Shape | `--radius-sm`, `--radius-md`, `--radius-lg` |
| Depth | `--shadow-sm`, `--shadow-md` |
| Layout | `--max-width` |

If you need a value that doesn't exist as a token, derive it from existing tokens using `calc()`:

```css
/* Good: derived from tokens */
padding: calc(var(--space-sm) + var(--space-xs));

/* Bad: magic number */
padding: 0.75rem;
```

### Responsive patterns

**Single primary breakpoint**: `@media (min-width: 48rem)` — aligns with `--max-width`.

```css
/* Mobile-first: base styles are mobile */
.card-grid {
  display: grid;
  gap: var(--space-lg);
}

/* Desktop enhancement */
@media (min-width: 48rem) {
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  }
}
```

Rules:

- Always use `min-width` (mobile-first), never `max-width`
- Use `rem` for breakpoint values, not `px`
- Grids should use `auto-fill` with `minmax()` for fluid column counts
- Test that content reads correctly in a single column before adding grid breakpoints

### Print styles

Include print-specific rules in global.css:

- Hide navigation and decorative elements
- Show link URLs inline: `a[href]::after { content: " (" attr(href) ")"; }`
- Remove backgrounds and shadows to save ink

### Theme variants

Dark mode and kiosk mode use `[data-theme]` attribute selectors on `:root`:

```css
:root[data-theme="dark"] {
  --color-bg: #0a0a0a;
  --color-text: #e5e5e5;
}
```

Never use a separate stylesheet for themes — override tokens on the same custom properties so all components adapt automatically.

## TypeScript

### Strict mode

All TypeScript extends `astro/tsconfigs/strict`. This means:

- `strict: true` (includes `noImplicitAny`, `strictNullChecks`, etc.)
- No `any` types without explicit justification
- All function parameters and return types are inferrable or annotated

### Prop typing for Astro components

Define component props using `interface Props` in the frontmatter:

```astro
---
interface Props {
  title: string;
  description: string;
  image?: string;
  href?: string;
}

const { title, description, image, href } = Astro.props;
---
```

Rules:

- Use `interface Props` (not `type Props`) — Astro convention
- Required props have no default. Optional props use `?` and document the default in a comment if non-obvious.
- Use union types for constrained values: `style: 'inline' | 'floating' | 'button'`
- Destructure `Astro.props` in the frontmatter, not in the template

### Content collections and data file patterns

Content lives in `src/content/` with schemas defined in `src/content.config.ts` using Zod:

```typescript
const posts = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.string().transform((str) => new Date(str)),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});
```

Rules:

- Every content collection has a Zod schema — no unvalidated frontmatter
- Keystatic schema (`keystatic.config.ts`) mirrors the Zod schema so the CMS editor stays in sync
- Filter drafts at query time: `getCollection("posts", ({ data }) => !data.draft)`
- Prefer content collections over loose data files in `src/data/` — collections get type-safe querying and Hot Module Replacement

### API routes

API routes (`.ts` files in `src/pages/`) follow Astro conventions:

```typescript
export async function GET(context: APIContext) {
  // ...
}

export async function getStaticPaths() {
  // ...
}
```

- Export named HTTP method handlers (`GET`, `POST`), not default exports
- Use `APIContext` type from Astro for the parameter
- Static routes use `getStaticPaths()` for dynamic segments

## Markdown

### Linting

The template includes [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) for documentation quality. Run it with:

```sh
npm run lint:md
```

### Rules

The config (`.markdownlint.jsonc`) disables rules that conflict with project conventions:

| Disabled rule | Why |
|---|---|
| MD013 (line-length) | Docs use long lines for readability in editors |
| MD024 (no-duplicate-heading) | Same heading text is valid in different sections |
| MD036 (no-emphasis-as-heading) | Bold text as sub-heading is intentional in some docs |
| MD060 (table-column-style) | Compact table pipes are project convention |

All other rules are enforced. Key ones:

- **MD032** — Blank lines around lists (prevents rendering bugs)
- **MD022** — Blank lines around headings
- **MD031** — Blank lines around fenced code blocks
- **MD040** — Fenced code blocks must specify a language (`text` for plain output)
- **MD034** — No bare URLs (use `<url>` or `[text](url)`)
