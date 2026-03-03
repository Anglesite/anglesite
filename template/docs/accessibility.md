# Accessibility in Practice

Practical guidance for keeping the site accessible as the owner adds content over time. Reference for the webmaster agent — read during `/anglesite:design-interview`, content creation, and `/anglesite:check`. Not user-facing documentation.

For the legal requirement and accessibility statement, see `docs/smb/legal-checklist.md`. For automated testing, see the `/anglesite:check` skill. This file covers the *why* and *how* of accessible content — the things that can't be caught by a linter alone.

## Who this is for

Accessibility isn't about edge cases. In any given community:

- **1 in 4 US adults** has a disability (CDC)
- **8% of men** have some form of color vision deficiency
- **Aging population** — vision, hearing, and motor skills decline. A site that works for a 70-year-old works for everyone.
- **Temporary disabilities** — broken arm, eye surgery, ear infection, migraine. Anyone can become temporarily disabled.
- **Situational limitations** — bright sunlight (low contrast is invisible), noisy environment (audio is useless), one hand occupied (can't use a mouse)

When the owner asks "do I really need this?" — yes. Their customers include all of these people.

## What the scaffold already handles

These are built into the site template. Don't undo them:

- Skip-to-content link in the layout
- Semantic HTML (`<nav>`, `<main>`, `<article>`, `<footer>`)
- Logical heading hierarchy enforced by `/anglesite:check`
- Color contrast meeting WCAG AA (4.5:1 for body text, 3:1 for large text)
- `lang` attribute on `<html>`
- Viewport meta tag (no `user-scalable=no` — never prevent zooming)
- Focus styles on interactive elements
- Form labels associated with inputs
- No images of text

## What breaks when the owner adds content

The scaffold starts accessible, but content changes can break it. These are the common problems:

### Images without alt text

Every image needs alt text. Keystatic prompts for it, but the owner may skip it or write something unhelpful.

**Good alt text:**
- Describes what's in the image, not what it "is"
- "A golden retriever puppy sitting on a red blanket" — not "dog" or "image1" or "cute puppy photo"
- For product photos: "Hand-thrown ceramic mug with blue glaze, 12oz" — specific, useful
- For decorative images (borders, spacers, background textures): empty alt (`alt=""`) — screen readers skip them

**Bad alt text:**
- `alt="image"` or `alt="photo"` — says nothing
- `alt="DSC_0234.jpg"` — filename, not description
- `alt="best plumber in springfield call now"` — keyword stuffing, not a description
- Missing entirely — screen reader says the filename, which is worse than nothing

**During `/anglesite:design-interview`:** When the owner provides photos, write the alt text for them. Don't ask "what should the alt text be?" — write a good description and confirm. Most people don't know what alt text is.

### Color contrast

The scaffold's CSS custom properties define colors that meet contrast requirements. Problems arise when:

- The owner requests a brand color that doesn't meet 4.5:1 contrast (common with light greens, yellows, light blues on white)
- Text is placed over images without a background overlay
- Link colors are too close to body text color (links need to be distinguishable)

**During `/anglesite:design-interview`:** If the owner's brand colors don't meet contrast, explain: "That green looks great, but it's hard to read against a white background — especially for people with low vision. I'll darken it slightly so everyone can read it." Use a contrast checker: https://webaim.org/resources/contrastchecker/

**Never compromise on contrast.** An inaccessible color scheme excludes customers. There is always a nearby shade that both meets contrast and satisfies the brand.

### Heading structure

The scaffold's page templates have correct heading hierarchy. Problems arise when:

- Blog posts skip heading levels (h1 → h3, missing h2)
- The owner uses headings for visual sizing ("I want this text bigger") instead of document structure
- Multiple h1 tags on a page

**During content creation:** If the owner writes a blog post with broken heading hierarchy, fix it. Explain briefly: "Headings create an outline of the page — screen readers use them to navigate. I've fixed the heading levels so they go in order."

### Links

- **Link text should describe the destination.** "Read our cancellation policy" — not "click here" or "learn more." Screen reader users navigate by link text; a page full of "click here" links is unusable.
- **Don't use URLs as link text.** "Visit our Etsy shop" not "https://www.etsy.com/shop/businessname." URLs are unreadable when spoken aloud.
- **Links should be visually distinct.** Underlined or colored differently from body text. Don't rely on color alone — colorblind users can't distinguish color-only links.
- **External links don't need `target="_blank"`.** Opening new tabs is disorienting, especially for screen reader users. If the owner insists, add `rel="noopener"` (security) and note the tradeoff.

### Forms

Contact forms, mailing list signups, booking forms:

- Every input needs a visible `<label>` — not just placeholder text (placeholders disappear when you start typing)
- Error messages should be specific: "Please enter a valid email address" not "Invalid input"
- Required fields should be marked (asterisk is fine, but also add `aria-required="true"`)
- Form submission feedback must be visible and announced to screen readers (success message, error summary)
- Don't use CAPTCHAs that require vision (image CAPTCHAs exclude blind users). Cloudflare Turnstile is accessible. See `docs/security.md`.

### Video and audio

If the owner adds video or audio content:

- **Captions for video** — Required for deaf and hard-of-hearing viewers. YouTube auto-generates captions (review them for accuracy). For self-hosted video, provide a `.vtt` caption file.
- **Transcripts for audio** — Required for deaf users and beneficial for everyone (search engines can't listen to audio). Every podcast episode embedded on the site should have a transcript. See `docs/smb/creator.md`.
- **No autoplay** — Video or audio that plays automatically is disorienting and unwelcome. Always require user interaction to start media.
- **Audio descriptions for video** — If a video communicates important visual information (demonstrations, product details), provide a text description or narrate the visual content. Not always necessary for talking-head videos.

### PDFs

PDFs are often inaccessible — no heading structure, no alt text, images of text. If the owner wants to link to a PDF (menu, price list, brochure):

- **Prefer HTML pages over PDFs.** A web page is always more accessible than a PDF.
- **If a PDF is necessary:** ensure it has proper heading structure, alt text on images, and is not just a scanned image. Adobe Acrobat can check PDF accessibility.
- **Always provide the key information on the website too.** Don't make the PDF the only way to get information. The menu should be on the website *and* downloadable as a PDF if the owner wants.

## Testing accessibility

### What `/anglesite:check` does automatically

- `pa11y` scans for WCAG 2.1 AA violations (contrast, alt text, ARIA, headings, labels)
- Manual checklist in `/anglesite:check` covers heading hierarchy, skip link, keyboard navigation, images of text, lang attribute

### What the agent should test manually

After any design change or new page:

1. **Keyboard navigation** — Tab through the entire page. Can you reach every link, button, and form input? Is the focus order logical? Can you tell where you are (focus indicator visible)?
2. **Screen reader spot check** — On macOS, turn on VoiceOver (Cmd+F5) and navigate the page. Do headings make sense? Are images described? Are links clear? Does the form work?
3. **Zoom test** — Zoom to 200% in the browser. Does the layout still work? Is any text cut off or overlapping?
4. **Motion sensitivity** — Are there animations? Do they respect `prefers-reduced-motion`? The scaffold's CSS should include `@media (prefers-reduced-motion: reduce)` to disable non-essential animations.

### What to tell the owner

Keep it simple. During `/anglesite:design-interview` or when delivering the site:

"Your website is built to be usable by everyone — including people who use screen readers, can't see colors well, or navigate with a keyboard instead of a mouse. When you add new content, the main thing to remember is: give every image a description of what's in it. I'll handle the rest."
