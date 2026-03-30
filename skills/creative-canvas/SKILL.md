---
name: creative-canvas
description: "Add interactive visual effects and creative coding to any page"
user-invokable: false
argument-hint: "[effect description or library name]"
allowed-tools: Bash(npm install *), Bash(npm run dev), Bash(npm run build), Write, Read, Glob
---

Add interactive visual effects, generative art, or creative coding experiments to any Anglesite site. Works for all business types — from a bakery wanting holiday snow to a web artist building a full experiment gallery.

## Architecture decisions

- [ADR-0001 Astro](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro-static-site-generator.md) — pages are `.astro` files; client-side code runs via `<script>` tags or Astro component islands
- [ADR-0004 Vanilla CSS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0004-vanilla-css-custom-properties.md) — styling uses CSS custom properties
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — creative libraries are npm-installed and bundled by Astro as first-party code, not loaded from CDNs

## When to invoke this skill

- Owner asks for a visual effect on their site ("add falling snow", "make the background interactive", "particle effect on hover")
- Owner describes a creative/generative art project during `/anglesite:start`
- `BUSINESS_TYPE` includes `web-artist` (full immersive setup)
- The `animate` skill determines the effect needs JavaScript beyond CSS capabilities
- The `new-page` skill is creating an experiment page
- The `seasonal` skill suggests a seasonal visual effect

## Curated library set

Select based on what the owner wants to build:

| Want | Library | npm install | Notes |
|---|---|---|---|
| 2D art, particles, simulations | p5.js | `npm install p5 @types/p5` | Most approachable. Instance mode for Astro compatibility. |
| 3D scenes, WebGL, shaders | Three.js | `npm install three @types/three` | GPU-intensive. Test mobile fallback. |
| Animation, scroll effects, timelines | GSAP | `npm install gsap` | Free for personal/indie. ScrollTrigger plugin included. |
| Audio-reactive, synthesizers | Tone.js | `npm install tone` | Requires user gesture to start AudioContext. |
| Data visualization, charts | D3.js | `npm install d3 @types/d3` | SVG-based. Pairs well with Astro's static HTML. |
| Shaders, GPU compute | Vanilla WebGL | No install needed | Inline `<script>` with GLSL. Most control, steepest learning curve. |
| CSS-only effects | None | No install needed | Delegate to the `animate` skill instead. |

Other npm packages are allowed but don't have tested boilerplate. Install them the same way (`npm install <package>`).

## Adapting to the owner

**Infer skill level from context** — don't ask directly.

- If the owner describes an effect in plain language ("I want snow falling on my homepage") → **generate the code for them**. Write the sketch, embed it, preview it. Iterate based on feedback.
- If the owner names a library or technique ("set up a p5 sketch" / "Three.js scene with orbit controls") → **scaffold boilerplate and let them code**. Provide the setup (canvas, render loop, resize handling) and let them fill in the creative logic.
- If unsure → start by generating, offer to show the code if they want to customize.

## Usage modes

### Mode A: SMB embellishment (any business type)

A targeted visual effect on an existing page. The effect supports the brand, not the other way around.

1. Identify which page and section gets the effect
2. Install the needed library (if not already installed)
3. Create a scoped Astro component (e.g., `src/components/SnowEffect.astro`, `src/components/ParticleHero.astro`)
4. The component contains:
   - A `<canvas>` element (or SVG/div container)
   - A `<script>` tag with the effect code
   - Scoped `<style>` for positioning
   - `prefers-reduced-motion` check — disable or simplify the effect
   - `aria-hidden="true"` on decorative canvases (the effect is decorative, not content)
5. Embed the component in the target page:
   - Behind content: `position: absolute; z-index: -1; pointer-events: none;`
   - As hero background: behind the hero section text
   - On interaction: triggered by form submit, button click, scroll position
6. Keep it lightweight — decorative effects should not slow down the page

**Examples:**
- Bakery: falling snow in December, confetti on order confirmation
- Photographer: subtle parallax depth on gallery images
- Musician: audio-reactive visualizer behind the hero
- Lawyer: satisfying checkmark animation on appointment booking
- Restaurant: gentle steam rising from food hero image

### Mode B: Full immersive setup (web-artist business type)

A complete creative portfolio site where interactive experiments are the product.

1. Read `${CLAUDE_PLUGIN_ROOT}/docs/smb/web-artist.md` for design and structure guidance
2. Install the artist's preferred library or libraries
3. Create the immersive infrastructure:

   **`src/layouts/ImmersiveLayout.astro`** — full-viewport layout for experiments:
   - No header or footer (clean canvas)
   - Dark background (`background: #000; color: #e0e0e0;`)
   - `<main>` fills the viewport (`width: 100vw; height: 100dvh; overflow: hidden;`)
   - `<slot />` for experiment content
   - Info overlay in corner (title, description, back-to-lab link) — toggles on click/tap
   - `prefers-reduced-motion`: show static fallback image + description
   - `<noscript>`: show description + static image
   - SEO: title, description, og:image, canonical URL via props
   - Import `src/styles/immersive.css`

   **`src/pages/lab/index.astro`** — experiment gallery:
   - Uses `BaseLayout` (with navigation)
   - Grid of experiment cards: thumbnail, title, date, tags
   - Dark background variant
   - Links to individual experiment pages under `/lab/<slug>`
   - Reads from `experiments` content collection

   **`src/pages/lab/[slug].astro`** — individual experiment pages:
   - Uses `ImmersiveLayout`
   - Dynamic route from experiments collection
   - Each experiment's client-side code in a `<script>` tag
   - Canvas fills viewport with `ResizeObserver` for responsive sizing

4. Add `experiments` collection to `keystatic.config.ts` and `src/content.config.ts`:
   - Fields: title, description, date, tags, library, thumbnail, draft
   - Slug-based routing
   - Thumbnail stored in `public/images/experiments/`

5. Create the first experiment as a starter template:
   - Use the artist's chosen library
   - Simple but visually interesting (e.g., flowing particles for p5.js, rotating geometry for Three.js)
   - Demonstrates the render loop, resize handling, and reduced-motion patterns

## Accessibility requirements (all modes)

These are non-negotiable:

1. **`prefers-reduced-motion`** — Check `window.matchMedia('(prefers-reduced-motion: reduce)')`. If true:
   - Decorative effects: don't start, or show static version
   - Content experiments: show static screenshot + text description
   - Never auto-play animations that can't be stopped
2. **`<noscript>`** — Every page with required JavaScript shows a fallback:
   - Experiment pages: description + static screenshot
   - Decorative effects: page works fine without them
3. **`aria-label`** on `<canvas>` — Describe what the canvas shows (e.g., `aria-label="Generative particle flow visualization"`)
4. **`aria-hidden="true"`** on purely decorative canvases — Screen readers skip decorative effects
5. **No flashing/strobing** — WCAG 2.3.1. No content flashes more than 3 times per second
6. **Keyboard navigation** — If the experiment is interactive, ensure keyboard controls work. Document controls in the info overlay.

## p5.js boilerplate (instance mode for Astro)

```javascript
import p5 from 'p5';

const sketch = (p) => {
  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent('canvas-container');
    canvas.elt.setAttribute('aria-label', 'DESCRIPTION HERE');
  };

  p.draw = () => {
    // Creative code here
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
  };
};

// Respect reduced motion
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!prefersReducedMotion) {
  new p5(sketch);
}
```

## Three.js boilerplate

```javascript
import * as THREE from 'three';

const canvas = document.getElementById('canvas');
canvas.setAttribute('aria-label', 'DESCRIPTION HERE');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// Creative code here

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate() {
  if (prefersReducedMotion) return;
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

## Integration with other skills

| Skill | How it connects |
|---|---|
| **start** | For `web-artist` type, invoke this skill for full immersive setup. For other types, this skill is available on demand. |
| **new-page** | When creating an experiment page, delegates to this skill for the creative code setup. |
| **animate** | CSS-only effects stay in `animate`. When an effect needs JS, `animate` suggests this skill. |
| **seasonal** | Seasonal visual effects (snow, leaves, confetti) invoke this skill with a specific effect description. |
| **og-images** | Experiment pages use artist-provided screenshots as OG images. Remind the artist to add thumbnails. |
| **check** | Validates canvas accessibility: `aria-label`/`aria-hidden`, reduced-motion fallback, `<noscript>` presence. |
| **deploy** | Standard security scans apply. Bundled npm libraries pass CSP (`script-src 'self'`). |
| **design-interview** | For web-artist sites: dark theme default, monospace typography, portfolio-first layout. |
