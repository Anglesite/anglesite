import * as fs from 'fs';
import * as path from 'path';
import { generateWebFingerResponse, generateStaticWebFinger, generateWebFingerIndex } from '../../plugins/webfinger.js';
import addWebFinger from '../../plugins/webfinger.js';
import type { EleventyConfig } from '../types/eleventy-shim.js';
import type { AnglesiteWebsiteConfiguration } from '../../types/website.js';

// Mock fs operations to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('WebFinger Plugin', () => {
  const mockConfig: AnglesiteWebsiteConfiguration = {
    title: 'Test Site',
    language: 'en',
    url: 'https://example.com',
    webfinger: {
      enabled: true,
      resources: [
        {
          subject: 'acct:admin@example.com',
          aliases: ['https://example.com/users/admin', 'https://example.com/@admin'],
          properties: {
            'http://schema.org/name': 'Website Administrator',
          },
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: 'https://example.com/users/admin',
            },
            {
              rel: 'http://webfinger.net/rel/profile-page',
              type: 'text/html',
              href: 'https://example.com/about',
            },
            {
              rel: 'http://webfinger.net/rel/avatar',
              type: 'image/jpeg',
              href: 'https://example.com/avatar.jpg',
            },
          ],
        },
        {
          subject: 'https://example.com/',
          aliases: ['https://www.example.com/'],
          properties: {
            'http://schema.org/name': 'Test Website',
          },
          links: [
            {
              rel: 'self',
              type: 'text/html',
              href: 'https://example.com/',
            },
            {
              rel: 'alternate',
              type: 'application/rss+xml',
              href: 'https://example.com/feed.xml',
            },
          ],
        },
      ],
    },
  };

  describe('generateWebFingerResponse', () => {
    it('should generate valid WebFinger JRD for account resource', () => {
      const resource = mockConfig.webfinger!.resources![0];
      const result = generateWebFingerResponse(resource);

      expect(result.subject).toBe('acct:admin@example.com');
      expect(result.aliases).toEqual(['https://example.com/users/admin', 'https://example.com/@admin']);
      expect(result.properties).toEqual({
        'http://schema.org/name': 'Website Administrator',
      });
      expect(result.links).toHaveLength(3);
      expect(result.links![0]).toEqual({
        rel: 'self',
        type: 'application/activity+json',
        href: 'https://example.com/users/admin',
      });
    });

    it('should generate valid WebFinger JRD for website resource', () => {
      const resource = mockConfig.webfinger!.resources![1];
      const result = generateWebFingerResponse(resource);

      expect(result.subject).toBe('https://example.com/');
      expect(result.aliases).toEqual(['https://www.example.com/']);
      expect(result.properties).toEqual({
        'http://schema.org/name': 'Test Website',
      });
      expect(result.links).toHaveLength(2);
      expect(result.links![1]).toEqual({
        rel: 'alternate',
        type: 'application/rss+xml',
        href: 'https://example.com/feed.xml',
      });
    });

    it('should handle minimal resource config', () => {
      const minimalResource = {
        subject: 'acct:minimal@example.com',
      };
      const result = generateWebFingerResponse(minimalResource);

      expect(result.subject).toBe('acct:minimal@example.com');
      expect(result.aliases).toBeUndefined();
      expect(result.properties).toBeUndefined();
      expect(result.links).toBeUndefined();
    });

    it('should handle resource with empty arrays', () => {
      const resourceWithEmptyArrays = {
        subject: 'acct:empty@example.com',
        aliases: [],
        links: [],
      };
      const result = generateWebFingerResponse(resourceWithEmptyArrays);

      expect(result.subject).toBe('acct:empty@example.com');
      expect(result.aliases).toBeUndefined();
      expect(result.properties).toBeUndefined();
      expect(result.links).toBeUndefined();
    });
  });

  describe('generateStaticWebFinger', () => {
    it('should generate static WebFinger resource lookup', () => {
      const result = generateStaticWebFinger(mockConfig);
      const parsed = JSON.parse(result);

      expect(Object.keys(parsed)).toHaveLength(2);
      expect(parsed['acct:admin@example.com']).toBeDefined();
      expect(parsed['https://example.com/']).toBeDefined();

      // Check first resource
      expect(parsed['acct:admin@example.com'].subject).toBe('acct:admin@example.com');
      expect(parsed['acct:admin@example.com'].links).toHaveLength(3);

      // Check second resource
      expect(parsed['https://example.com/'].subject).toBe('https://example.com/');
      expect(parsed['https://example.com/'].links).toHaveLength(2);
    });

    it('should return empty string when webfinger is disabled', () => {
      const disabledConfig = {
        ...mockConfig,
        webfinger: { ...mockConfig.webfinger!, enabled: false },
      };
      const result = generateStaticWebFinger(disabledConfig);
      expect(result).toBe('');
    });

    it('should return empty string when webfinger config is missing', () => {
      const noWebFingerConfig = { ...mockConfig, webfinger: undefined };
      const result = generateStaticWebFinger(noWebFingerConfig);
      expect(result).toBe('');
    });

    it('should return empty string when no resources configured', () => {
      const noResourcesConfig = {
        ...mockConfig,
        webfinger: { enabled: true, resources: [] },
      };
      const result = generateStaticWebFinger(noResourcesConfig);
      expect(result).toBe('');
    });

    it('should handle resources with null properties', () => {
      const configWithNullProps = {
        ...mockConfig,
        webfinger: {
          enabled: true,
          resources: [
            {
              subject: 'acct:test@example.com',
              properties: {
                'http://schema.org/name': 'Test User',
                'http://schema.org/description': null,
              },
            },
          ],
        },
      };
      const result = generateStaticWebFinger(configWithNullProps);
      const parsed = JSON.parse(result);

      expect(parsed['acct:test@example.com'].properties).toEqual({
        'http://schema.org/name': 'Test User',
        'http://schema.org/description': null,
      });
    });
  });

  describe('generateWebFingerIndex', () => {
    it('should generate HTML index page with all resources listed', () => {
      const result = generateWebFingerIndex(mockConfig);

      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<title>WebFinger Endpoint</title>');
      expect(result).toContain('<h1>WebFinger Resources</h1>');
      expect(result).toContain('<code>acct:admin@example.com</code>');
      expect(result).toContain('<code>https://example.com/</code>');
      expect(result).toContain('/.well-known/webfinger?resource=RESOURCE_URI');
      expect(result).toContain('static WebFinger implementation');
    });

    it('should return empty string when webfinger is disabled', () => {
      const disabledConfig = {
        ...mockConfig,
        webfinger: { ...mockConfig.webfinger!, enabled: false },
      };
      const result = generateWebFingerIndex(disabledConfig);
      expect(result).toBe('');
    });

    it('should return empty string when no webfinger config', () => {
      const noWebFingerConfig = { ...mockConfig, webfinger: undefined };
      const result = generateWebFingerIndex(noWebFingerConfig);
      expect(result).toBe('');
    });

    it('should handle single resource', () => {
      const singleResourceConfig = {
        ...mockConfig,
        webfinger: {
          enabled: true,
          resources: [{ subject: 'acct:single@example.com' }],
        },
      };
      const result = generateWebFingerIndex(singleResourceConfig);

      expect(result).toContain('<code>acct:single@example.com</code>');
      expect(result).not.toContain('<code>https://example.com/</code>');
    });

    it('should escape HTML special characters in subjects', () => {
      const specialCharsConfig = {
        ...mockConfig,
        webfinger: {
          enabled: true,
          resources: [{ subject: 'acct:user<test>@example.com' }],
        },
      };
      const result = generateWebFingerIndex(specialCharsConfig);

      // The HTML should contain escaped characters
      expect(result).toContain('acct:user<test>@example.com');
    });
  });

  describe('Link properties handling', () => {
    it('should handle links with titles and properties', () => {
      const resourceWithExtendedLinks = {
        subject: 'acct:extended@example.com',
        links: [
          {
            rel: 'http://webfinger.net/rel/profile-page',
            href: 'https://example.com/profile',
            type: 'text/html',
            titles: {
              en: 'Profile Page',
              fr: 'Page de Profil',
            },
            properties: {
              'http://example.com/priority': '1',
              'http://example.com/verified': null,
            },
          },
        ],
      };

      const result = generateWebFingerResponse(resourceWithExtendedLinks);

      expect(result.links).toHaveLength(1);
      expect(result.links![0]).toEqual({
        rel: 'http://webfinger.net/rel/profile-page',
        href: 'https://example.com/profile',
        type: 'text/html',
        titles: {
          en: 'Profile Page',
          fr: 'Page de Profil',
        },
        properties: {
          'http://example.com/priority': '1',
          'http://example.com/verified': null,
        },
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle resources with undefined optional fields', () => {
      const resource = {
        subject: 'acct:minimal@example.com',
        aliases: undefined,
        properties: undefined,
        links: undefined,
      };
      const result = generateWebFingerResponse(resource);

      expect(result.subject).toBe('acct:minimal@example.com');
      expect(result.aliases).toBeUndefined();
      expect(result.properties).toBeUndefined();
      expect(result.links).toBeUndefined();
    });

    it('should handle links without href (template-only)', () => {
      const resourceWithTemplateLink = {
        subject: 'acct:template@example.com',
        links: [
          {
            rel: 'lrdd',
            type: 'application/xrd+xml',
            // No href property
          },
        ],
      };
      const result = generateWebFingerResponse(resourceWithTemplateLink);

      expect(result.links).toHaveLength(1);
      expect(result.links![0]).toEqual({
        rel: 'lrdd',
        type: 'application/xrd+xml',
      });
    });
  });

  describe('addWebFinger plugin integration', () => {
    let mockEleventyConfig: jest.Mocked<EleventyConfig>;
    let onEventHandler: (data: { dir: { output: string }; results: unknown[] }) => Promise<void>;

    beforeEach(() => {
      jest.clearAllMocks();

      mockEleventyConfig = {
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'eleventy.after') {
            onEventHandler = handler;
          }
        }),
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
      } as unknown as jest.Mocked<EleventyConfig>;
    });

    it('should register eleventy.after event handler', () => {
      addWebFinger(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should return early if no results provided', async () => {
      addWebFinger(mockEleventyConfig);

      await onEventHandler({ dir: { output: '_site' }, results: [] });

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should generate WebFinger files from page data', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                webfinger: {
                  enabled: true,
                  resources: [
                    {
                      subject: 'acct:test@example.com',
                      properties: { 'http://schema.org/name': 'Test User' },
                    },
                  ],
                },
              },
            },
          },
        ],
      };

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'webfinger-resources.json'),
        expect.stringContaining('"acct:test@example.com"')
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'webfinger'),
        expect.stringContaining('acct:test@example.com')
      );
    });

    it('should read from filesystem when no page data available', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [{}], // No data property
      };

      (mockFs.promises.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          ...mockConfig,
          webfinger: {
            enabled: true,
            resources: [
              {
                subject: 'acct:filesystem-test@example.com',
                properties: { 'http://schema.org/name': 'Filesystem User' },
              },
            ],
          },
        })
      );

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.promises.readFile).toHaveBeenCalledWith(path.resolve('src', '_data', 'website.json'), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'webfinger-resources.json'),
        expect.stringContaining('filesystem-test@example.com')
      );
    });

    it('should handle filesystem read errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const testData = {
        dir: { output: '_site' },
        results: [{}],
      };

      (mockFs.promises.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] WebFinger plugin: Could not read website.json from _data directory'
      );
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should return early if webfinger is disabled', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                webfinger: {
                  enabled: false,
                },
              },
            },
          },
        ],
      };

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should return early if no webfinger config', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://example.com',
                // No webfinger config
              },
            },
          },
        ],
      };

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should return early if no website config found', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              // No website config
            },
          },
        ],
      };

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(consoleSpy).toHaveBeenCalledWith('[@dwk/anglesite-11ty] WebFinger plugin: No website configuration found');
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle file write errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                webfinger: {
                  enabled: true,
                  resources: [{ subject: 'acct:test@example.com' }],
                },
              },
            },
          },
        ],
      };

      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write permission denied');
      });

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write WebFinger files: Write permission denied'
      );

      mockFs.writeFileSync.mockImplementation(() => {}); // Reset to no-op
      consoleErrorSpy.mockRestore();
    });

    it('should skip file generation if resources are empty but still create directory', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://example.com',
                webfinger: {
                  enabled: true,
                  resources: [],
                },
              },
            },
          },
        ],
      };

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      // Should not write files for empty resources
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle mixed content generation', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://example.com',
                webfinger: {
                  enabled: true,
                  resources: [
                    {
                      subject: 'acct:user1@example.com',
                      aliases: ['https://example.com/@user1'],
                      links: [{ rel: 'self', href: 'https://example.com/user1' }],
                    },
                    {
                      subject: 'https://example.com/',
                      properties: { 'http://schema.org/name': 'Example Site' },
                    },
                  ],
                },
              },
            },
          },
        ],
      };

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      // Check that both resources are included
      const resourcesCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find((call) =>
        call[0].includes('webfinger-resources.json')
      );
      expect(resourcesCall[1]).toContain('acct:user1@example.com');
      expect(resourcesCall[1]).toContain('https://example.com/');

      // Check that both resources are listed in HTML index
      const indexCall = (mockFs.writeFileSync as jest.Mock).mock.calls.find((call) => call[0].endsWith('webfinger'));
      expect(indexCall).toBeDefined();
      expect(indexCall[1]).toContain('acct:user1@example.com');
      expect(indexCall[1]).toContain('https://example.com/');
    });

    it('should only generate resources file when index generation fails silently', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                webfinger: {
                  enabled: true,
                  resources: [{ subject: 'acct:test@example.com' }],
                },
              },
            },
          },
        ],
      };

      // Mock successful resources file write but failed index write
      mockFs.writeFileSync
        .mockImplementationOnce(() => {}) // First call (resources) succeeds
        .mockImplementationOnce(() => {
          // Second call (index) fails
          throw new Error('Index write failed');
        });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      addWebFinger(mockEleventyConfig);
      await onEventHandler(testData);

      // Should still report general write failure
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write WebFinger files: Index write failed'
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
