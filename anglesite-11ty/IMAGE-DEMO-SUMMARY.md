# Anglesite 11ty Image Demo Summary

## ✅ Sample Images Added

Created 6 sample SVG images in `src/images/`:

- `hero-image.svg` (1200×600) - Hero banner with gradient
- `logo.svg` (200×200) - Anglesite 11ty logo
- `feature-card.svg` (400×300) - Feature demonstration card
- `gallery-1.svg` (600×400) - Landscape scene
- `gallery-2.svg` (600×400) - Forest scene
- `thumbnail.svg` (150×150) - Small thumbnail icon

## 🎯 Demo Pages Created

### Main Demo: `src/image-demo.md`

Comprehensive demonstration page showcasing:

- Responsive images with picture elements
- Single image URLs for specific use cases
- Image metadata for SEO and JSON-LD
- Gallery layouts and thumbnail grids
- Different format examples (WebP, JPEG, PNG)
- Technical details and features

### Updated Index: `src/index.md`

Added image optimization section with:

- Live logo example
- Shortcode documentation
- Link to full demo page

## 🔧 Generated Output

The build process created **59 optimized image files** in `_site/img/`:

### Formats Generated

- **AVIF**: Next-gen format with best compression
- **WebP**: Modern format with excellent compression
- **JPEG**: Universal fallback format
- **PNG**: For images requiring transparency

### Sizes Generated

- **300w**: Mobile/small screens
- **600w**: Tablet/medium screens
- **1200w**: Desktop/large screens
- **Custom sizes**: 100px, 150px for specific use cases

## 📊 Performance Benefits

### File Size Comparison Example (hero-image.svg → 1200px)

- **AVIF**: 4.7KB (-80% from JPEG)
- **WebP**: 14.5KB (-40% from JPEG)
- **JPEG**: 24.0KB (baseline)

### HTML Output Features

- Progressive enhancement with `<picture>` elements
- Format fallbacks (AVIF → WebP → JPEG)
- Responsive `srcset` with multiple breakpoints
- Lazy loading and async decoding
- Proper accessibility with required alt text

## 🚀 Shortcodes Available

### `{% image src, alt, sizes %}`

Generates responsive picture element with multiple formats and sizes.

### `{% imageUrl src, width, format %}`

Returns single optimized image URL for specific dimensions.

### `{% imageMetadata src %}`

Provides structured data for SEO, Open Graph, and JSON-LD.

## 🎨 Demo URL Structure

- **Home**: `/` - Basic image optimization overview
- **Full Demo**: `/image-demo/` - Complete feature showcase
- **Optimized Images**: `/img/` - All processed images

## ✨ Key Features Demonstrated

✅ Automatic format conversion and optimization  
✅ Responsive image generation  
✅ Modern web performance patterns  
✅ SEO and accessibility compliance  
✅ Build-time processing and caching  
✅ Flexible configuration options  
✅ Error handling and validation

The image optimization plugin is now fully integrated and demonstrated with comprehensive examples showcasing all capabilities!
