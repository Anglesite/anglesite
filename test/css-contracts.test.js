import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stylesDir = join(__dirname, '..', 'template', 'src', 'styles');

const cssFiles = readdirSync(stylesDir)
  .filter((f) => f.endsWith('.css'))
  .map((name) => ({
    name,
    content: readFileSync(join(stylesDir, name), 'utf-8'),
  }));

describe('CSS contracts', () => {
  it('discovers at least one stylesheet', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  for (const file of cssFiles) {
    describe(file.name, () => {
      it('uses CSS custom properties (no hardcoded design tokens)', () => {
        expect(file.content).toContain('var(--');
      });

      it('only uses !important inside @media print or prefers-reduced-motion', () => {
        // Split by @media blocks — any !important outside those blocks is a violation
        // Strategy: remove all @media print and @media (prefers-reduced-motion) blocks,
        // then check that no !important remains
        const withoutMedia = file.content
          // Remove @media print { ... } blocks (handles nested braces one level deep)
          .replace(/@media\s+print\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '')
          // Remove @media (prefers-reduced-motion: ...) { ... } blocks
          .replace(/@media\s*\(prefers-reduced-motion[^)]*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '');

        expect(withoutMedia).not.toContain('!important');
      });
    });
  }
});
