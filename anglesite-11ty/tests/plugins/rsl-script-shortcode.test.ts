/**
 * RSL Script Shortcode Tests
 * Tests for the rslScript shortcode that generates HTML script tags
 * containing RSL license information as JavaScript objects.
 */

// Mock fs module at the top level to ensure it's mocked before any imports
jest.mock('fs');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import addShortcodes from '../../plugins/shortcodes.js';
import type { RSLConfiguration } from '../../plugins/rsl/types.js';

interface MockEleventyContext {
  website?: {
    rsl?: RSLConfiguration;
    title?: string;
  };
  page?: {
    url?: string;
    inputPath?: string;
    outputPath?: string;
    date?: Date;
  };
  title?: string;
}

type ShortcodeFunction = (this: MockEleventyContext, ...args: unknown[]) => string;

const mockEleventyConfig = {
  shortcodes: new Map<string, ShortcodeFunction>(),
  addShortcode: jest.fn((name: string, fn: ShortcodeFunction) => {
    mockEleventyConfig.shortcodes.set(name, fn);
  }),
};

describe('RSL Script Shortcode', () => {
  let tempDir: string;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    // Use the real fs for creating temp directories
    const realFs = jest.requireActual('fs');
    tempDir = await realFs.promises.mkdtemp(path.join(os.tmpdir(), 'rsl-shortcode-'));

    jest.clearAllMocks();

    // Set up default mock behavior for fs.readFileSync to return real website.json content
    mockedFs.readFileSync.mockImplementation((filePath: any, encoding?: any) => {
      // For the website.json path, return the actual content
      if (typeof filePath === 'string' && filePath.endsWith('website.json')) {
        return realFs.readFileSync(filePath, encoding);
      }
      // For other files, just return empty string
      return '';
    });
  });

  afterEach(async () => {
    if (tempDir) {
      const realFs = jest.requireActual('fs');
      await realFs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('Shortcode Registration', () => {
    it('should register rslScript shortcode when addShortcodes is called', () => {
      addShortcodes(mockEleventyConfig as any);

      expect(mockEleventyConfig.addShortcode).toHaveBeenCalledWith('rslScript', expect.any(Function));
      expect(mockEleventyConfig.shortcodes.has('rslScript')).toBe(true);
    });
  });

  describe('Basic RSL Script Generation', () => {
    let rslScriptFn: ShortcodeFunction;

    beforeEach(() => {
      // Clear any existing mocks on fs before registering shortcodes
      jest.restoreAllMocks();
      addShortcodes(mockEleventyConfig as any);
      rslScriptFn = mockEleventyConfig.shortcodes.get('rslScript');
    });

    it('should generate script tag with default RSL license data', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            copyright: '© 2025 Test Site',
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view', 'download'] }],
              prohibits: [{ type: 'usage', values: ['commercial'] }],
              payment: { type: 'free', attribution: true },
            },
          },
        },
      };

      const result = rslScriptFn.call(context);

      expect(result).toContain('<script>');
      expect(result).toContain('window.rsl');
      expect(result).toContain('"permits"');
      expect(result).toContain('"prohibits"');
      expect(result).toContain('"payment"');
      expect(result).toContain('</script>');
    });

    it('should generate script with custom variable name', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
          },
        },
      };

      const result = rslScriptFn.call(context, '', 'myLicense');

      expect(result).toContain('window.myLicense');
      expect(result).not.toContain('window.rsl');
    });

    it('should return empty string when RSL is disabled', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: false,
          },
        },
      };

      const result = rslScriptFn.call(context);

      expect(result).toBe('');
    });

    it('should return empty string when no RSL configuration exists', () => {
      const context: MockEleventyContext = {
        website: {},
      };

      const result = rslScriptFn.call(context);

      expect(result).toBe('');
    });

    it('should return script tag using filesystem fallback when website is undefined', () => {
      const context: MockEleventyContext = {};

      const result = rslScriptFn.call(context);

      // The shortcode should fallback to reading website.json from filesystem
      expect(result).toContain('<script>window.rsl = {');
      expect(result).toContain('© 2025 Anglesite 11ty Website');
    });

    it('should return empty string when website is undefined and filesystem read fails', () => {
      const context: MockEleventyContext = {};

      // Override the mock to throw an error for this specific test
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      // Mock console.warn to silence expected warning
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = rslScriptFn.call(context);

      expect(result).toBe('');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'RSL Script Shortcode: Could not load website data:',
        expect.any(Error)
      );

      // Restore console mock
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Collection-Specific License Data', () => {
    let rslScriptFn: ShortcodeFunction;

    beforeEach(() => {
      addShortcodes(mockEleventyConfig as any);
      rslScriptFn = mockEleventyConfig.shortcodes.get('rslScript');
    });

    it('should generate script with collection-specific license', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            copyright: '© 2025 Test Site',
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
            collections: {
              blog: {
                enabled: true,
                permits: [{ type: 'usage', values: ['view', 'download', 'modify'] }],
                standard: 'https://creativecommons.org/licenses/by/4.0/',
              },
            },
          },
        },
      };

      const result = rslScriptFn.call(context, 'blog');

      expect(result).toContain('<script>');
      expect(result).toContain('window.rsl');
      expect(result).toContain('modify');
      expect(result).toContain('creativecommons.org');
    });

    it('should fall back to default license for nonexistent collection', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
            collections: {
              blog: {
                enabled: true,
                permits: [{ type: 'usage', values: ['modify'] }],
              },
            },
          },
        },
      };

      const result = rslScriptFn.call(context, 'nonexistent');

      expect(result).toContain('view');
      expect(result).not.toContain('modify');
    });
  });

  describe('HTML Escaping and Security', () => {
    let rslScriptFn: ShortcodeFunction;

    beforeEach(() => {
      addShortcodes(mockEleventyConfig as any);
      rslScriptFn = mockEleventyConfig.shortcodes.get('rslScript');
    });

    it('should properly escape script tags in license data', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            copyright: '© 2025 Test Site</script><script>alert("xss")</script>',
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
          },
        },
      };

      const result = rslScriptFn.call(context);

      expect(result).not.toContain('</script><script>alert("xss")');
      expect(result).not.toContain('alert("xss")');
      expect(result).toMatch(/window\.rsl\s*=\s*{/);
    });

    it('should handle quotes and special characters in license data', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            copyright: 'Test "quotes" and \'apostrophes\' & ampersands',
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
          },
        },
      };

      const result = rslScriptFn.call(context);

      expect(result).toContain('<script>');
      expect(result).toContain('</script>');
      // Should be valid JSON
      const scriptMatch = result.match(/window\.rsl\s*=\s*({.*?});/s);
      expect(scriptMatch).toBeTruthy();
      if (scriptMatch) {
        expect(() => JSON.parse(scriptMatch[1])).not.toThrow();
      }
    });
  });

  describe('Parameter Validation', () => {
    let rslScriptFn: ShortcodeFunction;

    beforeEach(() => {
      addShortcodes(mockEleventyConfig as any);
      rslScriptFn = mockEleventyConfig.shortcodes.get('rslScript');
    });

    it('should reject invalid JavaScript identifier variable names', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
          },
        },
      };

      // Invalid variable names should either be rejected or cause fallback
      const invalidNames = ['123invalid', 'var-name', 'function', 'class', ''];

      invalidNames.forEach((invalidName) => {
        const result = rslScriptFn.call(context, '', invalidName);
        // Either empty (rejected) or uses default variable name
        expect(result === '' || result.includes('window.rsl')).toBe(true);
      });
    });

    it('should accept valid JavaScript identifier variable names', () => {
      const context: MockEleventyContext = {
        website: {
          rsl: {
            enabled: true,
            defaultLicense: {
              permits: [{ type: 'usage', values: ['view'] }],
            },
          },
        },
      };

      const validNames = ['myLicense', 'license_data', 'rslInfo', '_private', '$special'];

      validNames.forEach((validName) => {
        const result = rslScriptFn.call(context, '', validName);
        expect(result).toContain(`window.${validName}`);
      });
    });
  });
});
