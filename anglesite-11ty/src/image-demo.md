---
title: "Image Optimization Demo"
layout: layout.html
description: "Demonstration of all Anglesite 11ty image optimization features"
---

# Image Optimization Demo

This page demonstrates all the image optimization features available in Anglesite 11ty using the `@11ty/eleventy-img` plugin.

## 1. Responsive Image with Picture Element

The `{% raw %}{% image %}{% endraw %}` shortcode creates responsive images with automatic format optimization (AVIF, WebP, JPEG fallbacks):

{% image "src/images/hero-image.svg", "Hero image showcasing Anglesite 11ty image optimization", "(min-width: 800px) 800px, 100vw" %}

### Code:
```liquid
{% raw %}{% image "src/images/hero-image.svg", "Hero image showcasing Anglesite 11ty image optimization", "(min-width: 800px) 800px, 100vw" %}{% endraw %}
```

## 2. Logo with Fixed Size

Perfect for logos and icons where you need a specific size:

{% image "src/images/logo.svg", "Anglesite 11ty logo", "200px" %}

### Code:
```liquid
{% raw %}{% image "src/images/logo.svg", "Anglesite 11ty logo", "200px" %}{% endraw %}
```

## 3. Single Image URL

The `{% raw %}{% imageUrl %}{% endraw %}` shortcode generates a single optimized image URL for specific use cases:

<img src="{% imageUrl 'src/images/thumbnail.svg', 100, 'webp' %}" alt="Generated thumbnail" width="100" height="100" style="border-radius: 8px;">

### Code:
```html
<img src="{% raw %}{% imageUrl 'src/images/thumbnail.svg', 100, 'webp' %}{% endraw %}" alt="Generated thumbnail" width="100" height="100">
```

## 4. Feature Card Gallery

Demonstrating different image sizes and lazy loading:

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin: 2rem 0;">
  <div>
    {% image "src/images/feature-card.svg", "Feature card example showing responsive design", "300px" %}
    <h3>Responsive Design</h3>
    <p>Automatic format optimization with AVIF, WebP, and JPEG fallbacks.</p>
  </div>
  
  <div>
    {% image "src/images/gallery-1.svg", "Gallery image 1 showing landscape", "300px" %}
    <h3>Landscape Images</h3>
    <p>Perfect for hero sections and banner images with optimized loading.</p>
  </div>
  
  <div>
    {% image "src/images/gallery-2.svg", "Gallery image 2 showing forest scene", "300px" %}
    <h3>Nature Scenes</h3>
    <p>Optimized for various screen sizes with lazy loading enabled.</p>
  </div>
</div>

## 5. Image Metadata for SEO

The `{% raw %}{% imageMetadata %}{% endraw %}` shortcode provides structured data for SEO and JSON-LD:

```json
{% imageMetadata "src/images/hero-image.svg" %}
```

This metadata can be used for:
- Open Graph images
- Twitter Cards
- JSON-LD structured data
- Image sitemaps

## 6. Different Format Examples

### WebP Format (Default)
<img src="{% imageUrl 'src/images/logo.svg', 150, 'webp' %}" alt="WebP format example" style="border: 2px solid #e2e8f0; border-radius: 8px; margin: 0.5rem;">

### JPEG Format
<img src="{% imageUrl 'src/images/hero-image.svg', 150, 'jpeg' %}" alt="JPEG format example" style="border: 2px solid #e2e8f0; border-radius: 8px; margin: 0.5rem;">

### PNG Format
<img src="{% imageUrl 'src/images/feature-card.svg', 150, 'png' %}" alt="PNG format example" style="border: 2px solid #e2e8f0; border-radius: 8px; margin: 0.5rem;">

## 7. Thumbnail Grid

Perfect for photo galleries and image grids:

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin: 2rem 0;">
  {% for i in (1..6) %}
  <div style="text-align: center;">
    {% assign imagePath = "src/images/thumbnail.svg" %}
    {% image imagePath, "Thumbnail example", "120px" %}
    <small>Thumbnail {{ i }}</small>
  </div>
  {% endfor %}
</div>

## Features Demonstrated

✅ **Automatic Format Conversion**: AVIF → WebP → JPEG fallbacks  
✅ **Responsive Images**: Multiple sizes with `srcset` and `sizes`  
✅ **Lazy Loading**: Enabled by default for performance  
✅ **SEO Optimization**: Proper alt attributes and metadata  
✅ **Performance**: Cached builds and optimized file sizes  
✅ **Accessibility**: Required alt text validation  
✅ **Flexible Sizing**: Custom widths and formats  

## Technical Details

- **Output Directory**: `/img/` (configurable)
- **Default Formats**: AVIF, WebP, JPEG
- **Default Widths**: 300px, 600px, 1200px
- **Loading Strategy**: Lazy loading with async decoding
- **Caching**: Build-time image processing cache

---

*This demo showcases the comprehensive image optimization capabilities of Anglesite 11ty powered by @11ty/eleventy-img.*