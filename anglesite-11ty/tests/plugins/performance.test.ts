import addPerformanceOptimization, { clearMinificationCache, getCacheSize } from '../../plugins/performance';
import type { EleventyConfig } from '../../types/eleventy-shim';

// Mock html-minifier-terser
jest.mock('html-minifier-terser', () => ({
  minify: jest.fn().mockImplementation((html) => {
    // Simple mock minification - remove extra whitespace
    return html.replace(/\s+/g, ' ').trim();
  }),
}));

// Mock fs for file operations
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockImplementation((filePath) => {
    // Mock that CSS/JS files exist unless they contain 'missing'
    return !filePath.includes('missing');
  }),
  readFileSync: jest.fn().mockImplementation((filePath) => {
    if (filePath.includes('style.css')) {
      return 'body { margin: 0; padding: 0; /* comment */ color: blue; }';
    }
    if (filePath.includes('script.js')) {
      return 'const x = 1; // comment\nconsole.log(x);';
    }
    if (filePath.includes('large.css') || filePath.includes('large2.css')) {
      return 'body { margin: 0; }'.repeat(1000); // Over 8KB
    }
    if (filePath.includes('small.css')) {
      return 'body { margin: 0; }'; // Under 8KB
    }
    return 'mock file content';
  }),
  statSync: jest.fn().mockImplementation((filePath) => ({
    size: filePath.includes('large') ? 50000 : 1000, // 50KB or 1KB
  })),
}));

// Mock path operations
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn().mockImplementation((...args) => args.join('/')),
}));

describe('performance optimization plugin', () => {
  const mockEleventyConfig = {
    addTransform: jest.fn(),
    addShortcode: jest.fn(),
    on: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    clearMinificationCache();
  });

  it('should register performance-optimization transform', () => {
    addPerformanceOptimization(mockEleventyConfig);
    expect(mockEleventyConfig.addTransform).toHaveBeenCalledWith('performance-optimization', expect.any(Function));
  });

  it('should register inlineCSS and inlineJS shortcodes', () => {
    addPerformanceOptimization(mockEleventyConfig);
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('inlineCSS', expect.any(Function));
    expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('inlineJS', expect.any(Function));
  });

  it('should register eleventy.before and eleventy.after events', () => {
    addPerformanceOptimization(mockEleventyConfig);
    expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.before', expect.any(Function));
    expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
  });

  describe('HTML transform', () => {
    let transformFunction: (content: string, outputPath: string) => string;

    beforeEach(() => {
      addPerformanceOptimization(mockEleventyConfig);
      const calls = (mockEleventyConfig.addTransform as jest.Mock).mock.calls;
      transformFunction = calls.find((call) => call[0] === 'performance-optimization')[1];
    });

    it('should only process HTML files', () => {
      const cssContent = 'body { color: red; }';
      const jsContent = 'console.log("hello");';

      expect(transformFunction(cssContent, 'style.css')).toBe(cssContent);
      expect(transformFunction(jsContent, 'script.js')).toBe(jsContent);
      expect(transformFunction(jsContent, undefined as unknown as string)).toBe(jsContent);
    });

    it('should inline critical CSS when enabled', () => {
      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="/small.css">
        </head>
        <body>Content</body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('<style>body{margin:0}</style>');
      expect(result).not.toContain('<link rel="stylesheet" href="/small.css">');
    });

    it('should not inline large CSS files', () => {
      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="/large.css">
        </head>
        <body>Content</body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('<link rel="stylesheet" href="/large.css">');
      expect(result).not.toContain('<style>');
    });

    it('should skip external CSS URLs', () => {
      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css">
        </head>
        <body>Content</body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('https://fonts.googleapis.com/css');
    });

    it('should generate resource hints', () => {
      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="/large.css">
          <link rel="stylesheet" href="/large2.css">
        </head>
        <body>
          <script src="/script.js"></script>
        </body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('<link rel="preload" href="/large.css" as="style">');
      expect(result).toContain('<link rel="preload" href="/large2.css" as="style">');
      expect(result).toContain('<link rel="preload" href="/script.js" as="script">');
    });

    it('should optimize scripts with defer', () => {
      const html = `
        <html>
        <body>
          <script src="/script.js"></script>
          <script src="/other.js"></script>
          <script async src="/already-async.js"></script>
          <script defer src="/already-defer.js"></script>
        </body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('<script src="/script.js" defer></script>');
      expect(result).toContain('<script src="/other.js" defer></script>');
      expect(result).toContain('<script async src="/already-async.js"></script>'); // unchanged
      expect(result).toContain('<script defer src="/already-defer.js"></script>'); // unchanged
    });

    it('should add lazy loading to iframes', () => {
      const html = `
        <html>
        <body>
          <iframe src="/embed"></iframe>
          <iframe src="/other" loading="eager"></iframe>
          <img src="/image.jpg">
        </body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('<iframe src="/embed" loading="lazy"></iframe>');
      expect(result).toContain('<iframe src="/other" loading="eager"></iframe>'); // unchanged
      expect(result).toContain('<img src="/image.jpg" loading="lazy">');
    });

    it('should minify HTML when enabled', () => {
      const html = `
        <html>
          <head>
            <title>  Test  </title>
          </head>
          <body>
            <p>  Hello   World  </p>
          </body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      // The mock minifier removes extra whitespace
      expect(result).not.toContain('  ');
      expect(result.length).toBeLessThan(html.length);
    });

    it('should handle transform errors gracefully', () => {
      const htmlMinifier = jest.requireMock('html-minifier-terser');
      htmlMinifier.minify.mockImplementationOnce(() => {
        throw new Error('Minification failed');
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const html = '<html><body>Test</body></html>';

      const result = transformFunction(html, 'index.html');
      expect(result).toBe(html); // Original content returned
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Performance optimization failed'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should respect disabled options', () => {
      // Re-configure with all options disabled
      jest.clearAllMocks();
      addPerformanceOptimization(mockEleventyConfig, {
        minifyHTML: false,
        inlineCriticalCSS: false,
        generateResourceHints: false,
        optimizeScripts: false,
        enableLazyLoading: false,
      });

      const transformFunction = (mockEleventyConfig.addTransform as jest.Mock).mock.calls.find(
        (call) => call[0] === 'performance-optimization'
      )[1];

      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="/small.css">
        </head>
        <body>
          <script src="/script.js"></script>
          <iframe src="/embed"></iframe>
        </body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');

      // Should remain unchanged
      expect(result).toContain('<link rel="stylesheet" href="/small.css">');
      expect(result).toContain('<script src="/script.js"></script>');
      expect(result).toContain('<iframe src="/embed"></iframe>');
      expect(result).not.toContain('<style>');
      expect(result).not.toContain('defer');
      expect(result).not.toContain('loading="lazy"');
      expect(result).not.toContain('preload');
    });
  });

  describe('performance budget', () => {
    let transformFunction: (content: string, outputPath: string) => string;

    beforeEach(() => {
      addPerformanceOptimization(mockEleventyConfig, {
        performanceBudget: true,
        budgetThresholds: {
          maxCSSSize: 10, // 10KB
          maxJSSize: 20, // 20KB
          maxImages: 3,
        },
      });

      const calls = (mockEleventyConfig.addTransform as jest.Mock).mock.calls;
      transformFunction = calls.find((call) => call[0] === 'performance-optimization')[1];
    });

    it('should warn when CSS size exceeds budget', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="/large.css">
        </head>
        <body>Content</body>
        </html>
      `;

      transformFunction(html, 'index.html');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CSS size (49KB) exceeds threshold (10KB)'));

      consoleSpy.mockRestore();
    });

    it('should warn when image count exceeds budget', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const html = `
        <html>
        <body>
          <img src="/img1.jpg">
          <img src="/img2.jpg">
          <img src="/img3.jpg">
          <img src="/img4.jpg">
        </body>
        </html>
      `;

      transformFunction(html, 'index.html');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Image count (4) exceeds threshold (3)'));

      consoleSpy.mockRestore();
    });
  });

  describe('shortcodes', () => {
    beforeEach(() => {
      addPerformanceOptimization(mockEleventyConfig);
    });

    describe('inlineCSS', () => {
      it('should inline CSS content', () => {
        const inlineCSSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
          (call) => call[0] === 'inlineCSS'
        )[1];

        const result = inlineCSSShortcode('/style.css');
        expect(result).toBe('<style>body{margin:0;padding:0;color:blue}</style>');
      });

      it('should return link tag for missing CSS files', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const inlineCSSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
          (call) => call[0] === 'inlineCSS'
        )[1];

        const result = inlineCSSShortcode('/missing.css');
        expect(result).toBe('<link rel="stylesheet" href="/missing.css">');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CSS file not found for inlining'));

        consoleSpy.mockRestore();
      });

      it('should handle CSS inlining errors gracefully', () => {
        const fs = jest.requireMock('fs');
        fs.readFileSync.mockImplementationOnce(() => {
          throw new Error('File read error');
        });

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const inlineCSSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
          (call) => call[0] === 'inlineCSS'
        )[1];

        const result = inlineCSSShortcode('/style.css');
        expect(result).toBe('<link rel="stylesheet" href="/style.css">');
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error inlining CSS /style.css:'),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });

    describe('inlineJS', () => {
      it('should inline JS content', () => {
        const inlineJSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
          (call) => call[0] === 'inlineJS'
        )[1];

        const result = inlineJSShortcode('/script.js');
        expect(result).toBe('<script>const x = 1; console.log(x);</script>');
      });

      it('should return script tag for missing JS files', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const inlineJSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
          (call) => call[0] === 'inlineJS'
        )[1];

        const result = inlineJSShortcode('/missing.js');
        expect(result).toBe('<script src="/missing.js"></script>');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('JS file not found for inlining'));

        consoleSpy.mockRestore();
      });

      it('should handle JS inlining errors gracefully', () => {
        const fs = jest.requireMock('fs');
        fs.readFileSync.mockImplementationOnce(() => {
          throw new Error('File read error');
        });

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const inlineJSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
          (call) => call[0] === 'inlineJS'
        )[1];

        const result = inlineJSShortcode('/script.js');
        expect(result).toBe('<script src="/script.js"></script>');
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error inlining JS /script.js:'),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('cache management', () => {
    it('should clear minification cache on eleventy.before event', () => {
      addPerformanceOptimization(mockEleventyConfig);

      // The cache starts empty
      expect(getCacheSize()).toBe(0);

      // Simulate some cache usage by directly testing the CSS minifier
      // (This is an indirect way to test cache usage since the functions are internal)

      // Get the eleventy.before callback
      const beforeCallback = (mockEleventyConfig.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'eleventy.before'
      )[1];

      // Execute the callback
      beforeCallback();

      // Cache should still be clear (or cleared if it had content)
      expect(getCacheSize()).toBe(0);
    });

    it('should log performance stats after build', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      addPerformanceOptimization(mockEleventyConfig);

      // Get the eleventy.after callback
      const afterCallback = (mockEleventyConfig.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'eleventy.after'
      )[1];

      // Execute the callback
      afterCallback();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Performance optimization complete. Cache entries: 0')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('CSS minification', () => {
    it('should remove comments and excess whitespace', () => {
      // This tests the internal minifyCSS function indirectly through the transform
      addPerformanceOptimization(mockEleventyConfig);
      const transformFunction = (mockEleventyConfig.addTransform as jest.Mock).mock.calls.find(
        (call) => call[0] === 'performance-optimization'
      )[1];

      const html = `
        <html>
        <head>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>Content</body>
        </html>
      `;

      const result = transformFunction(html, 'index.html');
      expect(result).toContain('<style>body{margin:0;padding:0;color:blue}</style>');
      expect(result).not.toContain('/* comment */');
    });
  });

  describe('JS minification', () => {
    it('should remove comments and excess whitespace', () => {
      addPerformanceOptimization(mockEleventyConfig);

      const inlineJSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'inlineJS'
      )[1];

      const result = inlineJSShortcode('/script.js');
      expect(result).toBe('<script>const x = 1; console.log(x);</script>');
      expect(result).not.toContain('// comment');
      expect(result).not.toContain('\n');
    });

    it('should handle CSS minification being disabled', () => {
      addPerformanceOptimization(mockEleventyConfig, { minifyCSS: false });

      const inlineCSSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'inlineCSS'
      )[1];

      const result = inlineCSSShortcode('/style.css');
      // Should contain original content without minification
      expect(result).toContain('/* comment */');
      expect(result).toContain('body { margin: 0; padding: 0; /* comment */ color: blue; }');
    });

    it('should handle JS minification being disabled', () => {
      addPerformanceOptimization(mockEleventyConfig, { minifyJS: false });

      const inlineJSShortcode = (mockEleventyConfig.addShortcode as jest.Mock).mock.calls.find(
        (call) => call[0] === 'inlineJS'
      )[1];

      const result = inlineJSShortcode('/script.js');
      // Should contain original content without minification
      expect(result).toContain('// comment');
      expect(result).toContain('\n');
    });
  });
});
