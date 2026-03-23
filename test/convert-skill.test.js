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

describe('ssg-migrations redirect guidance (#33)', () => {
  it('does not hardcode /blog/ as the only redirect target', () => {
    // The redirect examples should use a placeholder or show both patterns
    const redirectSection = ssgMigrations.match(/## Redirect generation.*$/s)?.[0] ?? '';
    expect(redirectSection).toContain('POST_URL_PREFIX');
  });
});
