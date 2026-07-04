import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'scripts', 'import', 'browser', 'safari-driver.mjs');
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

describe('safari-driver --check', () => {
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

describe('safari-driver extraction', () => {
  it('emits one NDJSON line per URL; tokens only on the first', () => {
    const { stdout } = run(['https://a.example', 'https://b.example']);
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].content.body).toBe('Hello from the fake page');
    expect(lines[0].tokens['--font-heading']).toBe('Poppins');
    expect(lines[0].tokens['--color-bg']).toBe('#c8a47e');
    expect(lines[1].tokens).toBeNull();
  });

  it('emits an error line for a failing page and still exits 0 when others succeed', () => {
    const { status, stdout } = run(['https://fails.example', 'https://ok.example']);
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(status).toBe(0);
    expect(lines[0].error).toMatch(/navigation failed/);
    expect(lines[1].content.body).toBeTruthy();
  });

  it('rescues an empty extractor body via get_page_content', () => {
    const { stdout } = run(['https://empty.example', '--content-only'], { FAKE_EMPTY_BODY: '1' });
    const line = JSON.parse(stdout.trim().split('\n')[0]);
    expect(line.content.body).toContain('Rescued markdown body');
    expect(line.content.images[0].src).toBe('https://cdn.example/rescued.jpg');
  });

  it('falls back to a later page for design tokens when the homepage style extraction fails', () => {
    const { stdout } = run(
      ['https://a.example', 'https://b.example', 'https://c.example'],
      { FAKE_TOKENS_FAIL_URL: 'https://a.example' },
    );
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0].tokens).toBeNull();
    expect(lines[1].tokens['--font-heading']).toBe('Poppins');
    expect(lines[2].tokens).toBeNull(); // tokens already captured on page 2
  });

  it('emits an error line for every remaining URL when automation becomes disabled mid-batch', () => {
    const { status, stdout } = run(
      ['https://a.example', 'https://b.example', 'https://c.example'],
      { FAKE_SAFARIDRIVER_MODE: 'not-enabled-second-url' },
      true,
    );
    expect(status).toBe(3);
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0].content.body).toBeTruthy();
    expect(lines[1].error).toBeTruthy();
    expect(lines[2].error).toBeTruthy();
  });
});
