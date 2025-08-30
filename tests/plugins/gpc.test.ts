import * as fs from 'fs';
import * as path from 'path';
import { generateGpcJson } from '../../plugins/gpc';
import addGpcJson from '../../plugins/gpc';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('gpc plugin', () => {
  const mockEleventyConfig = {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_includes',
      data: '_data',
    },
    on: jest.fn(),
    addPlugin: jest.fn(),
    addBundle: jest.fn(),
    setFreezeReservedData: jest.fn(),
    addPassthroughCopy: jest.fn(),
    addLayoutAlias: jest.fn(),
    setDataFileBaseName: jest.fn(),
    addJavaScriptFunction: jest.fn(),
    addShortcode: jest.fn(),
    addFilter: jest.fn(),
    addTransform: jest.fn(),
    addTemplateFormats: jest.fn(),
    addExtension: jest.fn(),
    setUseGitIgnore: jest.fn(),
    setUseEditorIgnore: jest.fn(),
    addCollection: jest.fn(),
    addTemplate: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('generateGpcJson', () => {
    it('should return null when no website data', () => {
      expect(generateGpcJson(null as unknown as AnglesiteWebsiteConfiguration)).toBe(null);
    });

    it('should return null when website is undefined', () => {
      expect(generateGpcJson(undefined as unknown as AnglesiteWebsiteConfiguration)).toBe(null);
    });

    it('should return null when no gpc config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      const result = generateGpcJson(data);
      expect(result).toBe(null);
    });

    it('should return null when gpc is not enabled', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        gpc: {
          gpc: true,
          enabled: false,
        },
      };

      const result = generateGpcJson(data);
      expect(result).toBe(null);
    });

    it('should generate basic GPC JSON with gpc: true', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        gpc: {
          gpc: true,
          enabled: true,
        },
      };

      const result = generateGpcJson(data);
      expect(result).toEqual({
        gpc: true,
        lastUpdate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
      });
    });

    it('should generate basic GPC JSON with gpc: false', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        gpc: {
          gpc: false,
          enabled: true,
        },
      };

      const result = generateGpcJson(data);
      expect(result).toEqual({
        gpc: false,
        lastUpdate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
      });
    });

    it('should use custom lastUpdate when provided (date format)', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        gpc: {
          gpc: true,
          enabled: true,
          lastUpdate: '2024-01-15',
        },
      };

      const result = generateGpcJson(data);
      expect(result).toEqual({
        gpc: true,
        lastUpdate: '2024-01-15',
      });
    });

    it('should use custom lastUpdate when provided (ISO 8601 format)', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        gpc: {
          gpc: true,
          enabled: true,
          lastUpdate: '2024-01-15T10:30:00.000Z',
        },
      };

      const result = generateGpcJson(data);
      expect(result).toEqual({
        gpc: true,
        lastUpdate: '2024-01-15T10:30:00.000Z',
      });
    });

    it('should default gpc to true when not explicitly set', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        gpc: {
          enabled: true,
          gpc: undefined as unknown as boolean,
        },
      };

      const result = generateGpcJson(data);
      expect(result).toEqual({
        gpc: true,
        lastUpdate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
    });
  });

  describe('addGpcJson plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addGpcJson(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write .well-known/gpc.json using data from the cascade', async () => {
      addGpcJson(mockEleventyConfig);

      // Get the callback that was registered
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      // Simulate eleventy.after event with data from the cascade
      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                gpc: {
                  gpc: true,
                  enabled: true,
                  lastUpdate: '2024-01-15',
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'gpc.json'),
        '{\n  "gpc": true,\n  "lastUpdate": "2024-01-15"\n}'
      );
    });

    it('should not create file when GPC is not enabled', async () => {
      addGpcJson(mockEleventyConfig);

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
                gpc: {
                  gpc: true,
                  enabled: false,
                },
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should not create file when no GPC config', async () => {
      addGpcJson(mockEleventyConfig);

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
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle file system errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      addGpcJson(mockEleventyConfig);
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
                gpc: {
                  gpc: true,
                  enabled: true,
                },
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Failed to write .well-known/gpc.json: Permission denied')
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty results gracefully', async () => {
      addGpcJson(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle missing website configuration gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const fsReadFileSpy = jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('File not found'));

      addGpcJson(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            // No data property - will try to read from filesystem
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] GPC plugin: Could not read website.json from _data directory'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      fsReadFileSpy.mockRestore();
    });

    it('should create .well-known directory if it does not exist', async () => {
      addGpcJson(mockEleventyConfig);

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
                gpc: {
                  gpc: false,
                  enabled: true,
                  lastUpdate: '2024-01-01',
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
    });

    it('should generate proper JSON formatting', async () => {
      addGpcJson(mockEleventyConfig);

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
                gpc: {
                  gpc: false,
                  enabled: true,
                  lastUpdate: '2024-12-25T12:00:00.000Z',
                },
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'gpc.json'),
        '{\n  "gpc": false,\n  "lastUpdate": "2024-12-25T12:00:00.000Z"\n}'
      );
    });
  });
});
