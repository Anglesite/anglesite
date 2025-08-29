# @dwk/web-components

This project provides a collection of reusable web components built with 11ty
WebC templating. These components are designed for use with Anglesite created websites.

## Getting Started

To start working with the components, clone this repository and run:

```bash
npm install
npm start
```

## Using the Components

To use a component in your project, use NPM to add `@dwk/web-components` and
modify your 11ty config as follows:

```javascript
import eleventyWebcPlugin from '@11ty/eleventy-plugin-webc';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(eleventyWebcPlugin, {
    components: ['src/_includes/**/*.webc', 'npm:@dwk/web-components/**/*.webc'],
  });
}
```
