import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, '..', 'skills', 'convert', 'SKILL.md'),
  'utf-8',
);
const ssgMigrations = readFileSync(
  join(__dirname, '..', 'docs', 'import', 'ssg-migrations.md'),
  'utf-8',
);

describe('convert skill completeness', () => {
  it('includes a step to update the homepage for blog sites', () => {
    expect(skill).toContain('index.astro');
    expect(skill).toContain('homepage');
  });

  it('replaces the scaffold placeholder instead of leaving it', () => {
    // The skill should instruct replacing the "Welcome" placeholder
    expect(skill).toMatch(/replace|update|overwrite/i);
    expect(skill).toContain('SITE_TYPE');
  });

  it('makes the homepage show blog posts for blog site types', () => {
    expect(skill).toContain('getCollection');
  });
});

describe('convert skill URL structure (#33)', () => {
  it('asks the owner about URL structure before converting', () => {
    // The skill must ask whether to keep /{slug}/ or use /blog/{slug}/
    expect(skill).toMatch(/url structure|URL structure|URL prefix|url prefix/i);
  });

  it('stores the chosen URL prefix in .site-config', () => {
    // The URL prefix choice must be persisted so other skills can use it
    expect(skill).toContain('POST_URL_PREFIX');
  });

  it('uses the chosen prefix in the homepage template, not hardcoded /blog/', () => {
    // The homepage href should reference the variable, not hardcode /blog/
    // Extract the homepage code block from the skill
    const homepageSection = skill.match(/Step 4\.5.*?(?=## Step [56])/s)?.[0] ?? '';
    expect(homepageSection).toContain('POST_URL_PREFIX');
  });

  it('skips redirects when source and target URL patterns match', () => {
    // If the source site uses /{slug}/ and the owner keeps that pattern,
    // no redirects should be generated for blog posts
    expect(skill).toMatch(/skip redirect|no redirect|same.*pattern|same.*url/i);
  });

  it('offers /{slug}/ as an option alongside /blog/{slug}/', () => {
    // The skill must present both options
    expect(skill).toMatch(/\/{slug}\//);
    expect(skill).toMatch(/\/blog\/{slug}\//);
  });
});

describe('convert skill branding extraction (#63)', () => {
  it('includes a step to extract visual identity from the source site', () => {
    // The skill must read CSS, layout templates, and data files
    expect(skill).toMatch(/extract visual identity|visual identity/i);
  });

  it('reads source CSS files for colors and fonts', () => {
    // Step 1.5a: find and read CSS files to extract design tokens
    expect(skill).toContain('--color-primary');
    expect(skill).toContain('font-family');
    expect(skill).toContain('global.css');
  });

  it('reads layout templates for header and footer structure', () => {
    // Step 1.5b: extract header (logo, nav) and footer (social, copyright)
    expect(skill).toMatch(/header.*structure|header structure/i);
    expect(skill).toMatch(/footer.*structure|footer structure/i);
    expect(skill).toContain('logo');
    expect(skill).toContain('navigation');
  });

  it('reads data and config files for site metadata', () => {
    // Step 1.5c: read data files for site title, social links, etc.
    expect(skill).toMatch(/data.*config.*files|config.*files/i);
    expect(skill).toContain('social');
  });

  it('copies static assets like logos and favicons', () => {
    // Step 1.5d: copy logo, favicon, avatar to public/
    expect(skill).toContain('logo');
    expect(skill).toContain('favicon');
  });

  it('applies extracted design to global.css', () => {
    // Step 1.5e: update CSS custom properties with source values
    expect(skill).toContain('--color-bg');
    expect(skill).toContain('--color-text');
    expect(skill).toContain('--max-width');
  });

  it('updates BaseLayout.astro with header and footer from source', () => {
    // Step 1.5e: update layout with logo, nav, social links
    expect(skill).toContain('BaseLayout.astro');
    expect(skill).toMatch(/header.*logo|logo.*header/is);
    expect(skill).toContain('social-links');
  });

  it('handles dark mode if present in source', () => {
    // Dark mode support should be carried over
    expect(skill).toContain('prefers-color-scheme: dark');
  });

  it('self-hosts external fonts per ADR-0008', () => {
    // External fonts must be downloaded, not linked
    expect(skill).toContain('ADR-0008');
    expect(skill).toMatch(/@font-face/);
  });

  it('has a fallback when no design files are found', () => {
    // Graceful degradation to scaffold defaults
    expect(skill).toMatch(/fallback|couldn.*find.*design/i);
  });

  it('covers CSS locations for all supported platforms', () => {
    // The CSS discovery table should include paths for each SSG
    const step15 = skill.match(/Step 1\.5.*?(?=## Step 2)/s)?.[0] ?? '';
    expect(step15).toContain('Hugo');
    expect(step15).toContain('Jekyll');
    expect(step15).toContain('Eleventy');
    expect(step15).toContain('Next.js');
    expect(step15).toContain('Gatsby');
  });
});

describe('ssg-migrations redirect guidance (#33)', () => {
  it('does not hardcode /blog/ as the only redirect target', () => {
    // The redirect examples should use a placeholder or show both patterns
    const redirectSection = ssgMigrations.match(/## Redirect generation.*$/s)?.[0] ?? '';
    expect(redirectSection).toContain('POST_URL_PREFIX');
  });
});
