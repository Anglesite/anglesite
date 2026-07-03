import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'scripts', 'design-import', 'canva-safari.mjs');
const FAKE = join(here, 'fixtures', 'fake-safaridriver.mjs');

function run(args, env = {}, expectFail = false) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, SAFARIDRIVER_PATH: FAKE, ...env },
    });
    return { status: 0, stdout };
  } catch (err) {
    if (!expectFail) throw err;
    return { status: err.status, stdout: err.stdout?.toString() ?? '' };
  }
}

describe('canva-safari --check', () => {
  it('exits 0 and reports the binary when usable', () => {
    const { status, stdout } = run(['--check']);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ backend: 'safari', binary: FAKE });
  });

  it('exits 3 when remote automation is not enabled', () => {
    const { status } = run(['--check'], { FAKE_SAFARIDRIVER_MODE: 'not-enabled' }, true);
    expect(status).toBe(3);
  });

  it('exits 2 when no safaridriver is found', () => {
    const { status } = run(['--check'], { SAFARIDRIVER_PATH: '/nonexistent/safaridriver' }, true);
    expect(status).toBe(2);
  });
});

describe('canva-safari single-page extraction', () => {
  it('returns the canva-playwright page contract: tokens, sections, navigation, images', () => {
    const { status, stdout } = run(['https://demo.my.canva.site']);
    expect(status).toBe(0);
    const result = JSON.parse(stdout);

    expect(result.tokens.colors).toEqual({
      background: '#f5f5f5',
      text: '#141414',
      primary: '#c81e3c',
      accent: '#1e5ab4',
    });
    // Canva Sans is a Canva system font and must be filtered out
    expect(result.tokens.fonts).toEqual(['Playfair Display', 'Open Sans']);

    expect(result.sections).toHaveLength(1);
    const [section] = result.sections;
    expect(section.index).toBe(0);
    expect(section.elements[0]).toMatchObject({
      type: 'text',
      content: 'Welcome',
      style: { fontSize: 48, fontFamily: 'Playfair Display' },
    });
    expect(section.elements[1]).toMatchObject({
      type: 'image',
      content: 'https://cdn.example/hero.jpg',
    });

    expect(result.navigation).toEqual([{ label: 'About', path: '/about' }]);
    expect(result.images).toEqual([{ src: 'https://cdn.example/hero.jpg', alt: 'Hero' }]);
  });

  it('skips tokens with --content-only', () => {
    const { stdout } = run(['https://demo.my.canva.site', '--content-only']);
    const result = JSON.parse(stdout);
    expect(result.tokens).toBeNull();
    expect(result.sections).toHaveLength(1);
  });
});

describe('canva-safari --site crawl', () => {
  it('crawls nav subpages in one session, tokens from homepage only, images deduped', () => {
    const { status, stdout } = run(['https://demo.my.canva.site', '--site']);
    expect(status).toBe(0);
    const result = JSON.parse(stdout);

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].url).toBe('https://demo.my.canva.site');
    expect(result.pages[0].tokens.fonts).toEqual(['Playfair Display', 'Open Sans']);
    expect(result.pages[1].url).toBe('https://demo.my.canva.site/about');
    expect(result.pages[1].tokens).toBeNull();

    // hero.jpg appears on both pages but must be deduplicated
    expect(result.images).toEqual([{ src: 'https://cdn.example/hero.jpg', alt: 'Hero' }]);
    expect(result.navigation).toEqual([{ label: 'About', path: '/about' }]);
    expect(result.tokens.colors.primary).toBe('#c81e3c');
  });

  it('exits 1 when the site cannot be extracted', () => {
    const { status } = run(['https://fails.example', '--site'], {}, true);
    expect(status).toBe(1);
  });
});
