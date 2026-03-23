import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAFFOLD_SCRIPT = join(__dirname, '..', 'scripts', 'scaffold.sh');

describe('scaffold.sh .gitignore merging', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'anglesite-scaffold-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends Astro build artifacts to an existing .gitignore', () => {
    // Simulate an Eleventy project with its own .gitignore
    writeFileSync(
      join(tmpDir, '.gitignore'),
      '_site/\nnode_modules\n.env\n',
    );

    execFileSync('/bin/zsh', [SCAFFOLD_SCRIPT, '--yes', tmpDir], {
      stdio: 'pipe',
    });

    const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');

    // Must contain Astro build artifacts
    expect(gitignore).toMatch(/^dist\/?$/m);
    expect(gitignore).toMatch(/^\.astro\/?$/m);

    // Must preserve existing entries
    expect(gitignore).toContain('_site/');
  });

  it('does not duplicate entries already present', () => {
    // .gitignore that already has the required entries
    writeFileSync(
      join(tmpDir, '.gitignore'),
      'dist\n.astro\nnode_modules\n',
    );

    execFileSync('/bin/zsh', [SCAFFOLD_SCRIPT, '--yes', tmpDir], {
      stdio: 'pipe',
    });

    const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    const distMatches = gitignore.match(/^dist\/?$/gm);
    expect(distMatches).toHaveLength(1);
  });

  it('handles entries with trailing slashes (dist/ instead of dist)', () => {
    writeFileSync(
      join(tmpDir, '.gitignore'),
      'dist/\n.astro/\nnode_modules\n',
    );

    execFileSync('/bin/zsh', [SCAFFOLD_SCRIPT, '--yes', tmpDir], {
      stdio: 'pipe',
    });

    const gitignore = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    // Should not add a duplicate — dist/ and dist are equivalent in git
    const distMatches = gitignore.match(/^dist\/?$/gm);
    expect(distMatches).toHaveLength(1);
  });
});
