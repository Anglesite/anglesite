# WebC Plugin System

## Overview

The WebC plugin system in Anglesite allows for extensible component functionality through Eleventy's WebC templating system.

## Plugin Conflict Prevention

The system includes conflict prevention mechanisms to ensure plugins don't interfere with each other during the build process.

### skipWebC Option

The `skipWebC` option allows selective disabling of WebC processing when needed:

```typescript
// anglesite-11ty/index.ts
eleventyConfig.addPlugin(webcPlugin, {
  skipWebC: options.skipWebC || false,
  components: ["src/_includes/**/*.webc", "npm:@dwk/web-components/**/*.webc"],
});
```

## TODO: Document Conflict Prevention Details

> **TODO**: Document the specific conflicts that the WebC plugin conflict prevention system addresses once the technical details are better understood. This includes:
>
> - What types of conflicts occur between plugins
> - How the prevention system detects conflicts
> - Best practices for plugin authors to avoid conflicts
> - Debugging conflict issues

## Current Implementation

The WebC plugin conflict prevention was implemented in commit b90dfa8 with comprehensive testing:

- Modified `anglesite-11ty/index.ts` to handle plugin conflicts
- Added tests in `anglesite-11ty/tests/index.test.ts`
- Updated server implementation in `anglesite/app/server/per-website-server.ts`

## Usage

### Basic WebC Component

```html
<!-- components/my-component.webc -->
<div class="my-component">
  <h2 @text="title"></h2>
  <slot></slot>
</div>

<style>
  .my-component {
    border: 1px solid #ccc;
    padding: 1rem;
  }
</style>
```

### Using Components in Templates

```html
<!-- In your template -->
<my-component title="Hello World">
  <p>Component content goes here</p>
</my-component>
```

## Testing WebC Plugins

Tests for WebC plugin functionality are located in:

- `anglesite-11ty/tests/index.test.ts`
- `anglesite/test/eleventy.test.ts`
- `anglesite/test/server/per-website-server.test.ts`

## Future Enhancements

- Document specific conflict scenarios and solutions
- Add plugin validation system
- Create plugin development guidelines
- Implement plugin dependency management
