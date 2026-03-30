---
name: optimize-images
description: "Optimize images: resize, convert to WebP, strip EXIF, generate srcset variants"
user-invokable: false
allowed-tools: Bash(npm run ai-optimize), Write, Read, Edit, Glob
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

## Privacy note

EXIF stripping is a privacy feature. Phone photos often contain GPS coordinates that reveal where the photo was taken. The optimizer removes all metadata automatically — the owner doesn't need to think about it.
