import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, '..', 'skills', 'convert', 'SKILL.md'),
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
