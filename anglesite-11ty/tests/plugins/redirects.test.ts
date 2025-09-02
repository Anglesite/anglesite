import { describe, it, expect } from '@jest/globals';
import { generateRedirects } from '../../plugins/redirects';
import { AnglesiteWebsiteConfiguration } from '../../types/website';

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
});
