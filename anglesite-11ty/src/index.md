---
title: Anglesite Eleventy Test
layout: layout.html
description: A test page for the Anglesite 11ty plugin features
---

## Testing Anglesite 11ty Plugin Features

This page tests various features of the `@dwk/anglesite-11ty` plugin:

### 1. Page Title Generation

The page title should be generated using the `getPageTitle()` shortcode,
combining the page title with the website title.

### 2. Date Formatting

The date at the bottom of the page uses the `htmlDateString` filter.

### 3. HTML Minification

The generated HTML should be minified using html-minifier-terser.

### 4. Schema.org JSON-LD

The getSchema function is available for generating structured data in templates.

```html
<slot @text="getSchema()"></slot>
```

### 5. OG Image Helper

The ogImage helper function is available for JavaScript functions in templates.

### 6. Image Optimization

The plugin now includes powerful image optimization using @11ty/eleventy-img:

{% image "src/images/logo.svg", "Anglesite 11ty logo", "150px" %}

**Available shortcodes:**

- `{% raw %}{% image src, alt, sizes %}{% endraw %}` - Responsive images with picture elements
- `{% raw %}{% imageUrl src, width, format %}{% endraw %}` - Single optimized image URLs
- `{% raw %}{% imageMetadata src %}{% endraw %}` - Image metadata for SEO

[**View Full Image Demo →**](image-demo/)

### 7. OpenID Connect Discovery

The plugin generates OpenID Connect Discovery Configuration for OAuth2/OIDC servers:

- **Standard Endpoint**: `/.well-known/openid_configuration`
- **Auto-discovery**: Clients can automatically discover server capabilities
- **Security Compliant**: Follows RFC 8414 and OpenID Connect 1.0 specifications

Configure in `src/_data/website.json`:

```json
{
  "openid_configuration": {
    "enabled": true,
    "issuer": "https://example.com",
    "authorization_endpoint": "https://example.com/oauth2/authorize",
    "token_endpoint": "https://example.com/oauth2/token"
  }
}
```

[**View OpenID Connect Demo →**](openid-demo/)

### 8. Data File Base Name

The plugin sets the data file base name to 'index' for collection-specific
front matter.
