import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  join(__dirname, '..', 'template', 'src', 'styles', 'global.css'),
  'utf-8',
);

describe('global.css accessibility', () => {
  it('includes prefers-reduced-motion media query', () => {
    expect(css).toContain('prefers-reduced-motion');
  });

  it('reduces or removes animations when reduced motion is preferred', () => {
    // Should set animation and transition to none/reduced
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*animation/);
  });

  it('does not contain outline: none or outline: 0', () => {
    // WCAG: never remove focus outlines globally
    expect(css).not.toMatch(/outline\s*:\s*none/);
    expect(css).not.toMatch(/outline\s*:\s*0(?!\.\d)/);
  });

  it('has text-decoration on links within content areas', () => {
    // Links should be underlined by default (not relying on color alone)
    expect(css).toMatch(/text-decoration\s*:\s*underline/);
  });

  it('has focus-visible styles on links', () => {
    expect(css).toMatch(/a\s*:focus-visible|a:focus-visible/);
  });
});
