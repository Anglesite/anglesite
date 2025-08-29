import { writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { generateBrowserConfig } from '../../plugins/browserconfig';
import addBrowserConfig from '../../plugins/browserconfig';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockImplementation((filePath) => {
    // Mock that images exist except for nonexistent ones
    return !filePath.includes('nonexistent');
  }),
  promises: {
    readFile: jest.fn(),
  },
}));

describe('browserconfig plugin', () => {
  const mockEleventyConfig = {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_includes',
      data: '_data',
    },
    on: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('generateBrowserConfig', () => {
    it('should return empty string when not enabled', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: false,
        },
      };

      expect(generateBrowserConfig(data)).toBe('');
    });

    it('should return empty string when no website data', () => {
      expect(generateBrowserConfig(null as unknown as AnglesiteWebsiteConfiguration)).toBe('');
    });

    it('should return empty string when no browserconfig config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      expect(generateBrowserConfig(data)).toBe('');
    });

    it('should return empty string when browserconfig is enabled but tile is missing', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: true,
        },
      };

      expect(generateBrowserConfig(data)).toBe('');
    });

    it('should generate basic browserconfig with a tile', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: true,
          tile: {
            square150x150logo: '/assets/images/tile.png',
            TileColor: '#ff0000',
          },
        },
      };

      const result = generateBrowserConfig(data);
      expect(result).toContain('<square150x150logo src="/assets/images/tile.png"/>');
      expect(result).toContain('<TileColor>#ff0000</TileColor>');
    });

    it('should generate a full browserconfig with all tile properties', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: true,
          tile: {
            square70x70logo: '/assets/images/tile-small.png',
            square150x150logo: '/assets/images/tile-medium.png',
            wide310x150logo: '/assets/images/tile-wide.png',
            square310x310logo: '/assets/images/tile-large.png',
            TileColor: '#da532c',
          },
        },
      };

      const result = generateBrowserConfig(data);
      expect(result).toContain('<square70x70logo src="/assets/images/tile-small.png"/>');
      expect(result).toContain('<square150x150logo src="/assets/images/tile-medium.png"/>');
      expect(result).toContain('<wide310x150logo src="/assets/images/tile-wide.png"/>');
      expect(result).toContain('<square310x310logo src="/assets/images/tile-large.png"/>');
      expect(result).toContain('<TileColor>#da532c</TileColor>');
    });

    it('should escape XML special characters in URLs', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: true,
          tile: {
            square150x150logo: '/assets/images/tile&special<>.png',
            square70x70logo: '/assets/images/tile"quotes\'.png',
            TileColor: '#ff0000',
          },
        },
      };

      const result = generateBrowserConfig(data);
      expect(result).toContain('tile&amp;special&lt;&gt;.png');
      expect(result).toContain('tile&quot;quotes&apos;.png');
      expect(result).not.toContain('tile&special');
      expect(result).not.toContain('<>');
    });

    it('should handle invalid TileColor format', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: true,
          tile: {
            square150x150logo: '/assets/images/tile.png',
            TileColor: 'invalid-color',
          },
        },
      };

      const result = generateBrowserConfig(data);
      expect(result).toBe('');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] BrowserConfig: Invalid TileColor format: invalid-color')
      );
      consoleSpy.mockRestore();
    });

    it('should accept valid hex color formats', () => {
      const testCases = [
        { color: '#ff0000', description: '6-digit hex' },
        { color: '#f00', description: '3-digit hex' },
        { color: '#FF00AA', description: 'uppercase hex' },
        { color: '#aAbBcC', description: 'mixed case hex' },
      ];

      testCases.forEach(({ color }) => {
        const data: AnglesiteWebsiteConfiguration = {
          title: 'Test Site',
          language: 'en',
          browserconfig: {
            enabled: true,
            tile: {
              square150x150logo: '/assets/images/tile.png',
              TileColor: color,
            },
          },
        };

        const result = generateBrowserConfig(data);
        expect(result).toContain(`<TileColor>${color}</TileColor>`);
      });
    });

    it('should handle malformed input gracefully', () => {
      const testCases = [
        {
          name: 'null website config',
          data: null as unknown as AnglesiteWebsiteConfiguration,
        },
        {
          name: 'undefined website config',
          data: undefined as unknown as AnglesiteWebsiteConfiguration,
        },
        {
          name: 'empty object',
          data: {} as AnglesiteWebsiteConfiguration,
        },
        {
          name: 'missing tile config',
          data: {
            title: 'Test',
            language: 'en',
            browserconfig: { enabled: true },
          } as AnglesiteWebsiteConfiguration,
        },
      ];

      testCases.forEach(({ name, data }) => {
        const result = generateBrowserConfig(data);
        expect(result).toBe('', `Failed for test case: ${name}`);
      });
    });

    it('should validate image paths and exclude missing images', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        browserconfig: {
          enabled: true,
          tile: {
            square70x70logo: '/assets/images/tile-small.png', // exists
            square150x150logo: '/assets/images/nonexistent-tile.png', // doesn't exist
            wide310x150logo: '/assets/images/tile-wide.png', // exists
            TileColor: '#ff0000',
          },
        },
      };

      const result = generateBrowserConfig(data);

      // Should include existing images
      expect(result).toContain('<square70x70logo src="/assets/images/tile-small.png"/>');
      expect(result).toContain('<wide310x150logo src="/assets/images/tile-wide.png"/>');
      expect(result).toContain('<TileColor>#ff0000</TileColor>');

      // Should not include missing image
      expect(result).not.toContain('nonexistent-tile.png');

      // Should warn about missing image
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] BrowserConfig: Image not found:')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('addBrowserConfig plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addBrowserConfig(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write .well-known/browserconfig.xml file', async () => {
      addBrowserConfig(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                browserconfig: {
                  enabled: true,
                  tile: {
                    square150x150logo: '/assets/images/tile.png',
                    TileColor: '#ff0000',
                  },
                },
              },
            },
          },
        ],
      });

      expect(mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'browserconfig.xml'),
        expect.stringContaining('<TileColor>#ff0000</TileColor>')
      );
    });

    it('should not write file if browserconfig is not enabled', async () => {
      addBrowserConfig(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                browserconfig: {
                  enabled: false,
                },
              },
            },
          },
        ],
      });

      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle file system errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (writeFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      addBrowserConfig(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                browserconfig: {
                  enabled: true,
                  tile: {
                    square150x150logo: '/assets/images/tile.png',
                  },
                },
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[@dwk/anglesite-11ty] Failed to write .well-known/browserconfig.xml: Permission denied'
        )
      );

      consoleSpy.mockRestore();
    });

    it('should not write file if no website data in results', async () => {
      addBrowserConfig(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [{ inputPath: 'index.html' }], // No `data` property
      });

      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('should find website data from any result in the cascade', async () => {
      addBrowserConfig(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          { inputPath: 'page1.html' }, // No data
          { inputPath: 'page2.html', data: {} }, // Empty data
          {
            inputPath: 'page3.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                browserconfig: {
                  enabled: true,
                  tile: {
                    square150x150logo: '/assets/images/tile.png',
                    TileColor: '#ff0000',
                  },
                },
              },
            },
          },
        ],
      });

      expect(writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'browserconfig.xml'),
        expect.stringContaining('<TileColor>#ff0000</TileColor>')
      );
    });

    it('should handle concurrent writes gracefully', async () => {
      addBrowserConfig(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          callback({
            dir: { output: '_site' },
            results: [
              {
                inputPath: 'index.html',
                data: {
                  website: {
                    title: 'Test Site',
                    language: 'en',
                    browserconfig: {
                      enabled: true,
                      tile: {
                        square150x150logo: `/assets/images/tile-${i}.png`,
                        TileColor: '#ff0000',
                      },
                    },
                  },
                },
              },
            ],
          })
        );
      }

      await Promise.all(promises);
      expect(writeFileSync).toHaveBeenCalledTimes(5);
    });

    it('should handle missing output directory gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (mkdirSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Cannot create directory');
      });

      addBrowserConfig(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                browserconfig: {
                  enabled: true,
                  tile: {
                    square150x150logo: '/assets/images/tile.png',
                  },
                },
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[@dwk/anglesite-11ty] Failed to write .well-known/browserconfig.xml: Cannot create directory'
        )
      );
      consoleSpy.mockRestore();
    });
  });
});
