# Website Schema Validation Guide

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
  onMissingImage: 'throw',
});

// Log warnings only
eleventyConfig.addPlugin(addAssetPipeline, {
  onMissingImage: 'warn',
});

// Silent fallback
eleventyConfig.addPlugin(addAssetPipeline, {
  onMissingImage: 'silent',
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
import { validateWebsiteImages } from '@dwk/anglesite-11ty/plugins/assets';

const websiteData = require('./src/_data/website.json');
const results = validateWebsiteImages(websiteData, './src/images/');

console.log('Validation results:', results);
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

---

## JSON Schema Validation

This section explains the JSON schema validation system for Anglesite schemas.

## Overview

All JSON schemas in the `schemas/` directory are automatically validated for:

- ✅ Valid JSON syntax
- ✅ Valid JSON Schema structure (Draft 7)
- ✅ Circular reference detection
- ✅ Reference resolution (all `$ref` pointers must be valid)
- ✅ Format validation (email, URI, etc.)

## Running Schema Validation

### During Development

Schema validation runs automatically as part of the lint process:

```bash
# Lint everything (includes schema validation)
npm run lint

# Lint only schemas
npm run lint:schemas
```

### Independent Schema Validation

You can run schema validation independently:

```bash
cd anglesite-11ty
npm run lint:schemas
```

## Validation Rules

### 1. JSON Syntax Validation

All schema files must be valid JSON. The validator will report:

- Line and column numbers for syntax errors
- Specific error messages

### 2. JSON Schema Structure Validation

Schemas must conform to JSON Schema Draft 7 specification:

- Required properties like `$schema`, `type`, etc.
- Valid schema keywords
- Proper structure for definitions, properties, etc.

### 3. Circular Reference Detection

The validator detects circular references using `@apidevtools/json-schema-ref-parser`:

```json
// ❌ This would create a circular reference
{
  "definitions": {
    "A": { "$ref": "#/definitions/B" },
    "B": { "$ref": "#/definitions/A" }
  }
}
```

**Common circular reference patterns to avoid:**

- Self-referencing definitions
- Inheritance cycles (A extends B extends A)
- Complex multi-level cycles

### 4. Reference Resolution

All `$ref` pointers must resolve to valid schema definitions:

```json
// ✅ Valid reference
{ "$ref": "./common.json#/definitions/url" }

// ❌ Invalid reference (missing file or definition)
{ "$ref": "./missing.json#/definitions/url" }
{ "$ref": "./common.json#/definitions/missing" }
```

### 5. Format Validation

The validator supports all standard JSON Schema formats:

- `email` - Valid email addresses
- `uri` - Valid URIs
- `date-time` - ISO 8601 date-time
- `date` - ISO 8601 date
- `time` - ISO 8601 time
- `hostname` - Valid hostnames
- `ipv4` - IPv4 addresses
- `ipv6` - IPv6 addresses

## Schema Organization

```text
schemas/
├── website.schema.json          # Main website configuration schema
└── modules/                     # Modular schema components
    ├── common.json             # Common type definitions
    ├── basic-info.json         # Basic website information
    ├── feeds.json              # RSS/Atom/JSON feed configuration
    ├── rsl.json                # RSL (Responsible Source License) configuration
    ├── seo-robots.json         # SEO and robots configuration
    ├── web-standards.json      # Web standards (OpenGraph, etc.)
    ├── networking.json         # Networking configuration
    ├── analytics.json          # Analytics configuration
    ├── well-known.json         # .well-known endpoints
    └── ...
```

## Schema Validation Best Practices

### 1. Use Common Definitions

Define reusable types in `common.json`:

```json
// common.json
{
  "definitions": {
    "url": {
      "type": "string",
      "format": "uri"
    }
  }
}

// other-schema.json
{
  "properties": {
    "homepage": {
      "$ref": "./common.json#/definitions/url"
    }
  }
}
```

### 2. Avoid Circular References

Instead of using inheritance patterns that create cycles:

```json
// ❌ Avoid this (creates circular reference)
{
  "BaseConfig": {
    "allOf": [{ "$ref": "#/definitions/ExtendedConfig" }]
  },
  "ExtendedConfig": {
    "allOf": [{ "$ref": "#/definitions/BaseConfig" }]
  }
}

// ✅ Use this instead (flatten the schema)
{
  "BaseConfig": {
    "type": "object",
    "properties": {
      "commonProperty": { "type": "string" }
    }
  },
  "ExtendedConfig": {
    "type": "object",
    "properties": {
      "commonProperty": { "type": "string" },
      "extendedProperty": { "type": "string" }
    }
  }
}
```

### 3. Document Complex Schemas

Add descriptions to all schema definitions:

```json
{
  "type": "object",
  "description": "Configuration for RSS/Atom/JSON feeds",
  "properties": {
    "enabled": {
      "type": "boolean",
      "description": "Enable feed generation",
      "default": true
    }
  }
}
```

### 4. Use Specific Formats

Prefer specific formats over generic strings:

```json
// ✅ Good - uses format validation
{
  "homepage": {
    "type": "string",
    "format": "uri",
    "description": "Website homepage URL"
  }
}

// ❌ Less good - no format validation
{
  "homepage": {
    "type": "string",
    "description": "Website homepage URL"
  }
}
```

## Troubleshooting Schema Validation

### Common Validation Errors

1. **Invalid JSON syntax**
   - Check for missing commas, quotes, brackets
   - Use a JSON formatter/validator

2. **Circular reference detected**
   - Review `$ref` chains for cycles
   - Consider flattening inheritance patterns
   - Use the `@apidevtools/json-schema-ref-parser` error details

3. **Reference resolution failed**
   - Verify file paths in `$ref` pointers
   - Check that referenced definitions exist
   - Ensure proper relative path syntax

4. **Invalid schema structure**
   - Verify required JSON Schema properties
   - Check keyword spelling and syntax
   - Review JSON Schema Draft 7 specification

## Integration with CI/CD

Schema validation is integrated into the development workflow:

- **Pre-commit**: Runs automatically with `npm run lint`
- **CI builds**: Part of the standard lint process
- **Pull requests**: Must pass schema validation
- **Development**: Runs during `npm run lint`

## Tools and Dependencies

- **AJV v8**: JSON Schema validator
- **ajv-formats**: Additional format validators
- **@apidevtools/json-schema-ref-parser**: Reference resolution and circular detection
- **Custom linter**: `/anglesite-11ty/scripts/lint-schemas.js`

## Further Reading

- [JSON Schema Draft 7 Specification](https://json-schema.org/draft-07/schema)
- [AJV Documentation](https://ajv.js.org/)
- [JSON Schema Reference Parser](https://github.com/APIDevTools/json-schema-ref-parser)
