# Scalable Page Template Tests

## Problem

The current `test/menu-pages.test.js` has 57 tests that assert structural properties of the menu pages by string-matching the `.astro` source. This approach doesn't scale: every new page type (services, events, gallery, products, FAQ) would need its own ~50-test file with largely duplicated assertions.

## Design

Replace bespoke per-page string tests with three layers:

### Layer 1: `test/page-contracts.test.js` — Universal page rules

Auto-discovers all `template/src/pages/**/*.astro` files and verifies each one satisfies:

- **Imports BaseLayout** — every page must use the shared layout (currently true for all 18 pages)
- **Has a title prop** — every page must pass `title=` to BaseLayout
- **No hardcoded site name** — pages should not contain literal "My Website" or similar

These are the only truly universal invariants. Things like `aria-labelledby`, `jsonLd`, and semantic elements are page-specific and belong in targeted tests.

**Exclusions:** None. Every `.astro` page file is tested. The glob-based discovery means new pages are automatically covered.

### Layer 2: `test/css-contracts.test.js` — Shared CSS quality checks

Auto-discovers all `template/src/styles/*.css` files and verifies each one satisfies:

- **Uses CSS custom properties** — at least one `var(--` reference (no hardcoded design tokens)
- **No `!important` outside print/a11y media queries** — prevents specificity wars
- **No hardcoded colors in non-badge rules** — colors should use `var(--color-*)` or `var(--menu-color-*)` tokens (exception: dietary badge color definitions and print styles, which legitimately set specific colors)

The existing `test/css-a11y.test.js` already covers global.css-specific a11y checks (reduced-motion, focus-visible, outline preservation). This new file covers structural quality across ALL stylesheets.

**Not checked universally** (because not all stylesheets need them):
- Print styles (only global.css and menu.css have them currently)
- `focus-visible` (component-level stylesheets may not have interactive elements)

### Layer 3: `test/menu-pages.test.js` — Menu-specific behavior (slimmed)

Retains only tests that are genuinely specific to the menu feature:

**Schema.org (~8 tests):**
- Diet URL mapping (VegetarianDiet, VeganDiet, etc.)
- `@graph` wrapping for multiple menus
- Conditional price/Offer inclusion
- Menu/MenuSection/MenuItem type hierarchy

**Conditional rendering (~8 tests):**
- Empty state ("coming soon") when no menus
- Menu selector only for multiple menus
- Jump nav only for multiple sections
- Menu name as h2 only for multiple menus
- Conditional description/price/image/dietary rendering
- Back link on `[slug].astro`

**Menu-specific accessibility (~4 tests):**
- `aria-label` on menu-selector and menu-nav
- `aria-labelledby` + matching heading IDs on sections
- `aria-current="page"` on active menu link
- Dietary badges have `aria-label`

**Total: ~20 tests** (down from 57), all testing behavior unique to the menu feature.

### What moves where

| Original test | Destination |
|---|---|
| "imports BaseLayout" | `page-contracts.test.js` (universal) |
| "imports menu.css" | Removed (implementation detail) |
| "fetches all three collections" | Removed (Astro would fail to build without them) |
| "passes jsonLd to BaseLayout" | Removed (covered by Schema.org tests verifying the LD object exists) |
| "filters to available items" | `menu-pages.test.js` (menu-specific) |
| "sorts by order field" | Removed (sorting is an implementation detail) |
| "uses prerender and getStaticPaths" | Removed (Astro build would catch this) |
| Schema.org tests | `menu-pages.test.js` (menu-specific) |
| Accessibility tests | Split: menu-specific stay, universal patterns move to page-contracts |
| CSS tests | `css-contracts.test.js` (universal) |
| Conditional rendering | `menu-pages.test.js` (menu-specific) |

### What gets deleted entirely

Tests that verify things the build system already catches:
- "imports menu.css" — a missing import would break the build
- "fetches all three collections" — ditto
- "uses prerender and getStaticPaths" — ditto
- "sorts by order field" — implementation detail, not a contract

Tests that are redundant with other tests:
- "passes jsonLd to BaseLayout" — if the Schema.org object is well-formed (tested), and the build succeeds (verified), the prop is passed
- CSS design token and responsive tests — move to universal css-contracts

## File inventory

| File | Action | Tests |
|---|---|---|
| `test/page-contracts.test.js` | Create | ~3 per page, auto-discovered |
| `test/css-contracts.test.js` | Create | ~3 per stylesheet, auto-discovered |
| `test/menu-pages.test.js` | Rewrite | ~20 menu-specific tests |
| `test/css-a11y.test.js` | Keep as-is | 5 tests (global.css-specific a11y) |
| `test/base-layout.test.js` | Keep as-is | 5 tests (layout-specific) |

## Success criteria

- All existing test files pass
- New pages added in the future are automatically covered by page-contracts
- New CSS files added in the future are automatically covered by css-contracts
- Adding a new page type (e.g., services page) requires zero new test files for universal contracts
