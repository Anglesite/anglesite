---
title: Anglesite Eleventy Test
layout: layout.html
description: A test page for the Anglesite 11ty plugin features
---

## Testing Anglesite 11ty Plugin Features

This page tests various features of the `@dwk/anglesite-11ty` plugin:

### 1. Page Title Generation

The page title should be generated using the `getPageTitle()` shortcode, combining the page title with the website title.

### 2. Date Formatting

The date at the bottom of the page uses the `htmlDateString` filter.

### 3. HTML Minification

The generated HTML should be minified using html-minifier-terser.

### 4. Schema.org JSON-LD

The getSchema function is available for generating structured data in templates.

<template>
```html
  <slot @text="getSchema()"></slot>
```
</template>

### 5. OG Image Helper

The ogImage helper function is available for JavaScript functions in templates.

### 6. Data File Base Name

The plugin sets the data file base name to 'index' for collection-specific front matter.

### 7. Image Processing & Responsive Images

The asset pipeline plugin provides powerful image processing capabilities:

#### Basic Image Shortcode (Picture Element)

{% image "landscape.jpg", "A landscape demonstration image", "(min-width: 768px) 50vw, 100vw" %}

#### Simple IMG Element

{% img "portrait.jpg", "A portrait demo image", "(max-width: 400px) 100vw, 400px" %}

#### Figure with Caption

{% figure "figure-demo.png", "Figure demonstration", "100vw", "This is a sample figure with caption demonstrating the figure shortcode" %}

#### Banner Image

{% image "banner.jpg", "Banner demonstration", "(min-width: 1024px) 800px, 100vw" %}

#### Thumbnail Image

{% img "thumbnail.jpg", "Thumbnail demo", "300px" %}

#### Hero Banner (Existing)

{% image "hero-banner.jpg", "Hero banner demonstration", "(min-width: 1200px) 1200px, 100vw" %}

#### Sample Avatar

{% img "sample-avatar.jpg", "Sample user avatar", "150px" %}

### 8. Font Preloading

The plugin provides font preloading capabilities:

{% fontPreload "/fonts/roboto.woff2", "woff2" %}

### 9. Template Data Integration

Images can be referenced from website.json data:

#### Hero Image from Data

{% image website.social.heroImage, "Hero from website data", "(min-width: 1200px) 1200px, 100vw" %}

#### Banner from Data

{% img website.social.bannerImage, "Banner from data", "(min-width: 800px) 800px, 100vw" %}

### 10. Error Handling

The asset pipeline includes robust error handling for missing images and processing failures:

- **`onMissingImage`**: Controls behavior when images are not found
  - `'throw'` (default): Throws `ImageNotFoundError` and stops build
  - `'warn'`: Logs warning and returns fallback HTML
  - `'silent'`: Returns fallback HTML without logging

- **`onProcessingError`**: Controls behavior when image processing fails
  - `'throw'` (default): Throws `ImageProcessingError` and stops build
  - `'warn'`: Logs warning and returns fallback HTML
  - `'silent'`: Returns fallback HTML without logging

Example configuration:

```javascript
eleventyConfig.addPlugin(addAssetPipeline, {
  onMissingImage: 'warn', // Log warnings for missing images
  onProcessingError: 'throw', // Stop build on processing errors
});
```
