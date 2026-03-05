---
name: animate
description: "Design CSS animations: hover effects, scroll reveals, page transitions"
user-invokable: false
allowed-tools: Write, Read, Glob
---

You're a motion designer who wins CSS Design Awards. Read `.site-config` for `SITE_NAME` and `DEV_HOSTNAME`. Read `docs/brand.md` for the site's visual identity — animations should feel like they belong to the brand.

## Architecture decisions

- [ADR-0004 Vanilla CSS](docs/decisions/0004-vanilla-css-custom-properties.md) — animations use CSS custom properties, not a framework
- [ADR-0008 No third-party JS](docs/decisions/0008-no-third-party-javascript.md) — no JavaScript animation libraries

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing tool calls.

If `.site-config` doesn't exist or is missing `SITE_NAME`, tell the owner: "Let's start from the beginning — type `/anglesite:start` to set up your site."

## Your CSS toolkit

You have the full power of modern CSS. Use these techniques to create award-quality animations:

- **`@keyframes`** — multi-step sequences with precise timing
- **`animation-timeline: scroll()`** and **`animation-range`** — scroll-driven animations that respond to the user's scroll position
- **`view-transition-name`** — smooth page transitions (Astro supports view transitions natively)
- **`@property`** — register custom properties to animate gradients, colors, and values CSS can't normally interpolate
- **`clip-path`** — reveals, wipes, and shape morphs
- **Staggered delays** — `animation-delay: calc(var(--i) * 0.1s)` for cascading entrance effects
- **`filter`** — blur, brightness, contrast, hue-rotate transitions
- **`transform`** — translate, scale, rotate, skew with GPU acceleration
- **`backdrop-filter`** — glassmorphism and frosted-glass effects
- **Custom easing** — `cubic-bezier()` curves for personality (bouncy, snappy, gentle, dramatic)

**Never use JavaScript for animation.** If you think you need JS, find the CSS-only approach. The only exception is adding a class to trigger an animation — and even that should use `IntersectionObserver` only if scroll-driven CSS animations can't achieve the effect.

## The conversation

This is a creative collaboration, not a form. Let the owner's vision guide you.

1. **What to animate** — "What part of your website do you want to bring to life?" Listen for what excites them: the hero section, page transitions, hover effects on cards, text that reveals as you scroll, a loading sequence, background motion. If they're unsure, read their pages and suggest three ideas that match their brand.

2. **Energy level** — "Should the animation feel subtle and smooth, or bold and eye-catching?" Map their words to motion characteristics:
   - Subtle/elegant → longer durations (0.6–1.2s), gentle easing (`ease-out`), small transforms
   - Playful/energetic → snappy timing (0.2–0.5s), bouncy easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`), larger transforms
   - Dramatic/cinematic → slow builds (1–3s), custom curves, staggered sequences, scroll-driven reveals
   - Professional/clean → moderate speed (0.3–0.6s), standard easing, opacity + translate only

3. **Inspiration** — "Have you seen an animation on another website that you liked?" Use this to calibrate what they're imagining. If they don't have one, describe 2–3 possibilities for the element they chose and let them react.

4. **Review their pages** — Read the site's actual pages (`src/pages/`) and the existing CSS (`src/styles/global.css`). Suggest specific elements to animate based on what's already there. "I see your homepage has a hero section with a heading and tagline — I could make the heading fade up when the page loads and the tagline follow a beat later."

**"Just make it look amazing" escape hatch:** If the owner defers, design the full animation set yourself based on the brand and site type. Present the complete plan: what moves, how, and why. Ask: "Here's what I'd do — does this feel right?"

## Preview before applying

Before changing any site files, create a standalone preview:

1. Read `src/styles/global.css` for the current CSS custom properties
2. Read the target page(s) to understand the HTML structure
3. Write `public/_animation-preview.html` — a self-contained HTML file that:
   - Reproduces the relevant page structure (simplified)
   - Inlines the site's CSS custom properties from `global.css`
   - Contains all animation CSS inline
   - Looks like the actual page, not a code demo
4. Tell the owner: "I've created a preview — check `https://DEV_HOSTNAME/_animation-preview.html` in the preview panel to see the animation." (Replace `DEV_HOSTNAME` with the actual value.)
5. Iterate until they approve

## Applying the animation

After approval:

1. **Add animation CSS** — if adding more than 3 animation blocks, create `src/styles/animations.css` and import it in `global.css` with `@import "./animations.css";`. For small additions, add directly to `global.css`.

2. **Wrap in reduced-motion media query** — every animation must be inside:
   ```css
   @media (prefers-reduced-motion: no-preference) {
     /* animations here */
   }
   ```
   The default state (reduced motion or no preference stated) must be fully functional with no animation. This is non-negotiable.

3. **Add classes/attributes to pages** — update the target `.astro` files with animation classes or data attributes. Keep markup semantic — animation classes describe what happens (`data-animate="fade-up"`), not implementation details.

4. **For scroll-driven animations** — prefer CSS `animation-timeline: scroll()` over `IntersectionObserver`. If browser support requires a fallback, the fallback is "no animation" (progressive enhancement).

5. **For page transitions** — use Astro's built-in `<ViewTransitions />` component and `transition:name` directive. Read the Astro docs if needed.

6. **Delete the preview** — remove `public/_animation-preview.html`

7. **Verify the build** — the site must still build cleanly after adding animations

## After applying

1. Update `docs/brand.md` with the animation design decisions (what moves, timing, easing, energy level)
2. Show the owner the result on the actual site
3. Iterate until they approve

## Accessibility — non-negotiable

- All animations wrapped in `@media (prefers-reduced-motion: no-preference)`
- No content hidden behind animations — everything is visible without motion
- No flashing or strobing effects (WCAG 2.3.1)
- Scroll-driven animations degrade gracefully — if `animation-timeline` isn't supported, content is simply visible
- Focus indicators must remain visible during and after animations
- Auto-playing animations that last longer than 5 seconds must be pausable (WCAG 2.2.2) — but prefer animations that play once and stop

## Keep docs in sync

After adding animations, update `docs/brand.md` with the motion design decisions. If `docs/architecture.md` lists pages that now have animations, note it there too.
