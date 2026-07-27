# Animations

This site template ships [`@astroanimate/core`](https://www.astroanimate.com) `0.1.2` as a
default dependency (`Resources/Template/package.json`) — every new site has it installed with no
extra step. It is a CSS-first, Astro-native animated component library: components render
meaningful content with zero client JS by default, and respect
`prefers-reduced-motion` automatically.

## CSS-only policy

Every component below supports an `enhance` prop that opts into an IntersectionObserver-based
JS enhancement path. **Never set `enhance={true}` (or `enhance="true"`) on a component in this
site.** The library's `enhance` mode emits inline `<script>` tags, and this site's Content
Security Policy has no `'unsafe-inline'` and no script hashes — an inline script from
`enhance={true}` is blocked in production and will silently do nothing. CSS-only usage
(`enhance` left unset, which defaults to `false` on every component below except
`CardStack`, where it must be passed explicitly as `enhance={false}`) is the supported and
tested mode.

## Import style

Import each component from its own export path, not the package root:

```astro
---
import FadeInText from "@astroanimate/core/FadeInText";
---
```

## Curated components

Only the components listed below have been vetted for this site: each renders under Astro 7,
respects `prefers-reduced-motion`, has meaningful content without JS, and emits zero
`<script>` tags with the props shown here. The full `@astroanimate/core` package has more
components than this — the rest are not curated for this site and are not guaranteed to be
CSP-safe.

**Text**

## FadeInText

Text that fades in with a soft blur when the page loads.

| Prop | Notes |
| --- | --- |
| `duration` | seconds (default 0.6) |
| `delay` | seconds (default 0) |
| `as` | wrapper tag, e.g. "h1" |

```astro
---
import FadeInText from "@astroanimate/core/FadeInText";
---
<FadeInText as="h1">Welcome</FadeInText>
```

## ScaleIn

Text or content that grows into place from a slightly smaller size.

| Prop | Notes |
| --- | --- |
| `initialScale` | starting scale (default 0.9) |
| `duration` | milliseconds (default 600) |
| `as` | wrapper tag, e.g. "h2" |

```astro
---
import ScaleIn from "@astroanimate/core/ScaleIn";
---
<ScaleIn as="h2">Grows into place</ScaleIn>
```

## RevealImage

A headline where the letters reveal a background image as you scroll past.

| Prop | Notes |
| --- | --- |
| `text` | overlay text (required) |
| `image1` | first image URL (required) |
| `image2` | second image URL (required) |

```astro
---
import RevealImage from "@astroanimate/core/RevealImage";
---
<RevealImage text="REVEAL" image1="/images/before.jpg" image2="/images/after.jpg" />
```

## HighlightText

A highlighter-style underline or background sweep behind a phrase.

| Prop | Notes |
| --- | --- |
| `variant` | "underline" | "background" (default "background") |
| `color` | highlight color (default "#FFD700") |
| `trigger` | "load" | "hover" (default "load") |

```astro
---
import HighlightText from "@astroanimate/core/HighlightText";
---
<p>This is <HighlightText>important</HighlightText> text.</p>
```

## TypewriterText

A line of text that types itself out, one character at a time.

| Prop | Notes |
| --- | --- |
| `texts` | array of strings to cycle through (required) |
| `showCursor` | boolean (default true) |
| `cursor` | cursor character (default "|") |

```astro
---
import TypewriterText from "@astroanimate/core/TypewriterText";
---
<TypewriterText texts={["Design.", "Build.", "Ship."]} />
```

**Cards**

## AnimatedCard

A card that lifts, scales, or shines on hover.

| Prop | Notes |
| --- | --- |
| `title` | card title (required) |
| `description` | card description (required) |
| `variant` | "lift" | "scale" | "flip" | "shine" (default "lift") |

```astro
---
import AnimatedCard from "@astroanimate/core/AnimatedCard";
---
<AnimatedCard title="Feature" description="A short description of the feature." />
```

## CardStack

A stack of testimonial or feature cards, one in front of the other.

| Prop | Notes |
| --- | --- |
| `cards` | array of { title, content } cards (required) |
| `stackSize` | visible cards (default 3) |
| `enhance` | keep false — CSS-only mode (site CSP blocks enhance=true) |

```astro
---
import CardStack from "@astroanimate/core/CardStack";
---
<CardStack
  enhance={false}
  cards={[
    { title: "Alex", content: "Loved the onboarding flow." },
    { title: "Sam", content: "Setup took five minutes." },
  ]}
/>
```

## ArticleCard

A blog-post or article preview card with a title, summary, and link.

| Prop | Notes |
| --- | --- |
| `title` | article title (required) |
| `description` | summary text (required) |
| `href` | link target (default "#") |

```astro
---
import ArticleCard from "@astroanimate/core/ArticleCard";
---
<ArticleCard title="Article title" description="A short summary of the article." href="/blog/post" />
```

**Buttons**

## AnimatedButton

A button with a shimmer, fill, or border sweep on hover.

| Prop | Notes |
| --- | --- |
| `variant` | "shimmer" | "fill" | "border" | "none" (default "none") |
| `href` | renders as a link when set |
| `disabled` | boolean (default false) |

```astro
---
import AnimatedButton from "@astroanimate/core/AnimatedButton";
---
<AnimatedButton variant="shimmer">Get started</AnimatedButton>
```

## FillHoverButton

A button whose background fills in from one edge on hover.

| Prop | Notes |
| --- | --- |
| `as` | "button" | "a" (default "button") |
| `href` | link target when as="a" |

```astro
---
import FillHoverButton from "@astroanimate/core/FillHoverButton";
---
<FillHoverButton>Subscribe</FillHoverButton>
```

## ArrowCTAButton

A call-to-action link whose arrow slides forward on hover.

| Prop | Notes |
| --- | --- |
| `label` | button text (required) |
| `as` | "button" | "a" (default "button") |
| `href` | link target when as="a" |

```astro
---
import ArrowCTAButton from "@astroanimate/core/ArrowCTAButton";
---
<ArrowCTAButton label="Learn more" href="/about" as="a" />
```

## SlidingOverlayButton

A button with a color overlay that slides in on hover.

| Prop | Notes |
| --- | --- |
| `as` | "button" | "a" (default "button") |
| `href` | link target when as="a" |

```astro
---
import SlidingOverlayButton from "@astroanimate/core/SlidingOverlayButton";
---
<SlidingOverlayButton>Contact us</SlidingOverlayButton>
```

**Backgrounds**

## GridDotsBackground

A subtle dot-grid or line-grid backdrop for a section.

| Prop | Notes |
| --- | --- |
| `variant` | "dots" | "grid" (default "dots") |
| `dotColor` | CSS color (default "rgba(255,255,255,0.25)") |
| `height` | CSS height (default "300px") |

```astro
---
import GridDotsBackground from "@astroanimate/core/GridDotsBackground";
---
<GridDotsBackground variant="grid" height="200px" />
```

## InfiniteMarquee

A row of logos, text, or cards that scrolls continuously and loops.

| Prop | Notes |
| --- | --- |
| `direction` | "left" | "right" | "up" | "down" (default "left") |
| `speed` | CSS duration (default "30s") |
| `pauseOnHover` | boolean (default true) |

```astro
---
import InfiniteMarquee from "@astroanimate/core/InfiniteMarquee";
---
<InfiniteMarquee>
  <span>Trusted by teams everywhere</span>
</InfiniteMarquee>
```

**Navigation**

## Loader

A spinning, dotted, or pulsing loading indicator.

| Prop | Notes |
| --- | --- |
| `type` | "spinner" | "dots" | "pulse" (default "spinner") |
| `size` | pixels (default 40) |
| `color` | CSS color (default "#3b82f6") |

```astro
---
import Loader from "@astroanimate/core/Loader";
---
<Loader type="dots" />
```

## ProgressBar

A labeled progress bar that fills to a given value.

| Prop | Notes |
| --- | --- |
| `value` | current value 0-max (required) |
| `max` | maximum value (default 100) |
| `label` | optional label text |

```astro
---
import ProgressBar from "@astroanimate/core/ProgressBar";
---
<ProgressBar value={60} label="Upload progress" />
```

