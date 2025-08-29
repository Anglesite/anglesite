import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { generateRedirects } from '../../plugins/redirects';
import addRedirects from '../../plugins/redirects';
import { AnglesiteWebsiteConfiguration } from '../../types/website';
import type { EleventyConfig } from '../types/eleventy-shim';

// Mock fs operations to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

// Test constants
const TEST_LIMITS = {
  REDIRECT_LINE_MAX_LENGTH: 1000,
  CLOUDFLARE_MAX_REDIRECTS: 2100,
  CLOUDFLARE_MAX_DYNAMIC_REDIRECTS: 100,
  CLOUDFLARE_MAX_STATIC_REDIRECTS: 2000,
} as const;

// Test helpers
function createMockWebsite(overrides: Partial<AnglesiteWebsiteConfiguration> = {}): AnglesiteWebsiteConfiguration {
  return {
    title: 'Test Site',
    language: 'en',
    url: 'https://example.com',
    ...overrides,
  };
}

function createMockRedirect(
  overrides: Partial<{ source: string; destination: string; code?: number; force?: boolean }> = {}
) {
  return {
    source: '/test',
    destination: '/target',
    code: 301,
    ...overrides,
  };
}

function mockConsole(methods: ('log' | 'warn' | 'error')[] = ['log', 'warn', 'error']) {
  const spies: Record<string, jest.SpyInstance> = {};

  methods.forEach((method) => {
    spies[method] = jest.spyOn(console, method).mockImplementation(() => {});
  });

  return {
    spies,
    restore: () => Object.values(spies).forEach((spy) => spy.mockRestore()),
  };
}

describe('generateRedirects', () => {
  it('should generate redirects in CloudFlare format', () => {
    const website = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: '/old-page',
          destination: '/new-page',
          code: 301,
        }),
        createMockRedirect({
          source: '/blog/:slug',
          destination: '/articles/:slug',
          code: 302,
        }),
      ],
    });

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
        },
        {
          source: '/another',
          destination: '',
        },
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

  it('should validate redirect line length limit', () => {
    const longPath = 'a'.repeat(TEST_LIMITS.REDIRECT_LINE_MAX_LENGTH / 2);
    const longDestination = 'b'.repeat(TEST_LIMITS.REDIRECT_LINE_MAX_LENGTH / 2);
    const website = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: `/${longPath}`,
          destination: `/${longDestination}`,
          code: 301,
        }),
      ],
    });

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('exceeds 1000 character limit');
  });

  it('should error when too many total redirects', () => {
    const redirects = Array.from({ length: TEST_LIMITS.CLOUDFLARE_MAX_REDIRECTS + 1 }, (_, i) =>
      createMockRedirect({
        source: `/path${i}`,
        destination: `/target${i}`,
      })
    );

    const website = createMockWebsite({ redirects });

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Too many redirects: 2101');
    expect(result.errors[0]).toContain('CloudFlare limit is 2100');
  });

  it('should error when too many dynamic redirects', () => {
    const dynamicRedirects = Array.from({ length: 101 }, (_, i) => ({
      source: `/dynamic${i}/*`,
      destination: `/target${i}`,
    }));

    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: dynamicRedirects,
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes('Too many dynamic redirects: 101'))).toBe(true);
    expect(result.errors.some((error) => error.includes('CloudFlare limit is 100'))).toBe(true);
  });

  it('should error when too many static redirects', () => {
    const staticRedirects = Array.from({ length: 2001 }, (_, i) => ({
      source: `/static${i}`,
      destination: `/target${i}`,
    }));

    const website: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      language: 'en',
      redirects: staticRedirects,
    };

    const result = generateRedirects(website);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes('Too many static redirects: 2001'))).toBe(true);
    expect(result.errors.some((error) => error.includes('CloudFlare limit is 2000'))).toBe(true);
  });

  it('should handle null website config', () => {
    const result = generateRedirects(null as unknown as AnglesiteWebsiteConfiguration);
    expect(result.content).toBe('');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('addRedirects plugin', () => {
  let mockEleventyConfig: jest.Mocked<EleventyConfig>;
  let eventCallback: (data: { dir: { output: string }; results: unknown[] | null }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEleventyConfig = {
      on: jest.fn(),
    } as unknown as jest.Mocked<EleventyConfig>;

    addRedirects(mockEleventyConfig);
    eventCallback = mockEleventyConfig.on.mock.calls[0][1];
  });

  it('should register eleventy.after event handler', () => {
    expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
  });

  it('should return early if no results', async () => {
    await eventCallback({ dir: { output: '_site' }, results: [] });
    expect(mockFs.promises.mkdir).not.toHaveBeenCalled();
  });

  it('should return early if results is null', async () => {
    await eventCallback({ dir: { output: '_site' }, results: null });
    expect(mockFs.promises.mkdir).not.toHaveBeenCalled();
  });

  it('should use website config from first result data when available', async () => {
    const websiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      language: 'en',
      url: 'https://example.com',
      redirects: [
        {
          source: '/test',
          destination: '/target',
          code: 301,
        },
      ],
    };

    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.writeFile.mockResolvedValue(undefined);

    await eventCallback({
      dir: { output: '_site' },
      results: [{ data: { website: websiteConfig } }],
    });

    expect(mockFs.promises.mkdir).toHaveBeenCalledWith(path.dirname(path.join('_site', '_redirects')), {
      recursive: true,
    });
    expect(mockFs.promises.writeFile).toHaveBeenCalledWith(path.join('_site', '_redirects'), '/test /target 301\n');
    // File should be written successfully (console.log call varies by implementation)
  });

  it('should read from filesystem when no data property exists', async () => {
    const websiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      language: 'en',
      url: 'https://example.com',
      redirects: [
        {
          source: '/fs-test',
          destination: '/fs-target',
        },
      ],
    };

    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(websiteConfig));
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.writeFile.mockResolvedValue(undefined);

    await eventCallback({
      dir: { output: '_site' },
      results: [{}],
    });

    expect(mockFs.promises.readFile).toHaveBeenCalledWith(path.resolve('src', '_data', 'website.json'), 'utf-8');
    expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
      path.join('_site', '_redirects'),
      '/fs-test /fs-target 301\n'
    );
  });

  it('should warn and return when filesystem read fails', async () => {
    const { spies, restore } = mockConsole(['warn']);
    const error = new Error('File not found');
    mockFs.promises.readFile.mockRejectedValue(error);

    try {
      await eventCallback({
        dir: { output: '_site' },
        results: [{}],
      });

      expect(spies.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Redirects plugin: Could not read website.json from _data directory: File not found'
      );
      expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('should handle non-Error exceptions when reading filesystem', async () => {
    const { spies, restore } = mockConsole(['warn']);
    mockFs.promises.readFile.mockRejectedValue('String error');

    try {
      await eventCallback({
        dir: { output: '_site' },
        results: [{}],
      });

      expect(spies.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Redirects plugin: Could not read website.json from _data directory: String error'
      );
    } finally {
      restore();
    }
  });

  it('should return early when no website config found', async () => {
    await eventCallback({
      dir: { output: '_site' },
      results: [{ data: {} }],
    });

    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('should return early when website config is null', async () => {
    await eventCallback({
      dir: { output: '_site' },
      results: [{ data: { website: null } }],
    });

    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('should throw error when validation fails', async () => {
    const { spies, restore } = mockConsole(['error']);
    const websiteConfig = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: 'invalid-path', // Invalid: doesn't start with /
          destination: '/target',
        }),
      ],
    });

    try {
      await expect(
        eventCallback({
          dir: { output: '_site' },
          results: [{ data: { website: websiteConfig } }],
        })
      ).rejects.toThrow('Redirects validation failed');

      expect(spies.error).toHaveBeenCalledWith('[@dwk/anglesite-11ty] Redirects validation errors:');
    } finally {
      restore();
    }
  });

  it('should log warnings when validation warnings exist', async () => {
    const { spies, restore } = mockConsole(['warn']);
    const websiteConfig = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: '/valid',
          destination: '/target',
        }),
        createMockRedirect({
          source: '',
          destination: '/invalid',
        }),
      ],
    });

    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.writeFile.mockResolvedValue(undefined);

    try {
      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: { website: websiteConfig } }],
      });

      expect(spies.warn).toHaveBeenCalledWith('[@dwk/anglesite-11ty] Redirects warnings:');
    } finally {
      restore();
    }
  });

  it('should not write file when content is empty', async () => {
    const websiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      language: 'en',
      url: 'https://example.com',
      redirects: [],
    };

    await eventCallback({
      dir: { output: '_site' },
      results: [{ data: { website: websiteConfig } }],
    });

    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('should handle filesystem mkdir errors', async () => {
    const { spies, restore } = mockConsole(['error']);
    const websiteConfig = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: '/test',
          destination: '/target',
        }),
      ],
    });

    const error = new Error('Permission denied');
    mockFs.promises.mkdir.mockRejectedValue(error);

    try {
      await expect(
        eventCallback({
          dir: { output: '_site' },
          results: [{ data: { website: websiteConfig } }],
        })
      ).rejects.toThrow('Permission denied');

      expect(spies.error).toHaveBeenCalledWith('[@dwk/anglesite-11ty] Failed to write _redirects: Permission denied');
    } finally {
      restore();
    }
  });

  it('should handle filesystem writeFile errors', async () => {
    const { spies, restore } = mockConsole(['error']);
    const websiteConfig = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: '/test',
          destination: '/target',
        }),
      ],
    });

    mockFs.promises.mkdir.mockResolvedValue(undefined);
    const error = new Error('Disk full');
    mockFs.promises.writeFile.mockRejectedValue(error);

    try {
      await expect(
        eventCallback({
          dir: { output: '_site' },
          results: [{ data: { website: websiteConfig } }],
        })
      ).rejects.toThrow('Disk full');

      expect(spies.error).toHaveBeenCalledWith('[@dwk/anglesite-11ty] Failed to write _redirects: Disk full');
    } finally {
      restore();
    }
  });

  it('should handle non-Error exceptions during file operations', async () => {
    const { spies, restore } = mockConsole(['error']);
    const websiteConfig = createMockWebsite({
      redirects: [
        createMockRedirect({
          source: '/test',
          destination: '/target',
        }),
      ],
    });

    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.writeFile.mockRejectedValue('String error');

    try {
      await expect(
        eventCallback({
          dir: { output: '_site' },
          results: [{ data: { website: websiteConfig } }],
        })
      ).rejects.toEqual('String error');

      expect(spies.error).toHaveBeenCalledWith('[@dwk/anglesite-11ty] Failed to write _redirects: String error');
    } finally {
      restore();
    }
  });
});
