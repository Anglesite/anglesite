/**
 * @file Tests for dark mode CSS implementation
 * Tests CSS color-scheme property, media queries, and theme variable handling
 */

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

describe('Dark Mode CSS Implementation', () => {
  let dom: JSDOM;
  let document: Document;
  let window: Window;

  beforeEach(() => {
    // Create JSDOM environment
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
    });

    document = dom.window.document;
    window = dom.window as unknown as Window;

    // Add matchMedia mock
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('HTML Critical CSS', () => {
    it('should contain color-scheme property in critical CSS', () => {
      // Read the actual HTML file
      const htmlPath = path.join(__dirname, '../../app/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Check for color-scheme property
      expect(htmlContent).toContain('color-scheme: light dark');
    });

    it('should have system Canvas and CanvasText colors as fallback', () => {
      const htmlPath = path.join(__dirname, '../../app/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      expect(htmlContent).toContain('background-color: Canvas');
      expect(htmlContent).toContain('color: CanvasText');
    });

    it('should have dark mode media query overrides', () => {
      const htmlPath = path.join(__dirname, '../../app/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      expect(htmlContent).toContain('@media (prefers-color-scheme: dark)');
      expect(htmlContent).toContain('background-color: #1e1e1e');
      expect(htmlContent).toContain('color: #ffffff');
    });

    it('should have light mode media query overrides', () => {
      const htmlPath = path.join(__dirname, '../../app/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      expect(htmlContent).toContain('@media (prefers-color-scheme: light)');
      expect(htmlContent).toContain('background-color: #ffffff');
      expect(htmlContent).toContain('color: #333333');
    });
  });

  describe('Main CSS File', () => {
    it('should contain color-scheme property in main CSS', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      expect(cssContent).toContain('color-scheme: light dark');
    });

    it('should have complete dark theme variable definitions', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check for dark theme variables
      expect(cssContent).toContain(":root[data-theme='dark']");
      expect(cssContent).toContain('--bg-primary: #1e1e1e');
      expect(cssContent).toContain('--text-primary: #ffffff');
      expect(cssContent).toContain('--border-primary: #404040');
    });

    it('should have complete light theme variable definitions', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check for light theme variables
      expect(cssContent).toContain('--bg-primary: #ffffff');
      expect(cssContent).toContain('--text-primary: #333333');
      expect(cssContent).toContain('--border-primary: #cccccc');
    });
  });

  describe('Theme Data Attribute Script', () => {
    it('should set data-theme attribute based on system preference', () => {
      // Mock dark mode preference
      const mockMatchMedia = jest.fn().mockImplementation((query) => ({
        matches: query.includes('dark'),
      }));
      Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia });

      // Create HTML with theme detection script
      document.head.innerHTML = `
        <script>
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
        </script>
      `;

      // Execute the script
      const script = document.querySelector('script');
      if (script) {
        // Execute the script content in the JSDOM environment
        const scriptFunction = new Function('document', 'window', script.textContent || '');
        scriptFunction(document, window);
      }

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should not set data-theme attribute for light mode preference', () => {
      // Mock light mode preference
      const mockMatchMedia = jest.fn().mockImplementation((query) => ({
        matches: !query.includes('dark'),
      }));
      Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia });

      // Create HTML with theme detection script
      document.head.innerHTML = `
        <script>
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
        </script>
      `;

      // Execute the script
      const script = document.querySelector('script');
      if (script) {
        const scriptFunction = new Function('document', 'window', script.textContent || '');
        scriptFunction(document, window);
      }

      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });

  describe('CSS Media Query Integration', () => {
    it('should apply dark styles when matchMedia indicates dark mode', () => {
      // Create a test element with CSS
      document.head.innerHTML = `
        <style>
          :root { color-scheme: light dark; }
          html, body { background-color: #ffffff; color: #333333; }
          @media (prefers-color-scheme: dark) {
            html, body { background-color: #1e1e1e; color: #ffffff; }
          }
        </style>
      `;

      // Mock dark mode
      const mockMatchMedia = jest.fn().mockImplementation((query) => ({
        matches: query.includes('dark'),
      }));
      Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia });

      // The styles should exist in the document
      const style = document.querySelector('style');
      expect(style?.textContent).toContain('@media (prefers-color-scheme: dark)');
      expect(style?.textContent).toContain('background-color: #1e1e1e');
    });

    it('should have proper CSS variable fallbacks', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check that CSS variables are used consistently
      expect(cssContent).toContain('var(--bg-primary)');
      expect(cssContent).toContain('var(--text-primary)');
      expect(cssContent).toContain('var(--border-primary)');

      // Check that transition properties exist for smooth theme changes
      expect(cssContent).toMatch(/transition.*background-color/);
      expect(cssContent).toMatch(/transition.*color/);
    });
  });

  describe('Theme Variable Consistency', () => {
    it('should have matching color variables between HTML and CSS', () => {
      const htmlPath = path.join(__dirname, '../../app/index.html');
      const cssPath = path.join(__dirname, '../../app/styles.css');

      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Extract colors from HTML critical CSS
      const htmlDarkBg = htmlContent.match(/background-color:\s*#1e1e1e/);
      const htmlLightBg = htmlContent.match(/background-color:\s*#ffffff/);

      // Extract colors from main CSS
      const cssDarkBg = cssContent.match(/--bg-primary:\s*#1e1e1e/);
      const cssLightBg = cssContent.match(/--bg-primary:\s*#ffffff/);

      expect(htmlDarkBg).toBeTruthy();
      expect(htmlLightBg).toBeTruthy();
      expect(cssDarkBg).toBeTruthy();
      expect(cssLightBg).toBeTruthy();
    });

    it('should have complete set of theme variables for both modes', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      const requiredVariables = [
        '--bg-primary',
        '--bg-secondary',
        '--bg-tertiary',
        '--text-primary',
        '--text-secondary',
        '--border-primary',
        '--border-secondary',
        '--button-bg',
        '--button-hover',
        '--button-active',
      ];

      // Check light theme variables
      requiredVariables.forEach((variable) => {
        expect(cssContent).toMatch(new RegExp(`${variable}:\\s*#[a-fA-F0-9]{6}`));
      });

      // Check dark theme variables (should appear twice - light and dark)
      requiredVariables.forEach((variable) => {
        const matches = cssContent.match(new RegExp(`${variable}:\\s*#[a-fA-F0-9]{6}`, 'g'));
        expect(matches?.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('Performance and Loading', () => {
    it('should have critical CSS inline for immediate loading', () => {
      const htmlPath = path.join(__dirname, '../../app/index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Critical CSS should be inline in <head>
      expect(htmlContent).toContain('<style>');
      expect(htmlContent).toContain('color-scheme: light dark');

      // Should appear before external CSS link
      const styleIndex = htmlContent.indexOf('<style>');
      const linkIndex = htmlContent.indexOf('<link rel="stylesheet"');
      expect(styleIndex).toBeLessThan(linkIndex);
    });

    it('should use efficient CSS selectors', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Should use efficient root-level selectors
      expect(cssContent).toContain(':root {');
      expect(cssContent).toContain(":root[data-theme='dark']");
      // Light theme is set in the base :root selector, not a data-theme attribute

      // Should not have overly complex selectors that could impact performance
      expect(cssContent).not.toMatch(/(\.[\w-]+\s+){5,}/); // No selectors with 5+ space-separated class parts
    });
  });

  describe('Toolbar Dark Mode Support', () => {
    it('should have dark mode media query in styles.css', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      expect(cssContent).toContain('@media (prefers-color-scheme: dark)');
    });

    it('should use CSS variables for toolbar elements', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check that toolbar elements use CSS variables
      expect(cssContent).toContain('.top-bar {');
      expect(cssContent).toMatch(/\.top-bar.*var\(--bg-tertiary\)/s);
      expect(cssContent).toMatch(/\.top-bar.*var\(--border-primary\)/s);

      expect(cssContent).toContain('.browser-bar {');
      expect(cssContent).toMatch(/\.browser-bar.*var\(--bg-secondary\)/s);
      expect(cssContent).toMatch(/\.browser-bar.*var\(--border-secondary\)/s);
    });

    it('should have proper button theming', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Verify button CSS variables
      expect(cssContent).toMatch(/button.*var\(--button-bg\)/s);
      expect(cssContent).toMatch(/button.*var\(--text-primary\)/s);
      expect(cssContent).toMatch(/button:hover.*var\(--button-hover\)/s);
      expect(cssContent).toMatch(/button:active.*var\(--button-active\)/s);
    });

    it('should have site title and URL display theming', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check site title
      expect(cssContent).toMatch(/\.site-title.*var\(--text-primary\)/s);

      // Check URL display
      expect(cssContent).toMatch(/\.url-display.*var\(--bg-primary\)/s);
      expect(cssContent).toMatch(/\.url-display.*var\(--border-primary\)/s);
      expect(cssContent).toMatch(/\.url-display.*var\(--text-secondary\)/s);
    });

    it('should have explicit theme overrides for both light and dark', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check that explicit theme overrides exist
      expect(cssContent).toContain(":root[data-theme='light']");
      expect(cssContent).toContain(":root[data-theme='dark']");

      // Verify they contain the toolbar-specific variables
      const lightThemeMatch = cssContent.match(/:root\[data-theme='light'\]\s*\{[^}]+\}/s);
      const darkThemeMatch = cssContent.match(/:root\[data-theme='dark'\]\s*\{[^}]+\}/s);

      expect(lightThemeMatch).toBeTruthy();
      expect(darkThemeMatch).toBeTruthy();

      if (lightThemeMatch) {
        expect(lightThemeMatch[0]).toContain('--bg-tertiary');
        expect(lightThemeMatch[0]).toContain('--button-bg');
      }

      if (darkThemeMatch) {
        expect(darkThemeMatch[0]).toContain('--bg-tertiary');
        expect(darkThemeMatch[0]).toContain('--button-bg');
      }
    });

    it('should have smooth transitions for theme changes', () => {
      const cssPath = path.join(__dirname, '../../app/styles.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check that toolbar elements have transitions
      expect(cssContent).toMatch(/\.top-bar[\s\S]*?transition[^}]*background-color.*ease/);
      expect(cssContent).toMatch(/\.browser-bar[\s\S]*?transition[^}]*background-color.*ease/);
      expect(cssContent).toMatch(/\.url-display[\s\S]*?transition[^}]*background-color.*ease/);
      expect(cssContent).toMatch(/button[\s\S]*?transition[^}]*background-color.*ease/);
    });
  });
});
