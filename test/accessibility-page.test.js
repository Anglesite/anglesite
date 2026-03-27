import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = join(
  __dirname,
  '..',
  'template',
  'src',
  'pages',
  'accessibility.astro',
);

describe('accessibility statement page', () => {
  it('exists in the template', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf-8') : '';

  it('uses BaseLayout', () => {
    expect(page).toContain('BaseLayout');
  });

  it('references WCAG 2.2 AA', () => {
    expect(page).toMatch(/WCAG[\s\S]*?2\.2[\s\S]*?AA/i);
  });

  it('includes a contact mechanism for reporting issues', () => {
    // Should mention email or contact form for accessibility feedback
    expect(page).toMatch(/contact|email|report/i);
  });

  it('has a single h1', () => {
    const h1s = page.match(/<h1/g);
    expect(h1s).toHaveLength(1);
  });

  it('does not skip heading levels', () => {
    // Should not jump from h1 to h3
    expect(page).not.toMatch(/<h1[\s\S]*?<h3/);
  });

  it('includes a last-audited date placeholder', () => {
    // Should show when the page was last audited
    expect(page).toMatch(/audit|review|update/i);
  });

  it('discloses known limitations section', () => {
    expect(page).toMatch(/limitation|known issue/i);
  });
});
