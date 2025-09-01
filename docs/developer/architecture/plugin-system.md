# Plugin System Architecture

## Overview

Anglesite's plugin system is built on NPM modules, allowing developers to create and share starter templates and extensions. The system is designed to be simple, familiar to JavaScript developers, and leverage the existing NPM ecosystem.

## Plugin Types

### 1. Starter Templates

Starter templates are complete website scaffolds that users can select when creating a new website in Anglesite.

#### Current Starters

- **anglesite-starter** - The basic "blank" starter template
  - Location: `/anglesite-starter/`
  - Minimal setup with index page
  - Base configuration for Eleventy

#### Planned Starters

- Blog starter
- Restaurant website starter
- Online shop starter
- Portfolio starter
- Documentation site starter

### 2. Component Libraries (Future)

NPM packages containing reusable WebC components:

- Form components
- Navigation patterns
- Content blocks
- Interactive widgets

### 3. Theme Packages (Future)

Visual themes that can be applied to any starter:

- CSS frameworks integration
- Design token systems
- Icon sets

## Creating a Starter Template

### Structure

A starter template is an NPM package with this structure:

```
my-anglesite-starter/
├── package.json           # NPM package metadata
├── .eleventy.js          # Eleventy configuration
├── src/
│   ├── index.md          # Homepage
│   ├── _includes/        # Layouts and partials
│   └── assets/           # CSS, JS, images
└── README.md             # Documentation
```

### package.json Requirements

```json
{
  "name": "@myorg/anglesite-starter-blog",
  "version": "1.0.0",
  "description": "Blog starter for Anglesite",
  "keywords": ["anglesite", "starter", "blog"],
  "anglesite": {
    "type": "starter",
    "name": "Blog",
    "description": "A blog with RSS feed and categories",
    "preview": "preview.png"
  },
  "dependencies": {
    "@dwk/anglesite-11ty": "^1.0.0",
    "@11ty/eleventy": "^2.0.0"
  }
}
```

### Eleventy Configuration

All starters must use the anglesite-11ty configuration:

```javascript
// .eleventy.js
const anglesiteConfig = require("@dwk/anglesite-11ty");

module.exports = function (eleventyConfig) {
  // Apply Anglesite base configuration
  anglesiteConfig(eleventyConfig);

  // Add starter-specific configuration
  eleventyConfig.addCollection("posts", (collection) => {
    return collection.getFilteredByGlob("src/posts/*.md");
  });

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
```

## Plugin Discovery

### NPM Registry

Plugins are discovered through NPM using standardized naming and keywords:

- **Naming Convention**: `anglesite-starter-{name}`
- **Required Keywords**: `["anglesite", "starter"]`
- **Registry Search**: `npm search anglesite-starter`

### Local Development

During development, link your starter locally:

```bash
# In your starter directory
npm link

# In Anglesite
npm link @myorg/anglesite-starter-blog
```

## Plugin Installation

### User Flow

1. User clicks "New Website" in Anglesite
2. Anglesite queries available starters from NPM
3. User selects a starter template
4. Anglesite runs `npm install` for the starter
5. Files are copied to the new website directory
6. Dependencies are installed

### Programmatic Installation

```typescript
// In Anglesite's website creation logic
import { createWebsiteFromStarter } from "./plugin-manager";

async function createNewWebsite(name: string, starter: string) {
  // Install starter package
  await exec(`npm install ${starter} --prefix temp`);

  // Copy starter files to website directory
  await copyStarterFiles(starter, websitePath);

  // Install website dependencies
  await exec(`npm install --prefix ${websitePath}`);

  // Initialize website
  await initializeWebsite(websitePath);
}
```

## Best Practices

### For Starter Authors

1. **Keep It Simple** - Starters should be minimal and focused
2. **Document Everything** - Include clear README with usage instructions
3. **Use Semantic Versioning** - Follow semver for updates
4. **Test Thoroughly** - Ensure starter works with latest Anglesite
5. **Provide Examples** - Include sample content and pages

### Starter Requirements

- Must include valid `package.json` with anglesite metadata
- Must depend on `@dwk/anglesite-11ty`
- Must have Eleventy configuration file
- Should include preview image for starter selection UI
- Should provide clear documentation

### Performance Considerations

- Keep starter size minimal (<5MB)
- Lazy-load heavy dependencies
- Use CDN for large assets when possible
- Optimize images and assets

## Testing Starters

### Unit Tests

```javascript
// test/starter.test.js
const { createWebsiteFromStarter } = require("../plugin-manager");

test("starter creates valid website", async () => {
  const websitePath = await createWebsiteFromStarter(
    "test-site",
    "anglesite-starter",
  );

  // Verify structure
  expect(fs.existsSync(`${websitePath}/src/index.md`)).toBe(true);
  expect(fs.existsSync(`${websitePath}/.eleventy.js`)).toBe(true);

  // Test build
  const { stdout } = await exec(`npm run build --prefix ${websitePath}`);
  expect(stdout).toContain("Wrote");
});
```

### Integration Tests

Test your starter with Anglesite:

```bash
# Install Anglesite locally
git clone https://github.com/anglesite/anglesite
cd anglesite
npm install

# Link your starter
npm link ../my-anglesite-starter

# Test in Anglesite
npm start
# Create new website using your starter
```

## Future Enhancements

### Plugin Manager UI

- In-app plugin browser
- Ratings and reviews
- One-click installation
- Update notifications

### Plugin API

- Hooks for build process
- Custom menu items
- Settings panel integration
- IPC message handlers

### Community Features

- Plugin marketplace
- Starter template gallery
- Component sharing platform
- Theme repository

## Examples

### Minimal Starter

See `/anglesite-starter/` for the reference implementation of a minimal starter template.

### Creating a Blog Starter

```javascript
// Example blog starter structure
module.exports = {
  name: "anglesite-starter-blog",
  description: "Blog with posts, categories, and RSS",
  install: async (targetPath) => {
    // Copy template files
    await copyTemplateFiles(targetPath);

    // Create sample posts
    await createSamplePosts(targetPath);

    // Configure RSS feed
    await configureRSS(targetPath);
  },
};
```

## Support

For help creating plugins:

- Review the anglesite-starter source code
- Check the Anglesite documentation
- Open an issue on GitHub
- Join the community Discord (coming soon)
