# @dwk/anglesite-11ty

This package provides the core Eleventy configuration and build system for Anglesite websites. It's designed as a separate NPM module to enable easy website exports and standalone builds outside of the Anglesite desktop application.

## Features

- Pre-configured Eleventy setup optimized for Anglesite
- WebC component integration with conflict prevention
- Built-in layouts and templates
- Performance optimizations
- SEO and accessibility defaults
- RSS/JSONFeed generation support

## Installation

```bash
npm install @dwk/anglesite-11ty
```

## Usage

### In Your Eleventy Config

```javascript
// .eleventy.js or eleventy.config.js
const anglesiteConfig = require('@dwk/anglesite-11ty');

module.exports = function (eleventyConfig) {
  // Apply Anglesite configuration
  anglesiteConfig(eleventyConfig, {
    // Optional configuration
    skipWebC: false, // Set to true to disable WebC processing
    customComponents: ['./my-components/**/*.webc'],
  });

  // Add your custom configuration
  eleventyConfig.addFilter('myFilter', function (value) {
    return value.toUpperCase();
  });

  return {
    dir: {
      input: 'src',
      output: '_site',
    },
  };
};
```

## Configuration Options

| Option             | Type     | Default | Description                                |
| ------------------ | -------- | ------- | ------------------------------------------ |
| `skipWebC`         | boolean  | false   | Disable WebC plugin to prevent conflicts   |
| `customComponents` | string[] | []      | Additional WebC component paths            |
| `syntaxHighlight`  | boolean  | true    | Enable syntax highlighting for code blocks |
| `rss`              | object   | {}      | RSS feed configuration                     |
| `jsonFeed`         | object   | {}      | JSON feed configuration                    |

## Included Plugins

This package includes and configures:

- `@11ty/eleventy-plugin-webc` - WebC component support
- `@11ty/eleventy-plugin-syntaxhighlight` - Code syntax highlighting
- `@11ty/eleventy-plugin-rss` - RSS feed generation
- Custom image optimization
- Custom link processing

## WebC Components

The package provides integration with WebC components from `@dwk/web-components`:

```html
<!-- In your templates -->
<site-header title="My Site"></site-header>
<content-card>
  <h2 slot="title">Card Title</h2>
  <p>Card content goes here</p>
</content-card>
```

## Build Commands

When used in a project:

```bash
# Development build with watch
npx eleventy --serve

# Production build
npx eleventy

# Build with debugging
DEBUG=Eleventy* npx eleventy
```

## File Structure

Expected project structure:

```text
your-website/
├── .eleventy.js          # Your Eleventy config
├── src/
│   ├── index.md          # Homepage
│   ├── _includes/        # Layouts and partials
│   ├── _data/           # Data files
│   └── assets/          # Static assets
├── _site/               # Build output
└── package.json
```

## API

### Main Function

```typescript
function anglesiteConfig(eleventyConfig: EleventyConfig, options?: AnglesiteOptions): void;
```

### Options Interface

```typescript
interface AnglesiteOptions {
  skipWebC?: boolean;
  customComponents?: string[];
  syntaxHighlight?: boolean;
  rss?: RSSOptions;
  jsonFeed?: JSONFeedOptions;
}
```

## Troubleshooting

### WebC Components Not Loading

Ensure WebC is not disabled:

```javascript
anglesiteConfig(eleventyConfig, {
  skipWebC: false, // Must be false (default)
});
```

### Build Performance Issues

For large sites, consider:

```javascript
anglesiteConfig(eleventyConfig, {
  syntaxHighlight: false, // Disable if not needed
});
```

### Conflict with Other Plugins

TODO: Document specific WebC plugin conflict scenarios and resolutions once better understood.

## Development

### Testing

```bash
npm test           # Run tests
npm test:watch    # Watch mode
npm test:coverage # With coverage
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests (maintain 90% coverage)
5. Submit a pull request

## License

ISC

## Related Packages

- `anglesite` - Main Electron application
- `@dwk/web-components` - Reusable WebC components
- `@dwk/anglesite-starter` - Basic website template
