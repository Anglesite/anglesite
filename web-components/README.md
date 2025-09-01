# @dwk/web-components

A collection of reusable, accessible, and performant WebC components designed for Anglesite websites. Built on web standards with 11ty WebC templating, these components provide a foundation for creating modern, static websites.

## Features

- 🎨 **Styled with Design Tokens** - Consistent theming across components
- ♿ **Accessible by Default** - WCAG 2.1 AA compliant components
- 🚀 **Performance Optimized** - Minimal JavaScript, optimal CSS
- 📱 **Responsive** - Mobile-first design approach
- 🔧 **Customizable** - Override styles and behaviors easily
- 🧩 **Composable** - Mix and match components freely

## Installation

```bash
npm install @dwk/web-components
```

## Quick Start

### 1. Configure Eleventy

```javascript
// .eleventy.js or eleventy.config.js
const eleventyWebcPlugin = require('@11ty/eleventy-plugin-webc');

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(eleventyWebcPlugin, {
    components: ['src/_includes/**/*.webc', 'npm:@dwk/web-components/**/*.webc'],
  });

  return {
    dir: {
      input: 'src',
      output: '_site',
    },
  };
};
```

### 2. Use Components in Your Templates

```html
<!-- src/index.webc -->
<!DOCTYPE html>
<html>
  <head>
    <title>My Anglesite Website</title>
  </head>
  <body>
    <site-header logo="/logo.svg" site-name="My Site">
      <nav-menu>
        <nav-item href="/">Home</nav-item>
        <nav-item href="/about">About</nav-item>
        <nav-item href="/contact">Contact</nav-item>
      </nav-menu>
    </site-header>

    <hero-section
      title="Welcome to My Site"
      subtitle="Built with Anglesite and WebC"
      cta-text="Get Started"
      cta-href="/docs"
    >
    </hero-section>

    <content-grid>
      <content-card>
        <h3 slot="title">Feature One</h3>
        <p>Description of the first feature.</p>
      </content-card>

      <content-card>
        <h3 slot="title">Feature Two</h3>
        <p>Description of the second feature.</p>
      </content-card>
    </content-grid>

    <site-footer>
      <p slot="copyright">© 2024 My Company</p>
    </site-footer>
  </body>
</html>
```

## Component Catalog

### Layout Components

#### `<site-header>`

Main site header with logo and navigation support.

**Props:**

- `logo` (string) - Path to logo image
- `site-name` (string) - Site title text
- `sticky` (boolean) - Make header sticky

**Slots:**

- `default` - Navigation menu content

#### `<site-footer>`

Site footer with multiple content areas.

**Slots:**

- `links` - Footer navigation links
- `social` - Social media icons
- `copyright` - Copyright text

#### `<nav-menu>`

Responsive navigation menu with mobile support.

**Props:**

- `orientation` ('horizontal' | 'vertical') - Menu layout

### Content Components

#### `<hero-section>`

Full-width hero banner with call-to-action.

**Props:**

- `title` (string) - Main heading
- `subtitle` (string) - Subheading text
- `background` (string) - Background image URL
- `cta-text` (string) - Button text
- `cta-href` (string) - Button link

#### `<content-card>`

Flexible content card with optional media.

**Props:**

- `image` (string) - Card image URL
- `image-alt` (string) - Image alt text

**Slots:**

- `title` - Card title
- `default` - Card content
- `footer` - Card footer actions

#### `<content-grid>`

Responsive grid layout for content cards.

**Props:**

- `columns` (number) - Number of columns (1-4)
- `gap` (string) - Grid gap size

### Form Components

#### `<contact-form>`

Pre-styled contact form with validation.

**Props:**

- `action` (string) - Form submission endpoint
- `method` (string) - HTTP method

#### `<newsletter-signup>`

Email newsletter subscription component.

**Props:**

- `endpoint` (string) - Subscription API endpoint
- `placeholder` (string) - Input placeholder text

### Media Components

#### `<image-gallery>`

Responsive image gallery with lightbox.

**Props:**

- `images` (array) - Array of image objects

#### `<video-embed>`

Responsive video embed with privacy controls.

**Props:**

- `src` (string) - Video URL
- `provider` ('youtube' | 'vimeo') - Video platform

## Customization

### Design Tokens

Override default design tokens in your CSS:

```css
:root {
  /* Colors */
  --color-primary: #0066cc;
  --color-secondary: #6633cc;
  --color-accent: #00cccc;

  /* Typography */
  --font-family-base: system-ui, sans-serif;
  --font-family-heading: Georgia, serif;

  /* Spacing */
  --spacing-unit: 8px;
  --spacing-small: calc(var(--spacing-unit) * 2);
  --spacing-medium: calc(var(--spacing-unit) * 3);
  --spacing-large: calc(var(--spacing-unit) * 4);

  /* Breakpoints */
  --breakpoint-mobile: 640px;
  --breakpoint-tablet: 768px;
  --breakpoint-desktop: 1024px;
}
```

### Component Styling

Target component parts with CSS:

```css
/* Override component styles */
site-header {
  --header-bg: var(--color-primary);
  --header-text: white;
}

content-card {
  --card-border-radius: 12px;
  --card-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

## Development

### Local Development

```bash
# Clone the repository
git clone https://github.com/dwk/web-components.git
cd web-components

# Install dependencies
npm install

# Start development server
npm start

# Run tests
npm test

# Build for production
npm run build
```

### Creating New Components

1. Create component file: `src/components/my-component.webc`
2. Define component structure and styles
3. Add TypeScript types if needed
4. Write tests
5. Document in README

Example component:

```html
<!-- src/components/alert-box.webc -->
<div class="alert" :class="type">
  <slot name="icon"></slot>
  <div class="alert-content">
    <slot></slot>
  </div>
</div>

<style>
  .alert {
    padding: var(--spacing-medium);
    border-radius: 4px;
    margin: var(--spacing-medium) 0;
  }

  .alert.info {
    background: #e3f2fd;
    color: #1565c0;
  }

  .alert.warning {
    background: #fff3e0;
    color: #e65100;
  }

  .alert.error {
    background: #ffebee;
    color: #c62828;
  }
</style>

<script>
  // Client-side enhancements if needed
</script>
```

## Browser Support

Components are tested and supported in:

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Accessibility

All components follow WCAG 2.1 AA guidelines:

- Semantic HTML structure
- ARIA attributes where appropriate
- Keyboard navigation support
- Screen reader tested
- Color contrast compliant

## Performance

- Zero runtime JavaScript for most components
- CSS-only interactions where possible
- Lazy loading for images
- Optimized asset delivery

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Follow component patterns
4. Add tests (90% coverage required)
5. Update documentation
6. Submit a pull request

## License

ISC

## Related Packages

- `anglesite` - Desktop application for website creation
- `@dwk/anglesite-11ty` - Eleventy configuration package
- `@dwk/anglesite-starter` - Basic website template

## Support

- [Documentation](https://anglesite.io/docs/components)
- [GitHub Issues](https://github.com/dwk/web-components/issues)
- [Discord Community](https://discord.gg/anglesite) (Coming Soon)
