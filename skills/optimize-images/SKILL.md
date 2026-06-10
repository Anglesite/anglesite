---
name: optimize-images
description: "Optimize images: resize, convert to WebP, strip EXIF, generate srcset variants"
user-invocable: false
allowed-tools: Bash(npm run ai-optimize), Bash(npx wrangler r2 *), mcp__cloudflare__r2_bucket_create, mcp__cloudflare__r2_bucket_get, mcp__cloudflare__r2_buckets_list, Write, Read, Edit, Glob
---

Optimize images in `public/images/` for web performance and privacy. Called automatically when images are added during design, page creation, or content editing — not invoked directly by the owner.

## When to invoke this skill

- After the design-interview skill adds images
- After the new-page skill adds images
- When the owner uploads or adds images to `public/images/`
- Before deploy if unoptimized images are detected

## What it does

1. **Finds** all unoptimized images (jpg, jpeg, png, gif, tiff, heif, heic)
2. **Preserves** originals in `public/images/originals/`
3. **Converts** to WebP (80% quality — excellent visual fidelity, much smaller)
4. **Resizes** to responsive variants: 480px, 768px, 1024px, 1920px width
5. **Strips** EXIF metadata — removes GPS coordinates, camera info, timestamps
6. **Reports** savings in plain language

Skips: SVG files, already-optimized WebP/AVIF, generated files (favicon, og-image).

## Step 1 — Run the optimizer

```sh
npm run ai-optimize
```

The script scans `public/images/`, processes each image, and prints a summary.

## Step 2 — Report to the owner

After optimization completes, tell the owner what happened in plain language:

"I optimized your images for faster loading: [report from script output]. Originals are saved in `public/images/originals/` if you ever need them."

If HEIF/HEIC files were found, add: "I converted your iPhone photos to WebP — they'll load much faster on your website while looking just as good."

## Step 3 — Update image references

If any templates or content files reference the original filenames (e.g., `photo.jpg`), update them to use the WebP versions (e.g., `photo.webp`).

For blog posts in `src/content/posts/`, update the `image` frontmatter field.

## Step 4 — AI-drafted alt text (when available)

On an Apple-Silicon Mac with Apple Intelligence enabled, `npm run ai-optimize`
also drafts alt text for each image **on-device** (nothing is sent to any
cloud) and writes it to `image-alt.json` at the project root. Each entry is a
`draft` — a context-blind starting point, never a finished accessibility claim.

`image-alt.json` is authoring-only: it is committed for review but is **not**
under `public/`, so it never deploys. Re-running the optimizer never overwrites
an entry whose `status` is `reviewed`.

When you place an image (new page, blog post, menu, gallery) or remediate an
`a11y-audit` `img-alt-missing` / `img-alt-placeholder` finding:

1. Look up the draft for that image in `image-alt.json`.
2. Refine it using the on-page context you have (surrounding copy, the image's
   role). Purely decorative images get `alt=""`.
3. Write the result to the real `imageAlt` frontmatter or `alt=` attribute.
4. Set that catalog entry's `status` to `reviewed`.

Always present drafted alt text to the owner as something to review before
publishing.

### When `fm` is not available

On any other machine, no catalog is written and nothing breaks — draft alt text
yourself from context exactly as before. The published result is the same; `fm`
only changes who drafts first. The owner can disable the pass even on a capable
Mac with `ALT_TEXT_AI=off` in `.site-config`, or a one-off `npm run ai-optimize -- --no-alt`.

## Privacy note

EXIF stripping is a privacy feature. Phone photos often contain GPS coordinates that reveal where the photo was taken. The optimizer removes all metadata automatically — the owner doesn't need to think about it.
