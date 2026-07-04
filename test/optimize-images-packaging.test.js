import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_OPTIMIZE = join(REPO_ROOT, 'server', 'optimize-images.mjs');
const TEMPLATE_OPTIMIZE = join(REPO_ROOT, 'template', 'server', 'optimize-images.mjs');
const SCAFFOLD_SCRIPT = join(REPO_ROOT, 'scripts', 'scaffold.sh');

// ---------------------------------------------------------------------------
// Single-source-of-truth guard (regression for #320)
//
// The optimize core runs from two install locations that share no filesystem
// path at runtime: the plugin's MCP server (server/optimize-images.mjs) and a
// scaffolded site's CLI (template/server/optimize-images.mjs, copied in by
// scaffold.sh). The module must therefore physically ship in both, but the two
// copies must stay byte-identical. This guard makes drift a CI failure instead
// of a silent divergence.
// ---------------------------------------------------------------------------

describe('optimize-images packaging (#320)', () => {
  it('ships the optimize core inside template/server/', () => {
    expect(existsSync(TEMPLATE_OPTIMIZE)).toBe(true);
  });

  it('keeps template/server/optimize-images.mjs byte-identical to the plugin-root copy', () => {
    const plugin = readFileSync(PLUGIN_OPTIMIZE, 'utf-8');
    const template = readFileSync(TEMPLATE_OPTIMIZE, 'utf-8');
    expect(template).toBe(plugin);
  });

  it('the CLI wrapper imports the colocated module, not the bare @dwk/anglesite specifier', () => {
    const cli = readFileSync(
      join(REPO_ROOT, 'template', 'scripts', 'optimize-images.ts'),
      'utf-8',
    );
    // The bare specifier is what broke in #320 — a scaffolded site IS the
    // package, so it can't resolve "@dwk/anglesite" from its own node_modules.
    // Assert on the import target specifically (a mention in a comment is fine).
    expect(cli).not.toMatch(/import\([^)]*["']@dwk\/anglesite/);
    expect(cli).not.toMatch(/from\s+["']@dwk\/anglesite/);
    expect(cli).toContain('../server/optimize-images.mjs');
  });
});

// ---------------------------------------------------------------------------
// End-to-end regression: scaffold a site and run `npm run ai-optimize`.
//
// Requires zsh (scaffold.sh) and tsx. Skipped where zsh is unavailable, like
// the existing scaffold-gitignore suite.
// ---------------------------------------------------------------------------

const hasZsh = (() => {
  try {
    execFileSync('/bin/zsh', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasZsh)('ai-optimize in a scaffolded site (#320)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'anglesite-optimize-e2e-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scaffolds server/optimize-images.mjs alongside the CLI script', () => {
    execFileSync('/bin/zsh', [SCAFFOLD_SCRIPT, '--yes', tmpDir], { stdio: 'pipe' });
    expect(existsSync(join(tmpDir, 'server', 'optimize-images.mjs'))).toBe(true);
    expect(existsSync(join(tmpDir, 'scripts', 'optimize-images.ts'))).toBe(true);
  });

  it('runs the optimize script against a fixture JPEG without ERR_MODULE_NOT_FOUND', async () => {
    execFileSync('/bin/zsh', [SCAFFOLD_SCRIPT, '--yes', tmpDir], { stdio: 'pipe' });

    // Stand in for the site's `npm install`: in a real scaffolded site,
    // `server/optimize-images.mjs` resolves `sharp` from the site's OWN
    // node_modules/ (sharp is a template devDependency), the first hop of
    // Node's walk-up. The sandbox scaffold isn't installed, so link the
    // plugin's node_modules — which carries the same sharp ^0.33 — into the
    // site root. This supplies only third-party deps: node_modules/@dwk does
    // not exist here, so a regressed bare `@dwk/anglesite` import (the actual
    // #320 bug) would still fail through this link.
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(tmpDir, 'node_modules'), 'dir');
    // Guard the guard: if a @dwk/* package is ever installed at the repo root,
    // a bare `@dwk/anglesite` import would resolve through this link and this
    // e2e would silently stop catching the #320 regression — fail loudly instead.
    expect(existsSync(join(REPO_ROOT, 'node_modules', '@dwk'))).toBe(false);

    // Drop one unoptimized JPEG into public/images/.
    const imagesDir = join(tmpDir, 'public', 'images');
    execFileSync('mkdir', ['-p', imagesDir]);
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    writeFileSync(join(imagesDir, 'sample.jpg'), jpeg);

    // Run the CLI exactly as `npm run ai-optimize` would, resolving tsx from
    // the plugin's own node_modules (the scaffolded site isn't `npm install`ed
    // in this sandbox, but the script + module are what we're exercising).
    // --no-alt: on machines where the on-device `fm` model is installed, the
    // alt-text pass would do a real inference call whose cold model load can
    // exceed the vitest timeout. Module resolution — what #320 is about — is
    // unaffected by skipping it.
    const tsx = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
    const out = execFileSync(tsx, ['scripts/optimize-images.ts', '--no-alt'], {
      cwd: tmpDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    expect(out).not.toContain('ERR_MODULE_NOT_FOUND');
    // A WebP variant should now exist next to the original.
    expect(existsSync(join(imagesDir, 'sample.webp'))).toBe(true);
    // The original should be preserved.
    expect(existsSync(join(imagesDir, 'originals', 'sample.jpg'))).toBe(true);
  });
});
