import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import * as fs from 'fs';
import type { EleventyConfig } from '@11ty/eleventy';
import addNodeInfo, { generateNodeInfoDiscovery, generateNodeInfo21 } from '../../plugins/nodeinfo.js';
import { AnglesiteWebsiteConfiguration } from '../../types/website.js';

// Mock filesystem operations
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock eleventy configuration
let mockEleventyConfig: jest.Mocked<EleventyConfig>;

describe('NodeInfo Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.mkdirSync = jest.fn();
    mockFs.writeFileSync = jest.fn();
  });

  describe('generateNodeInfoDiscovery', () => {
    test('generates discovery document with enabled NodeInfo', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        nodeinfo: {
          enabled: true,
        },
      };

      const discovery = generateNodeInfoDiscovery(website, 'https://example.com');

      expect(discovery).toEqual({
        links: [
          {
            rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
            href: 'https://example.com/.well-known/nodeinfo.json',
          },
        ],
      });
    });

    test('generates empty discovery document when NodeInfo disabled', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      const discovery = generateNodeInfoDiscovery(website, 'https://example.com');

      expect(discovery).toEqual({ links: [] });
    });
  });

  describe('generateNodeInfo21', () => {
    test('generates NodeInfo 2.1 document with minimal configuration', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://test.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
          },
          protocols: ['activitypub'],
          openRegistrations: false,
        },
      };

      const nodeInfo = generateNodeInfo21(website);

      expect(nodeInfo).toEqual({
        version: '2.1',
        software: {
          name: 'anglesite',
          version: '1.0.0',
        },
        protocols: ['activitypub'],
        services: {
          inbound: [],
          outbound: [],
        },
        openRegistrations: false,
        usage: {
          users: {},
        },
        metadata: {},
      });
    });

    test('generates NodeInfo 2.1 document with full configuration', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://test.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
            repository: 'https://github.com/example/anglesite',
            homepage: 'https://anglesite.example.com',
          },
          protocols: ['activitypub', 'diaspora'],
          services: {
            inbound: ['atom1.0', 'rss2.0'],
            outbound: ['twitter', 'facebook'],
          },
          openRegistrations: true,
          usage: {
            users: {
              total: 100,
              activeHalfyear: 80,
              activeMonth: 50,
            },
            localPosts: 1000,
            localComments: 500,
          },
          metadata: {
            customProperty: 'customValue',
            features: ['feature1', 'feature2'],
          },
        },
      };

      const nodeInfo = generateNodeInfo21(website);

      expect(nodeInfo).toEqual({
        version: '2.1',
        software: {
          name: 'anglesite',
          version: '1.0.0',
          repository: 'https://github.com/example/anglesite',
          homepage: 'https://anglesite.example.com',
        },
        protocols: ['activitypub', 'diaspora'],
        services: {
          inbound: ['atom1.0', 'rss2.0'],
          outbound: ['twitter', 'facebook'],
        },
        openRegistrations: true,
        usage: {
          users: {
            total: 100,
            activeHalfyear: 80,
            activeMonth: 50,
          },
          localPosts: 1000,
          localComments: 500,
        },
        metadata: {
          customProperty: 'customValue',
          features: ['feature1', 'feature2'],
        },
      });
    });

    test('throws error when NodeInfo not enabled', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      expect(() => generateNodeInfo21(website)).toThrow('NodeInfo is not enabled in website configuration');
    });

    test('throws error when no base URL is available', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
          },
          protocols: [],
          openRegistrations: false,
        },
      };

      expect(() => generateNodeInfo21(website)).toThrow(
        'NodeInfo requires a base URL. Please set website.url in your configuration or pass baseUrl parameter.'
      );
    });

    test('resolves relative URLs in software fields', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://test.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
            repository: 'https://github.com/example/repo', // Full URL should be preserved
            homepage: '/about', // Relative URL should be resolved
          },
          protocols: [],
          openRegistrations: false,
        },
      };

      const nodeInfo = generateNodeInfo21(website);

      expect(nodeInfo.software.repository).toBe('https://github.com/example/repo');
      expect(nodeInfo.software.homepage).toBe('https://test.example.com/about');
    });

    test('resolves relative URLs in metadata fields', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://test.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
          },
          protocols: [],
          openRegistrations: false,
          metadata: {
            tosUrl: '/terms',
            privacyPolicyUrl: '/privacy',
            donationUrl: 'https://donate.external.com', // External URL should be preserved
            repositoryUrl: '/repo',
            nonUrlField: 'not a url',
          },
        },
      };

      const nodeInfo = generateNodeInfo21(website);

      expect(nodeInfo.metadata).toEqual({
        tosUrl: 'https://test.example.com/terms',
        privacyPolicyUrl: 'https://test.example.com/privacy',
        donationUrl: 'https://donate.external.com',
        repositoryUrl: 'https://test.example.com/repo',
        nonUrlField: 'not a url',
      });
    });

    test('uses provided baseUrl parameter over website.url', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://wrong.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
            homepage: '/about',
          },
          protocols: [],
          openRegistrations: false,
        },
      };

      const nodeInfo = generateNodeInfo21(website, 'https://correct.example.com');

      expect(nodeInfo.software.homepage).toBe('https://correct.example.com/about');
    });

    test('handles URLs without leading slash', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://test.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
            homepage: 'about', // No leading slash
          },
          protocols: [],
          openRegistrations: false,
        },
      };

      const nodeInfo = generateNodeInfo21(website);

      expect(nodeInfo.software.homepage).toBe('https://test.example.com/about');
    });

    test('handles base URLs with trailing slash', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
            homepage: '/about',
          },
          protocols: [],
          openRegistrations: false,
        },
      };

      const nodeInfo = generateNodeInfo21(website, 'https://test.example.com/'); // Trailing slash

      expect(nodeInfo.software.homepage).toBe('https://test.example.com/about');
    });
  });

  describe('addNodeInfo plugin', () => {
    let onEventHandler: (event: { dir: { output: string }; results: unknown[] }) => Promise<void>;

    beforeEach(() => {
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

    test('registers eleventy.after event handler', () => {
      addNodeInfo(mockEleventyConfig);

      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    test('does nothing when no results', async () => {
      addNodeInfo(mockEleventyConfig);

      await onEventHandler({ dir: { output: '/test' }, results: [] });

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    test('creates NodeInfo files when enabled with test data', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const testWebsite: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://test.example.com',
        nodeinfo: {
          enabled: true,
          software: {
            name: 'anglesite',
            version: '1.0.0',
          },
          protocols: ['activitypub'],
          openRegistrations: false,
        },
      };

      addNodeInfo(mockEleventyConfig);

      await onEventHandler({
        dir: { output: '/test/_site' },
        results: [{ data: { website: testWebsite } }],
      });

      // Verify console logs show the plugin executed successfully
      expect(consoleSpy).toHaveBeenCalledWith('[Eleventy] Wrote /test/_site/.well-known/nodeinfo');
      expect(consoleSpy).toHaveBeenCalledWith('[Eleventy] Wrote /test/_site/.well-known/nodeinfo.json');

      consoleSpy.mockRestore();
    });

    test('does nothing when NodeInfo not enabled', async () => {
      const testWebsite: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      addNodeInfo(mockEleventyConfig);

      await onEventHandler({
        dir: { output: '/test/_site' },
        results: [{ data: { website: testWebsite } }],
      });

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    test('validates NodeInfo configuration and stops on errors', async () => {
      const testWebsite: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        nodeinfo: {
          enabled: true,
          // Missing required software.name and software.version
        },
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      addNodeInfo(mockEleventyConfig);

      await onEventHandler({
        dir: { output: '/test/_site' },
        results: [{ data: { website: testWebsite } }],
      });

      expect(consoleSpy).toHaveBeenCalledWith('[Eleventy] NodeInfo plugin configuration errors:');
      expect(consoleSpy).toHaveBeenCalledWith('  - NodeInfo software.name is required');
      expect(consoleSpy).toHaveBeenCalledWith('  - NodeInfo software.version is required');

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('handles validation errors gracefully', async () => {
      const testWebsite: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        nodeinfo: {
          enabled: true,
          // Missing required software.name and software.version
          protocols: [],
          openRegistrations: false,
        },
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      addNodeInfo(mockEleventyConfig);

      await onEventHandler({
        dir: { output: '/test/_site' },
        results: [{ data: { website: testWebsite } }],
      });

      expect(consoleSpy).toHaveBeenCalledWith('[Eleventy] NodeInfo plugin configuration errors:');
      expect(consoleSpy).toHaveBeenCalledWith('  - NodeInfo software.name is required');
      expect(consoleSpy).toHaveBeenCalledWith('  - NodeInfo software.version is required');

      consoleSpy.mockRestore();
    });
  });
});
