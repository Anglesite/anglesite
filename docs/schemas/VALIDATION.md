# Website Schema Validation Guide

ABOUTME: Comprehensive guide to website configuration schema validation in Anglesite projects
ABOUTME: Covers required fields, conditional validation, image path validation, and best practices

This document explains the validation requirements for the Anglesite website configuration schema.

## Required Fields

### Always Required

- **`title`** (string): The website title is always required

### Optional with Defaults

- **`language`** (string): Language code (ISO 639-1), defaults to "en" if not provided

### Conditionally Required

#### Favicon Configuration

When using the `favicon` object, **at least one** of the following must be provided:

- `ico` - Traditional favicon.ico file
- `svg` - Modern scalable SVG favicon
- `png` - PNG favicons by size
- `appleTouchIcon` - Apple touch icon

#### Web App Manifest

When using the `manifest` object, these fields are **required**:

- **`name`** (string): Full application name (minimum 1 character)
- **`icons`** (array): At least one icon definition

Each icon in the `icons` array **requires**:

- **`src`** (string): Path to icon file
- **`sizes`** (string): Icon dimensions in "WIDTHxHEIGHT" format
- **`type`** (string): MIME type (e.g., "image/png")

#### Head Links

When using items in the `head_links` array, this field is **required**:

- **`rel`** (string): Link relationship (e.g., "stylesheet", "preload")

## Image Path Validation

The asset pipeline validates image paths found in the website configuration:

### Automatically Validated Paths

All string values ending with image extensions are automatically validated:

- `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.webp`, `.avif`

### Common Image Fields

- `social.ogImage` - Open Graph image for social sharing
- `social.twitterCard` - Twitter Card image
- `social.avatar` - Profile/avatar image
- `social.heroImage` - Hero banner image
- `favicon.ico` - Favicon ICO file
- `favicon.svg` - Favicon SVG file
- `favicon.png.*` - PNG favicon files
- `favicon.appleTouchIcon` - Apple touch icon
- `manifest.icons[].src` - Manifest icon files

### Validation Behavior

By default, missing images will **throw errors** and stop the build. This can be configured:

```javascript
// Throw errors (default)
eleventyConfig.addPlugin(addAssetPipeline, {
  onMissingImage: "throw",
});

// Log warnings only
eleventyConfig.addPlugin(addAssetPipeline, {
  onMissingImage: "warn",
});

// Silent fallback
eleventyConfig.addPlugin(addAssetPipeline, {
  onMissingImage: "silent",
});
```

## Recommended Image Sizes

### Social Sharing

- **Open Graph**: 1200x630px (1.91:1 ratio)
- **Twitter Card**: 1200x675px (16:9 ratio)

### Favicons

- **ICO**: 16x16px or 32x32px (can contain multiple sizes)
- **PNG**: 16x16, 32x32, 192x192, 512x512px
- **SVG**: Scalable (any size)
- **Apple Touch Icon**: 180x180px

### App Icons

- **Minimum**: 192x192px and 512x512px
- **Recommended**: Also include maskable versions for Android
- **Format**: PNG for compatibility

## Validation Tools

### Manual Validation

```javascript
import { validateWebsiteImages } from "@dwk/anglesite-11ty/plugins/assets";

const websiteData = require("./src/_data/website.json");
const results = validateWebsiteImages(websiteData, "./src/images/");

console.log("Validation results:", results);
```

### Build-time Validation

The asset pipeline automatically validates images referenced in shortcodes:

```liquid
{% image website.social.heroImage, "Hero image" %}
```

## Error Types

### ImageNotFoundError

Thrown when an image file cannot be found at the specified path.

### ImageProcessingError

Thrown when image processing fails (corrupt file, unsupported format, etc.).

## Configuration Examples

### Minimal Valid Configuration

```json
{
  "title": "My Website"
}
```

### With Language Specification

```json
{
  "title": "My Website",
  "language": "fr"
}
```

### With Minimal Favicon

```json
{
  "title": "My Website",
  "favicon": {
    "ico": "/favicon.ico"
  }
}
```

### With Minimal Web App Manifest

```json
{
  "title": "My Website",
  "manifest": {
    "name": "My App",
    "icons": [
      {
        "src": "/icon-192.png",
        "sizes": "192x192",
        "type": "image/png"
      }
    ]
  }
}
```

## Best Practices

1. **Always provide fallbacks**: Include multiple icon sizes and formats
2. **Use absolute paths**: For assets outside the image directory
3. **Validate early**: Run validation during development
4. **Optimize images**: Use appropriate formats and sizes
5. **Test thoroughly**: Validate on different devices and browsers
