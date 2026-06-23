---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use vanilla CSS with custom properties for theming

> **This is a default decision.** It can be revisited if it doesn't meet your goals. To change it, tell your Webmaster — they'll update this record, migrate the styles, and mark this ADR as superseded.

## Context and Problem Statement

Each website needs a distinct visual identity derived from the owner's brand. The styling system must allow the Webmaster agent to translate an owner's design preferences (colors, typography, spacing) into a consistent theme, while keeping the output small, maintainable, and free of build-time framework dependencies.

## Decision Drivers

* Owner's brand applied by changing a small set of design tokens, not rewriting stylesheets
* No build-time CSS processing required (no PostCSS, Sass, or Tailwind JIT)
* Output is standard CSS that any developer can read and modify
* Accessible by default — semantic HTML and vanilla CSS enforce good structure
* Smallest possible CSS payload for fast page loads
* Agent can reliably generate and modify styles without framework-specific knowledge

## Considered Options

* Vanilla CSS with custom properties
* Tailwind CSS
* Sass/SCSS
* CSS-in-JS (styled-components, Emotion)

## Decision Outcome

Chosen option: "Vanilla CSS with custom properties", because it allows the entire brand to be expressed through a single set of CSS custom properties in `global.css`, produces the smallest output, requires no build tooling, and generates standard CSS that any developer can work with after handoff.

### Consequences

* Good, because the owner's entire brand lives in ~20 custom properties — changing `--color-primary` updates every element
* Good, because no build step for CSS — what the agent writes is what ships
* Good, because the output is readable, standard CSS that survives any framework migration
* Good, because CSS custom properties cascade naturally, enabling component-level overrides without specificity wars
* Good, because there is no Tailwind config, PostCSS plugins, or CSS-in-JS runtime to misconfigure
* Bad, because no utility classes means more verbose CSS for common patterns like flexbox layouts
* Bad, because the agent must maintain consistent naming conventions without framework enforcement

### Confirmation

The `/anglesite:check` skill verifies that all color pairings meet WCAG AA contrast ratios (4.5:1 for body text, 3:1 for large text). The design system documentation in `docs/design-system.md` defines the canonical set of custom properties.

## Pros and Cons of the Options

### Vanilla CSS with custom properties

* Good, because design tokens are native CSS — no compilation required
* Good, because smallest possible CSS output
* Good, because standard specification, supported in all browsers
* Good, because cascading custom properties enable clean component theming
* Neutral, because requires discipline in naming conventions
* Bad, because more verbose than utility-class frameworks for common patterns

### Tailwind CSS

* Good, because utility classes enable rapid prototyping
* Good, because consistent design tokens via configuration
* Good, because large community and ecosystem
* Bad, because adds a build-time dependency (PostCSS + Tailwind JIT)
* Bad, because HTML becomes cluttered with class names, harder for the agent to reason about semantics
* Bad, because Tailwind config is another file to keep in sync with design tokens
* Bad, because purging unused styles adds build complexity

### Sass/SCSS

* Good, because variables, mixins, and nesting reduce repetition
* Good, because mature tooling
* Bad, because requires a build step (sass compiler)
* Bad, because CSS custom properties now provide variables natively, making Sass variables redundant
* Bad, because nesting can produce overly specific selectors

### CSS-in-JS (styled-components, Emotion)

* Good, because styles colocated with components
* Good, because dynamic theming via JavaScript
* Bad, because requires JavaScript runtime — violates zero-client-JS principle
* Bad, because adds bundle size and rendering overhead
* Bad, because styles are not inspectable in standard CSS tools
* Bad, because fundamentally incompatible with Astro's static-first approach
