import * as fs from 'fs';
import * as path from 'path';
import { generateHostMetaXrd, generateHostMetaJrd, generateHostMetaHeaders } from '../../plugins/host-meta.js';
import addHostMeta from '../../plugins/host-meta.js';
import type { EleventyConfig } from '../types/eleventy-shim.js';
import type { AnglesiteWebsiteConfiguration } from '../../types/website.js';

// Mock fs operations to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('Host-meta Plugin', () => {
  const mockConfig: AnglesiteWebsiteConfiguration = {
    title: 'Test Site',
    language: 'en',
    url: 'https://example.com',
    host_meta: {
      enabled: true,
      format: 'xml',
      subject: 'https://example.com',
      aliases: ['https://www.example.com'],
      properties: [
        {
          type: 'http://spec.example.net/type/name',
          value: 'Test Website',
        },
      ],
      links: [
        {
          rel: 'lrdd',
          href: 'https://example.com/.well-known/webfinger?resource={uri}',
          type: 'application/xrd+xml',
          template: true,
        },
        {
          rel: 'author',
          href: 'https://example.com/about',
          type: 'text/html',
        },
      ],
    },
  };

  describe('generateHostMetaXrd', () => {
    it('should generate valid XRD document', () => {
      const result = generateHostMetaXrd(mockConfig);

      expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(result).toContain('<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">');
      expect(result).toContain('<Subject>https://example.com</Subject>');
      expect(result).toContain('<Alias>https://www.example.com</Alias>');
      expect(result).toContain('<Property type="http://spec.example.net/type/name">Test Website</Property>');
      expect(result).toContain('template="https://example.com/.well-known/webfinger?resource={uri}"');
      expect(result).toContain('href="https://example.com/about"');
      expect(result).toContain('</XRD>');
    });

    it('should return empty string when host_meta is disabled', () => {
      const disabledConfig = {
        ...mockConfig,
        host_meta: { ...mockConfig.host_meta!, enabled: false },
      };
      const result = generateHostMetaXrd(disabledConfig);
      expect(result).toBe('');
    });

    it('should handle missing host_meta config', () => {
      const noHostMetaConfig = { ...mockConfig, host_meta: undefined };
      const result = generateHostMetaXrd(noHostMetaConfig);
      expect(result).toBe('');
    });

    it('should escape XML characters properly', () => {
      const configWithSpecialChars = {
        ...mockConfig,
        host_meta: {
          ...mockConfig.host_meta!,
          subject: 'https://example.com/path?query=value&other=<test>',
        },
      };
      const result = generateHostMetaXrd(configWithSpecialChars);
      expect(result).toContain('&lt;test&gt;');
      expect(result).toContain('&amp;');
    });
  });

  describe('generateHostMetaJrd', () => {
    it('should generate valid JRD document', () => {
      const result = generateHostMetaJrd(mockConfig);
      const jrd = JSON.parse(result);

      expect(jrd.subject).toBe('https://example.com');
      expect(jrd.aliases).toEqual(['https://www.example.com']);
      expect(jrd.properties).toEqual({
        'http://spec.example.net/type/name': 'Test Website',
      });
      expect(jrd.links).toHaveLength(2);
      expect(jrd.links[0]).toEqual({
        rel: 'lrdd',
        template: 'https://example.com/.well-known/webfinger?resource={uri}',
        type: 'application/xrd+xml',
      });
      expect(jrd.links[1]).toEqual({
        rel: 'author',
        href: 'https://example.com/about',
        type: 'text/html',
      });
    });

    it('should return empty string when host_meta is disabled', () => {
      const disabledConfig = {
        ...mockConfig,
        host_meta: { ...mockConfig.host_meta!, enabled: false },
      };
      const result = generateHostMetaJrd(disabledConfig);
      expect(result).toBe('');
    });

    it('should handle minimal config', () => {
      const minimalConfig = {
        ...mockConfig,
        host_meta: {
          enabled: true,
          subject: 'https://example.com',
        },
      };
      const result = generateHostMetaJrd(minimalConfig);
      const jrd = JSON.parse(result);

      expect(jrd.subject).toBe('https://example.com');
      expect(jrd.aliases).toBeUndefined();
      expect(jrd.properties).toBeUndefined();
      expect(jrd.links).toBeUndefined();
    });
  });

  describe('generateHostMetaHeaders', () => {
    it('should generate XML headers', () => {
      const headers = generateHostMetaHeaders('xml');
      expect(headers).toEqual([
        '/.well-known/host-meta',
        '  Content-Type: application/xrd+xml; charset=utf-8',
        '  Cache-Control: public, max-age=86400',
        '',
      ]);
    });

    it('should generate JSON headers', () => {
      const headers = generateHostMetaHeaders('json');
      expect(headers).toEqual([
        '/.well-known/host-meta',
        '  Content-Type: application/jrd+json; charset=utf-8',
        '  Cache-Control: public, max-age=86400',
        '',
      ]);
    });

    it('should generate both format headers', () => {
      const headers = generateHostMetaHeaders('both');
      expect(headers).toEqual([
        '/.well-known/host-meta',
        '  Content-Type: application/xrd+xml; charset=utf-8',
        '  Cache-Control: public, max-age=86400',
        '',
        '/.well-known/host-meta.json',
        '  Content-Type: application/jrd+json; charset=utf-8',
        '  Cache-Control: public, max-age=86400',
        '',
      ]);
    });
  });

  describe('addHostMeta plugin integration', () => {
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
      addHostMeta(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should return early if no results provided', async () => {
      addHostMeta(mockEleventyConfig);

      await onEventHandler({ dir: { output: '_site' }, results: [] });

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should generate XML host-meta from page data', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                host_meta: {
                  enabled: true,
                  format: 'xml',
                  subject: 'https://test.com',
                },
              },
            },
          },
        ],
      };

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'host-meta'),
        expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>')
      );
    });

    it('should generate JSON host-meta when format is json', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                host_meta: {
                  enabled: true,
                  format: 'json',
                  subject: 'https://test.com',
                },
              },
            },
          },
        ],
      };

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'host-meta'),
        expect.stringContaining('"subject": "https://test.com"')
      );
    });

    it('should generate both formats when format is both', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                host_meta: {
                  enabled: true,
                  format: 'both',
                  subject: 'https://test.com',
                },
              },
            },
          },
        ],
      };

      mockFs.readFileSync.mockReturnValue('');

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      // Should create both XML and JSON files
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'host-meta'),
        expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>')
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'host-meta.json'),
        expect.stringContaining('"subject": "https://test.com"')
      );

      // Should update headers file
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '_headers'),
        expect.stringContaining('/.well-known/host-meta')
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
          host_meta: {
            enabled: true,
            format: 'xml',
            subject: 'https://filesystem-test.com',
          },
        })
      );

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.promises.readFile).toHaveBeenCalledWith(path.resolve('src', '_data', 'website.json'), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'host-meta'),
        expect.stringContaining('https://filesystem-test.com')
      );
    });

    it('should handle filesystem read errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const testData = {
        dir: { output: '_site' },
        results: [{}],
      };

      (mockFs.promises.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Host-meta plugin: Could not read website.json from _data directory'
      );
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should return early if host_meta is disabled', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                host_meta: {
                  enabled: false,
                },
              },
            },
          },
        ],
      };

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
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
                host_meta: {
                  enabled: true,
                  format: 'xml',
                  subject: 'https://test.com',
                },
              },
            },
          },
        ],
      };

      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write permission denied');
      });

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write host-meta: Write permission denied'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should not overwrite existing headers if host-meta headers already present', async () => {
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                host_meta: {
                  enabled: true,
                  format: 'xml',
                  subject: 'https://test.com',
                },
              },
            },
          },
        ],
      };

      // Mock existing headers file that already contains host-meta headers
      mockFs.readFileSync.mockReturnValue('/.well-known/host-meta\n  Content-Type: application/xrd+xml');

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      // Should not update headers file since it already contains host-meta headers
      const headersCalls = (mockFs.writeFileSync as jest.Mock).mock.calls.filter((call) =>
        call[0].includes('_headers')
      );
      expect(headersCalls).toHaveLength(0);
    });

    it('should handle header file write errors gracefully', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const testData = {
        dir: { output: '_site' },
        results: [
          {
            data: {
              website: {
                ...mockConfig,
                host_meta: {
                  enabled: true,
                  format: 'xml',
                  subject: 'https://test.com',
                },
              },
            },
          },
        ],
      };

      // Mock successful host-meta file write but failed headers write
      mockFs.writeFileSync
        .mockImplementationOnce(() => {}) // First call (host-meta file) succeeds
        .mockImplementationOnce(() => {
          // Second call (headers file) fails
          throw new Error('Headers write failed');
        });

      mockFs.readFileSync.mockReturnValue('');

      addHostMeta(mockEleventyConfig);
      await onEventHandler(testData);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Could not update _headers file: Headers write failed'
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
