import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { generateRedirects } from '../../plugins/redirects';
import addRedirects from '../../plugins/redirects';
import { AnglesiteWebsiteConfiguration } from '../../types/website';
import type { EleventyConfig } from '@11ty/eleventy';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
  },
}));

// Mock path
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  resolve: jest.fn(),
  join: jest.fn((...paths: string[]) => paths.join('/')),
  dirname: jest.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('generateRedirects', () => {
  it('should generate redirects in CloudFlare format', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/old-page',
          destination: '/new-page',
          code: 301,
        },
        {
          source: '/blog/:slug',
          destination: '/articles/:slug',
          code: 302,
        },
      ],
    };

    const result = generateRedirects(website);
    const expected = `/old-page /new-page 301
/blog/:slug /articles/:slug 302
`;

    expect(result.content).toBe(expected);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('should handle forced redirects', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/force',
          destination: '/destination',
          code: 301,
          force: true,
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.content).toBe('/force /destination 301!\n');
    expect(result.errors).toEqual([]);
  });

  it('should default to 301 if no code is specified', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/default',
          destination: '/target',
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.content).toBe('/default /target 301\n');
    expect(result.errors).toEqual([]);
  });

  it('should handle wildcards and splats', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/docs/*',
          destination: 'https://docs.example.com/:splat',
          code: 301,
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.content).toBe('/docs/* https://docs.example.com/:splat 301\n');
    expect(result.errors).toEqual([]);
  });

  it('should return empty string if no redirects', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
    };

    const result = generateRedirects(website);
    expect(result.content).toBe('');
    expect(result.errors).toEqual([]);
  });

  it('should return empty string if redirects is empty array', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [],
    };

    const result = generateRedirects(website);
    expect(result.content).toBe('');
    expect(result.errors).toEqual([]);
  });

  it('should skip redirects missing source or destination', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/valid',
          destination: '/target',
        },
        {
          source: '',
          destination: '/invalid',
        } as unknown as { source: string; destination: string },
        {
          source: '/another',
          destination: '',
        } as unknown as { source: string; destination: string },
      ],
    };

    const result = generateRedirects(website);
    expect(result.content).toBe('/valid /target 301\n');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should validate source paths start with /', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: 'invalid-path',
          destination: '/target',
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Source path must start with '/'");
  });

  it('should validate redirect status codes', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: '/target',
          code: 404 as never, // Invalid code
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid redirect code: 404');
  });

  it('should validate multiple splats', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/docs/*/test/*',
          destination: '/target',
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Multiple splats (*) not allowed');
  });

  it('should count dynamic vs static redirects', () => {
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        { source: '/static1', destination: '/target1' }, // Static
        { source: '/static2', destination: '/target2' }, // Static
        { source: '/dynamic/*', destination: '/target3' }, // Dynamic
        { source: '/param/:id', destination: '/target4' }, // Dynamic
      ],
    };

    const result = generateRedirects(website);
    expect(result.errors).toEqual([]);
    expect(result.content).toContain('/static1 /target1 301');
    expect(result.content).toContain('/dynamic/* /target3 301');
  });

  it('should validate CloudFlare redirect limits', () => {
    const redirects = Array.from({ length: 2101 }, (_, i) => ({
      source: `/test${i}`,
      destination: `/target${i}`,
    }));

    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects,
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Too many redirects');
  });

  it('should validate dynamic redirect limits', () => {
    const redirects = Array.from({ length: 101 }, (_, i) => ({
      source: `/test${i}/*`,
      destination: `/target${i}`,
    }));

    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects,
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Too many dynamic redirects');
  });

  it('should validate static redirect limits', () => {
    const redirects = Array.from({ length: 2001 }, (_, i) => ({
      source: `/test${i}`,
      destination: `/target${i}`,
    }));

    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects,
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Too many static redirects');
  });

  it('should validate redirect line length', () => {
    const longDestination = 'https://example.com/' + 'a'.repeat(1000);
    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: longDestination,
        },
      ],
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('exceeds');
  });
});

describe('addRedirects Plugin', () => {
  let mockEleventyConfig: Partial<EleventyConfig>;
  let onEventHandler: (event: { dir: { input?: string; output: string }; results: unknown[] }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEleventyConfig = {
      on: jest.fn(),
    };

    mockFs.readFile.mockResolvedValue('{}');
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockPath.resolve.mockReturnValue('/src/_data/website.json');
    mockPath.join.mockImplementation((...paths) => paths.join('/'));
    mockPath.dirname.mockImplementation((p) => p.split('/').slice(0, -1).join('/'));

    // Initialize the plugin
    addRedirects(mockEleventyConfig as EleventyConfig);

    // Extract the event handler
    onEventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls.find((call) => call[0] === 'eleventy.after')?.[1];
  });

  it('should register event handler', () => {
    expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
  });

  it('should return early when no results', async () => {
    await onEventHandler({
      dir: { output: '/output' },
      results: [],
    });

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('should use website config from results data', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: '/target',
        },
      ],
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    await onEventHandler({
      dir: { output: '/output' },
      results: mockResults,
    });

    expect(mockFs.writeFile).toHaveBeenCalledWith('/output/_redirects', '/test /target 301\n');
  });

  it('should read website config from filesystem when not in results', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: '/target',
        },
      ],
    };

    mockFs.readFile.mockResolvedValue(JSON.stringify(mockWebsiteConfig));

    await onEventHandler({
      dir: { output: '/output' },
      results: [{}],
    });

    expect(mockFs.readFile).toHaveBeenCalledWith('/src/_data/website.json', 'utf-8');
    expect(mockFs.writeFile).toHaveBeenCalledWith('/output/_redirects', '/test /target 301\n');
  });

  it('should handle filesystem read errors gracefully', async () => {
    mockFs.readFile.mockRejectedValue(new Error('File not found'));
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    await onEventHandler({
      dir: { output: '/output' },
      results: [{}],
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Eleventy] Redirects plugin: Could not read website.json')
    );
    expect(mockFs.writeFile).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('should handle validation errors', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: 'invalid-path', // Missing leading slash
          destination: '/target',
        },
      ],
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(
      onEventHandler({
        dir: { output: '/output' },
        results: mockResults,
      })
    ).rejects.toThrow('Redirects validation failed');

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Eleventy] Redirects validation errors:');

    consoleErrorSpy.mockRestore();
  });

  it('should handle warnings', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '',
          destination: '/target',
        } as unknown as { source: string; destination: string },
        {
          source: '/valid',
          destination: '/target',
        },
      ],
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    await onEventHandler({
      dir: { output: '/output' },
      results: mockResults,
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith('[Eleventy] Redirects warnings:');
    expect(mockFs.writeFile).toHaveBeenCalledWith('/output/_redirects', '/valid /target 301\n');

    consoleWarnSpy.mockRestore();
  });

  it('should handle write errors', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: '/target',
        },
      ],
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    mockFs.writeFile.mockRejectedValue(new Error('Write permission denied'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(
      onEventHandler({
        dir: { output: '/output' },
        results: mockResults,
      })
    ).rejects.toThrow('Write permission denied');

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[Eleventy] Failed to write _redirects'));

    consoleErrorSpy.mockRestore();
  });

  it('should skip writing when no content', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    await onEventHandler({
      dir: { output: '/output' },
      results: mockResults,
    });

    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('should create output directory', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: '/target',
        },
      ],
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    await onEventHandler({
      dir: { output: '/output' },
      results: mockResults,
    });

    expect(mockFs.mkdir).toHaveBeenCalledWith('/output', { recursive: true });
  });

  it('should log success message', async () => {
    const mockWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: [
        {
          source: '/test',
          destination: '/target',
        },
      ],
    };

    const mockResults = [
      {
        data: {
          website: mockWebsiteConfig,
        },
      },
    ];

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    await onEventHandler({
      dir: { output: '/output' },
      results: mockResults,
    });

    expect(consoleLogSpy).toHaveBeenCalledWith('[Eleventy] Wrote /output/_redirects');

    consoleLogSpy.mockRestore();
  });
});
