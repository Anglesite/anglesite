---
name: share
description: "Add native sharing to pages and blog posts via the Web Share API"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(npm run build), Write, Read, Glob, Edit
metadata:
  author: "David W. Keith"
  version: "1.5.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Add a share button that uses the Web Share API on supporting browsers (mobile Safari, Chrome, Edge) and falls back to copy-to-clipboard on desktop. No third-party share widgets, no social media SDK embeds, no tracking pixels — just the platform's native share sheet.

## Architecture decisions

- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — The Web Share API is a browser built-in. No AddThis, ShareThis, or social button libraries. Zero external requests.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.site-config` for `SHARE_ENABLED`. If it's already `true`, tell the owner: "Share buttons are already set up. Would you like to change where they appear, update the style, or remove them?" Then adjust as needed.

## Step 1 — Determine placement

Ask the owner:

> "Where should the share button appear?
>
> 1. **Blog posts only** — at the end of each post
> 2. **All pages** — in the footer of every page
> 3. **Specific pages** — you tell me which ones"

Option 1 is the most common choice. For blogs, the share button naturally follows the content.

## Step 2 — Create the ShareButton component

Create `src/components/ShareButton.astro`:

```astro
---
interface Props {
  title: string;
  text?: string;
  url?: string;
}

const { title, text, url } = Astro.props;
const shareUrl = url ?? Astro.url.pathname;
---

<div class="share-container">
  <button
    class="share-button"
    type="button"
    data-title={title}
    data-text={text}
    data-url={shareUrl}
  >
    <svg class="share-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
    Share
  </button>
  <span class="share-toast" hidden aria-live="polite">Link copied</span>
</div>

<style>
  .share-container {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    position: relative;
  }
  .share-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-sm);
    transition: background-color 0.15s;
  }
  .share-button:hover {
    background: var(--color-border);
  }
  .share-button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .share-icon {
    flex-shrink: 0;
  }
  .share-toast {
    font-size: var(--font-size-sm);
    color: var(--color-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .share-button { transition: none; }
  }
</style>

<script is:inline>
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".share-button");
    if (!btn) return;

    var title = btn.dataset.title || document.title;
    var text = btn.dataset.text || "";
    var url = new URL(btn.dataset.url || location.pathname, location.origin).href;
    var toast = btn.parentElement.querySelector(".share-toast");

    if (navigator.share) {
      var data = { title: title, url: url };
      if (text) data.text = text;
      navigator.share(data).catch(function (err) {
        if (err.name !== "AbortError") console.error(err);
      });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        if (!toast) return;
        toast.hidden = false;
        setTimeout(function () { toast.hidden = true; }, 2000);
      });
    }
  });
</script>
```

**Component design notes:**

- **Progressive enhancement:** Web Share API on mobile/supporting desktop, clipboard fallback elsewhere. If neither API is available (very old browsers), the button simply does nothing — no error.
- **Event delegation:** A single document-level listener handles all share buttons on the page. Efficient for pages with multiple share targets (blog archive, post listings).
- **`aria-live="polite"`** on the toast so screen readers announce "Link copied" without interrupting.
- **No social media icons.** The OS share sheet presents the user's own apps — far more useful than a row of branded buttons for services they may not use.
- **SVG icon** is a standard share/upload glyph, inlined (no external request). The `aria-hidden="true"` attribute prevents screen readers from announcing it (the button text "Share" is sufficient).

## Step 3 — Integrate into pages

**For blog posts (option 1):**

Find the blog post template. Check for files matching these patterns:
- `src/pages/blog/[slug].astro`
- `src/pages/blog/[...slug].astro`
- `src/pages/posts/[slug].astro`

Read the file. Add the ShareButton import and render it after the post content, before the closing layout tag:

```astro
import ShareButton from "../../components/ShareButton.astro";
```

```html
<ShareButton title={entry.data.title} text={entry.data.description ?? ""} />
```

Place it after the post body and any existing metadata (date, tags, author). If there's a post footer section, add it there. If not, wrap it in a `<footer>` with a class:

```html
<footer class="post-footer">
  <ShareButton title={entry.data.title} text={entry.data.description ?? ""} />
</footer>
```

Add minimal styling for the post footer:

```css
.post-footer {
  margin-block-start: var(--space-lg);
  padding-block-start: var(--space-md);
  border-block-start: 1px solid var(--color-border);
}
```

**For all pages (option 2):**

Add the ShareButton to `src/layouts/BaseLayout.astro`, in the `<footer>` element:

```astro
import ShareButton from "../components/ShareButton.astro";
```

```html
<footer>
  <ShareButton title={title} />
  <!-- existing footer content -->
</footer>
```

**For specific pages (option 3):**

Add the import and component to each page the owner specified. Use the page's `title` prop.

## Step 4 — Save configuration

Append to `.site-config`:

```
SHARE_ENABLED=true
SHARE_PLACEMENT=<blog|all|specific>
```

## Step 5 — Build and verify

Run `npm run build`.

After a successful build, tell the owner:

> "Share buttons are live! Here's how they work:
>
> - **On mobile** (iOS Safari, Android Chrome): tapping Share opens the device's native share sheet — visitors can send the page via Messages, WhatsApp, email, or any app they have installed
> - **On desktop**: tapping Share copies the page link to the clipboard with a 'Link copied' confirmation
>
> No data is sent to any third party. The button uses the browser's built-in Web Share API."

## Re-running the command

If `/anglesite:share` runs on a site that already has share buttons:

1. Read `.site-config` for `SHARE_ENABLED` and `SHARE_PLACEMENT`
2. Ask what the owner wants to change:
   - **Placement** — move from blog-only to all pages, or vice versa
   - **Style** — adjust button appearance (size, position, label)
   - **Remove** — delete the component and imports, set `SHARE_ENABLED=false`
3. Rebuild and verify
