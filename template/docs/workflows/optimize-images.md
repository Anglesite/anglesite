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

## Why this matters

A single unoptimized phone photo (3–5 MB) can make a page load 10x slower. WebP images are typically 25–35% smaller than JPEG at equivalent quality. Responsive variants ensure mobile visitors don't download desktop-sized images.

EXIF stripping prevents accidentally publishing GPS coordinates from phone photos.
