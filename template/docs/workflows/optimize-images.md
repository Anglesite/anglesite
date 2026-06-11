# Image optimization

Automatically optimize images for web performance and privacy.

## What it does

- **Resizes** to responsive widths (480, 768, 1024, 1920px)
- **Converts** to WebP format (80% quality, much smaller files)
- **Strips EXIF** metadata (removes GPS, camera info for privacy)
- **Preserves originals** in `public/images/originals/`

## Supported formats

| Input | Converted to |
|---|---|
| JPG, JPEG | WebP |
| PNG | WebP |
| GIF | WebP |
| TIFF | WebP |
| HEIF, HEIC (iPhone) | WebP |

SVG, WebP, and AVIF files are skipped (already optimized or vector).

## Usage

```sh
npm run ai-optimize
```

Runs automatically when images are added during design or page creation.

## AI-drafted alt text

If you're on a Mac with Apple Intelligence turned on, optimizing images also
drafts alt text for each one — a short description used by screen readers and
search engines. This happens entirely on your Mac; no images are uploaded
anywhere. Drafts land in `image-alt.json` and are marked as drafts until
reviewed.

These are starting points, not final copy. When an image goes on a page, your
webmaster refines the description to fit where it's used and shows it to you to
confirm. On computers without this feature, the descriptions are written
directly — the end result is the same.

To turn the feature off, add `ALT_TEXT_AI=off` to `.site-config`.

If you imported a site or already have web-ready images, run `npm run ai-alt` to
draft alt text for those too (the regular optimize step only covers images it
converts). It works the same way — drafts you review before publishing.

## Why this matters

A single unoptimized phone photo (3–5 MB) can make a page load 10x slower. WebP images are typically 25–35% smaller than JPEG at equivalent quality. Responsive variants ensure mobile visitors don't download desktop-sized images.

EXIF stripping prevents accidentally publishing GPS coordinates from phone photos.
