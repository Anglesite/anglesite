# Web Artist & Creative Coder

Covers: generative artists, creative coders, interactive web designers, data visualization artists, WebGL/shader artists, audio-visual performers, net artists, digital installation artists. See also [artist.md](artist.md) for traditional visual artists, [musician.md](musician.md) for audio-focused creators, and [video-creator.md](video-creator.md) for video-focused creators.

## Pages

- **Lab / experiments** — The core of the site. A gallery of interactive pieces, each linking to its own full-viewport page. Organize by technique, library, theme, or chronology. Each piece gets a title, date, tags, and optional write-up.
- **About / artist statement** — Who they are, what drives their creative practice, tools and techniques. Link to social profiles (GitHub, OpenProcessing, Shadertoy, personal Mastodon/Bluesky).
- **Process blog** — "How I made this" write-ups that pair with experiments. Technique breakdowns, algorithm explanations, creative process documentation. Great for search traffic and creative coding community engagement.
- **Links** — Curated links page: social profiles, creative coding communities, tools used, inspirations. Replaces link-in-bio services.
- **Commissions / collaborations** — If they take creative commissions (installations, event visuals, brand collaborations). Process walkthrough, past client work, contact form.
- **Contact** — Email, social links, collaboration inquiry form.

## Design

**Visual mood:** The work IS the design. The site frame should be invisible — dark, minimal, receding. When an experiment is running, nothing competes with it. The lab index is a curated gallery that showcases screenshots, not text.

**Color direction:** Dark mode by default. Background `#000` or very dark gray (`#0a0a0a`). Text in light gray (`#e0e0e0`), not pure white (reduces eye strain). Accent color drawn from the artist's most common palette or a single high-contrast hue. The art provides all the color.

**Typography feel:** Monospace stack (`ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace`) for both heading and body. Light to medium weight (300–400). Code-native feel that signals technical craft. Alternatively, minimal sans-serif system stack if the artist prefers a cleaner look.

**Layout emphasis:** Lab/experiments gallery is the core. Home page opens with the strongest pieces — a grid of thumbnails or a featured experiment running live. Minimal text above the fold. Each experiment page is full-viewport with no header/footer chrome. Use `ImmersiveLayout` for experiment pages, `BaseLayout` for everything else. Max-width 64rem for text pages, full viewport for experiments.

**Photography style:** Screenshots of experiments, captured at the most visually striking moment. Consistent aspect ratio (16:9 for landscape, 1:1 for square compositions). Dark backgrounds in thumbnails maintain visual cohesion in the gallery grid.

**Key component:** Experiment gallery grid — uniform or masonry grid of experiment thumbnails. Click to enter the full experience. Filter by technique/library/tag if the body of work is large (10+ pieces). Minimal captions — title and date only.

## Tools

Web artists write code — the tools are creative coding libraries, not SaaS products:

- **p5.js** (free, open source) — 2D generative art, particles, simulations. The most approachable creative coding library. p5js.org
- **Three.js** (free, open source) — 3D/WebGL scenes, shaders, 3D geometry. For anything spatial. threejs.org
- **GSAP** (free for non-commercial, open source core) — Timeline-based animation, scroll-triggered effects, complex motion sequences. gsap.com
- **Tone.js** (free, open source) — Web Audio API framework for audio-reactive visuals, synthesizers, musical experiments. tonejs.github.io
- **D3.js** (free, open source) — Data-driven visualizations, force-directed graphs, geographic maps. d3js.org
- **Vanilla Canvas/WebGL** — Raw `<canvas>` API or WebGL for maximum control. No library overhead.
- **CSS-only** — Pure CSS art, animations, and effects. No JavaScript required. Impressive technical constraint.

These are installed via `npm` and bundled by Astro — they're served as first-party JavaScript, not loaded from external CDNs. No CSP issues.

### Sharing platforms

Web artists share work differently than traditional businesses:

- **r/internetisbeautiful** — Subreddit for creative, well-designed websites. Self-posts allowed but must be genuinely interesting, not self-promotional. Title should describe the experience, not the creator.
- **Hacker News (Show HN)** — Technical audience appreciates craft. "Show HN: [descriptive title]" format. Link directly to the experiment, not the lab page.
- **OpenProcessing** — Creative coding community for p5.js/Processing sketches. Cross-link between site and OpenProcessing profile.
- **Shadertoy** — Shader art community. Link shader experiments on the site back to Shadertoy versions.
- **Creative coding communities** — Genuary (January generative art challenge), #creativecoding on Mastodon/Bluesky, Processing Community Day.
- **GitHub** — Source code for experiments. Link from experiment pages to source repos.

## Review platforms

Traditional review platforms don't apply to web artists. Reputation is built through:

- **GitHub stars** — Open source experiments build credibility in the creative coding community.
- **Community engagement** — Participation in creative coding events (Genuary, Processing Community Day, shader jams).
- **Portfolio/lab itself** — The work speaks. A well-curated lab page IS the reputation.
- **Social proof** — Retweets, reposts, comments on social platforms. Feature in creative coding newsletters or blogs.

## Compliance

- **Copyright**: The artist owns their creative code by default. Consider open-sourcing experiments (MIT license is common in creative coding). Display copyright notice or license on the site.
- **Accessibility**: Interactive experiments must have `<noscript>` fallbacks, `aria-label` on `<canvas>` elements, and `prefers-reduced-motion` alternatives. Not all experiences can be fully accessible, but the site itself must be navigable without JavaScript.
- **Performance**: WebGL and canvas experiments can be GPU-intensive. Test on mobile devices and provide graceful degradation (static screenshot, lower resolution, or "best viewed on desktop" message).
- **Third-party code**: If using open-source libraries, respect their licenses. Attribution in a humans.txt or credits page.

## Content ideas

Process write-ups for each experiment, creative coding tutorials, algorithm breakdowns (noise, flow fields, particle systems, ray marching), "making of" posts, technique comparisons, tool reviews, creative constraint challenges (CSS-only, 1KB, no-library), collaboration announcements, event recaps (Genuary, shader jams), behind-the-scenes of installations, reading lists and inspiration sources.

## Key dates

- **Genuary** (Jan 1–31) — Month-long generative art challenge. Daily prompts. Great for building a body of work and community engagement.
- **Processing Community Day** (varies, usually Feb or Oct) — Workshops, talks, exhibitions for the Processing/p5.js community.
- **Shader Jam / Live coding events** (various) — Real-time creative coding performances and competitions.
- **Demoscene events** (various) — Revision, Assembly, and other demo parties for real-time graphics.
- **Ars Electronica** (Sep) — Festival for art, technology, and society. Linz, Austria.

## Structured data

Use `CreativeWork` or `VisualArtwork` with:
- `name`, `description`, `url`, `dateCreated`
- `encodingFormat: "text/html"` (the work is a web page)
- `interactivityType: "active"` (user interaction required)
- `creator` with `Person` type linking to about page
- `artMedium` — "JavaScript", "WebGL", "CSS", "p5.js", etc.
- `genre` — "Generative Art", "Data Visualization", "Interactive Installation", etc.

For the lab/experiments index, use `CollectionPage` with `hasPart` linking to individual experiment pages.

## Data tracking

- **Experiments:** Title, Description, Date Created, Library/Technique, Tags, Status (Live/Draft/Archived), Thumbnail, Source URL (GitHub), Process Write-up (linked blog post)
- **Events:** Name, Type (Genuary/Jam/Exhibition/Talk), Date, Platform/Venue, Submissions, Notes
- **Collaborations:** Partner, Project, Date, URL, Status, Notes
