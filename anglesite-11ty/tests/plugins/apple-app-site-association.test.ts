import * as fs from 'fs';
import * as path from 'path';
import { generateAppleAppSiteAssociation } from '../../plugins/apple-app-site-association';
import addAppleAppSiteAssociation from '../../plugins/apple-app-site-association';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('apple-app-site-association plugin', () => {
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

  describe('generateAppleAppSiteAssociation', () => {
    it('should return empty string when not enabled', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: false,
        },
      };

      expect(generateAppleAppSiteAssociation(data)).toBe('');
    });

    it('should return empty string when no website data', () => {
      expect(generateAppleAppSiteAssociation(null as unknown as AnglesiteWebsiteConfiguration)).toBe('');
    });

    it('should return empty string when no apple_app_site_association config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      expect(generateAppleAppSiteAssociation(data)).toBe('');
    });

    it('should generate basic applinks configuration', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          applinks: {
            apps: [],
            details: [
              {
                appID: 'ABCD123456.com.example.app',
                paths: ['*'],
              },
            ],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        applinks: {
          apps: [],
          details: [
            {
              appID: 'ABCD123456.com.example.app',
              paths: ['*'],
            },
          ],
        },
      });
    });

    it('should generate applinks with multiple app IDs using appIDs field', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          applinks: {
            apps: [],
            details: [
              {
                appIDs: ['ABCD123456.com.example.app', 'EFGH789012.com.example.app2'],
                paths: ['/products/*', '/categories/*'],
              },
            ],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(parsed.applinks.details[0]).toEqual({
        appIDs: ['ABCD123456.com.example.app', 'EFGH789012.com.example.app2'],
        paths: ['/products/*', '/categories/*'],
      });
    });

    it('should generate applinks with components instead of paths', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          applinks: {
            apps: [],
            details: [
              {
                appID: 'ABCD123456.com.example.app',
                paths: ['*'],
                components: [
                  {
                    '/': '/products/*',
                    '?': { category: '*' },
                    '#': 'details',
                  },
                ],
              },
            ],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(parsed.applinks.details[0].components).toEqual([
        {
          '/': '/products/*',
          '?': { category: '*' },
          '#': 'details',
        },
      ]);
    });

    it('should generate webcredentials configuration', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          webcredentials: {
            apps: ['ABCD123456.com.example.app'],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        webcredentials: {
          apps: ['ABCD123456.com.example.app'],
        },
      });
    });

    it('should generate appclips configuration', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          appclips: {
            apps: ['com.example.app.clip'],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        appclips: {
          apps: ['com.example.app.clip'],
        },
      });
    });

    it('should generate complete configuration with all sections', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          applinks: {
            apps: [],
            details: [
              {
                appID: 'ABCD123456.com.example.app',
                paths: ['/products/*', 'NOT /admin/*'],
              },
            ],
          },
          webcredentials: {
            apps: ['ABCD123456.com.example.app'],
          },
          appclips: {
            apps: ['com.example.app.clip'],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        applinks: {
          apps: [],
          details: [
            {
              appID: 'ABCD123456.com.example.app',
              paths: ['/products/*', 'NOT /admin/*'],
            },
          ],
        },
        webcredentials: {
          apps: ['ABCD123456.com.example.app'],
        },
        appclips: {
          apps: ['com.example.app.clip'],
        },
      });
    });

    it('should validate and reject invalid app IDs', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          applinks: {
            apps: [],
            details: [
              {
                appID: 'invalid-app-id',
                paths: ['*'],
              },
            ],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid app ID format: invalid-app-id'));
      expect(parsed.applinks.details).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should validate and reject dangerous path patterns', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          applinks: {
            apps: [],
            details: [
              {
                appID: 'ABCD123456.com.example.app',
                paths: ['../../../etc/passwd', '*'],
              },
            ],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Potentially dangerous path pattern'));
      expect(parsed.applinks.details).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should validate webcredentials app IDs', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          webcredentials: {
            apps: ['ABCD123456.com.example.app', 'invalid-app-id'],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      const parsed = JSON.parse(result);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid app ID format for webcredentials: invalid-app-id')
      );
      expect(parsed.webcredentials.apps).toEqual(['ABCD123456.com.example.app']);

      consoleSpy.mockRestore();
    });

    it('should handle empty webcredentials apps array', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          webcredentials: {
            apps: [],
          },
        },
      };

      const result = generateAppleAppSiteAssociation(data);

      expect(result).toBe('');
    });

    it('should return empty string when no valid content', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        apple_app_site_association: {
          enabled: true,
          // No content configured
        },
      };

      const result = generateAppleAppSiteAssociation(data);
      expect(result).toBe('');
    });
  });

  describe('addAppleAppSiteAssociation plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addAppleAppSiteAssociation(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write .well-known/apple-app-site-association file', async () => {
      addAppleAppSiteAssociation(mockEleventyConfig);

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
                apple_app_site_association: {
                  enabled: true,
                  applinks: {
                    apps: [],
                    details: [
                      {
                        appID: 'ABCD123456.com.example.app',
                        paths: ['*'],
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'apple-app-site-association'),
        expect.stringContaining('ABCD123456.com.example.app')
      );
    });

    it('should not create file when not enabled', async () => {
      addAppleAppSiteAssociation(mockEleventyConfig);

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
                apple_app_site_association: {
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

    it('should not create file when no apple_app_site_association config', async () => {
      addAppleAppSiteAssociation(mockEleventyConfig);

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

      addAppleAppSiteAssociation(mockEleventyConfig);
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
                apple_app_site_association: {
                  enabled: true,
                  applinks: {
                    apps: [],
                    details: [
                      {
                        appID: 'ABCD123456.com.example.app',
                        paths: ['*'],
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[@dwk/anglesite-11ty] Failed to write .well-known/apple-app-site-association: Permission denied'
        )
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty results gracefully', async () => {
      addAppleAppSiteAssociation(mockEleventyConfig);

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

      addAppleAppSiteAssociation(mockEleventyConfig);
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
        '[@dwk/anglesite-11ty] Apple App Site Association plugin: Could not read website.json from _data directory'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      fsReadFileSpy.mockRestore();
    });

    it('should create .well-known directory if it does not exist', async () => {
      addAppleAppSiteAssociation(mockEleventyConfig);

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
                apple_app_site_association: {
                  enabled: true,
                  applinks: {
                    apps: [],
                    details: [
                      {
                        appID: 'ABCD123456.com.example.app',
                        paths: ['*'],
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
    });
  });
});
