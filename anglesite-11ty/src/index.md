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

### 6. Data File Base Name

The plugin sets the data file base name to 'index' for collection-specific
front matter.
