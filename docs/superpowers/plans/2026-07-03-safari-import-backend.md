# Safari MCP Rendered-Extraction Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Apple's Safari MCP server (`safaridriver --mcp`) as the preferred rendered-page extraction backend for Wix and Squarespace imports, give Squarespace its first rendered tier (design tokens, accordions, galleries), and document Squarespace's `?format=json` endpoint.

**Architecture:** A new platform-neutral `scripts/import/browser/` layer: `page-functions.mjs` (browser-context extractors shared with the existing Playwright driver), `safari-mcp.mjs` (a small stdio JSON-RPC client that spawns `safaridriver --mcp` as a child process — no MCP client configuration), and `safari-driver.mjs` (a CLI with the same `{tokens, content}` contract as `wix-playwright.mjs`, multi-URL NDJSON output, one browser session per invocation). The import skill resolves `RENDER_BACKEND` once (Safari → Playwright) in a new Step 1a.2.

**Tech Stack:** Node >=22 ESM, Vitest 3.1.1, jsdom (new devDependency, tests only). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-safari-import-backend-design.md`

## Global Constraints

- Node >=22, ESM (`.mjs`), ISC license.
- No new runtime dependencies; jsdom is devDependency-only.
- Cross-platform rule (root CLAUDE.md): Safari is an optional macOS accelerator; Playwright/curl fallbacks must remain fully functional and documented.
- Never edit `agent-skills/` by hand — run `npm run build:agent-skills` after any `skills/` change; CI fails if stale.
- The end user is non-technical: skill copy must avoid CLI jargon and explain the visible Safari window.
- Validated Safari MCP gotchas (encode, do not rediscover): `evaluate_javascript` rejects top-level `return` (use bare IIFE `(${fn})()`); `get_page_content` defaults truncate paragraphs to 15 words and strip URL params (`maxWordsPerParagraph: 5000`, `shortenURLs: false` required); network buffer must be armed before navigation (not used in this plan); each `safaridriver --mcp` process is an isolated session; MCP protocol version `2024-11-05`, newline-delimited JSON-RPC on stdio.
- All test commands run from the repo root: `npx vitest run <file> --reporter=basic`.

---

### Task 1: Fix the `fullPage` ReferenceError in `extractContentSrc` (pre-existing bug)

`scripts/import/wix/wix-playwright.mjs` contains two copies of the fullPage header/footer block inside `extractContentSrc`. The first (lines ~222–251, `if (fullPage) {`) references an undefined variable and throws `ReferenceError: Can't find variable: fullPage` on **every** call in a real browser — verified live 2026-07-03 in both Safari and by inspection. The second copy (lines ~275–307, `if (options?.fullPage) {`) is correct. Existing tests never execute the function, so add a jsdom test that does.

**Files:**
- Modify: `scripts/import/wix/wix-playwright.mjs` (delete the first, broken block)
- Modify: `package.json` (add jsdom devDependency)
- Test: `test/wix-page-functions.test.js` (new)

**Interfaces:**
- Consumes: existing exports `extractStylesSrc`, `extractContentSrc` from `scripts/import/wix/wix-playwright.mjs`; fixture `test/fixtures/wix-blog-post.html`.
- Produces: `extractContentSrc(options)` that executes without throwing in a DOM and returns `{body, images, title, navLinks, tags}` (plus `header`/`footer` when `options.fullPage`). Task 2 moves this exact function.

- [ ] **Step 1: Add jsdom devDependency**

```sh
npm install --save-dev jsdom
```

- [ ] **Step 2: Write the failing test**

Create `test/wix-page-functions.test.js`:

```js
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { extractContentSrc } from '../scripts/import/wix/wix-playwright.mjs';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('extractContentSrc (executed in a DOM)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = readFileSync(
      join(fixtureDir, 'wix-blog-post.html'),
      'utf8',
    );
  });

  it('runs without throwing and returns the content shape', () => {
    const result = extractContentSrc({});
    expect(result).toMatchObject({
      images: expect.any(Array),
      navLinks: expect.any(Array),
      tags: expect.any(Array),
    });
    expect(typeof result.body).toBe('string');
    expect(result.body.length).toBeGreaterThan(0);
  });

  it('only attaches header/footer in fullPage mode', () => {
    expect(extractContentSrc({}).header).toBeUndefined();
    const full = extractContentSrc({ fullPage: true });
    expect(full.header).toBeDefined();
    expect(full.footer).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/wix-page-functions.test.js --reporter=basic`
Expected: FAIL with `ReferenceError: fullPage is not defined`

- [ ] **Step 4: Delete the broken duplicate block**

In `scripts/import/wix/wix-playwright.mjs`, delete the entire first fullPage block — it starts with the comment-free `  // Full-page mode: extract header images (logo) and footer content` followed by `  if (fullPage) {` (bare identifier, no `options?.`) and ends at the line `    result.footer = { text: footerText, images: footerImages };` plus its closing `  }` (lines ~222–251). Keep the second block that begins `  if (options?.fullPage) {`. Do not change anything else.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/wix-page-functions.test.js --reporter=basic`
Expected: PASS (both tests)

- [ ] **Step 6: Run the full suite to check nothing else broke**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```sh
git add package.json package-lock.json scripts/import/wix/wix-playwright.mjs test/wix-page-functions.test.js
git commit -m "fix(import): extractContentSrc threw ReferenceError on every call

The duplicated fullPage block referenced an undefined variable, breaking
the Playwright content path (imports silently fell back to curl+regex).
Adds jsdom-based tests that actually execute the page function."
```

---

### Task 2: Create `scripts/import/browser/page-functions.mjs` (shared extractors)

Move the three browser-context functions out of the Wix driver into a platform-neutral module; extend selectors for Squarespace; keep `wix-playwright.mjs` behavior and exports identical via re-export.

**Files:**
- Create: `scripts/import/browser/page-functions.mjs`
- Modify: `scripts/import/wix/wix-playwright.mjs`
- Test: `test/wix-page-functions.test.js` (extend), existing `test/wix-playwright.test.js` must keep passing

**Interfaces:**
- Consumes: the (fixed) function bodies from Task 1.
- Produces, from `scripts/import/browser/page-functions.mjs`:
  - `export const extractStylesSrc = function () { … }` → `{samples: {bg, text, heading}, fonts: {heading, body}}`
  - `export const extractContentSrc = function (options) { … }` → `{body, images, title, navLinks, tags, header?, footer?}`
  - `export const expandAccordionsSrc = function () { … }` → number of items expanded (page-side only; **no Playwright APIs inside**)
  - `wix-playwright.mjs` re-exports all three names unchanged (`export { extractStylesSrc, extractContentSrc, expandAccordionsSrc } from '../browser/page-functions.mjs';`).

- [ ] **Step 1: Extend the test for the new module path and Squarespace selectors**

Append to `test/wix-page-functions.test.js`:

```js
import {
  extractStylesSrc as sharedStyles,
  extractContentSrc as sharedContent,
  expandAccordionsSrc,
} from '../scripts/import/browser/page-functions.mjs';

describe('browser/page-functions module', () => {
  it('wix-playwright re-exports are the same functions', async () => {
    const wix = await import('../scripts/import/wix/wix-playwright.mjs');
    expect(wix.extractContentSrc).toBe(sharedContent);
    expect(wix.extractStylesSrc).toBe(sharedStyles);
  });

  it('extractContentSrc finds content in a Squarespace-shaped page', () => {
    document.documentElement.innerHTML = `
      <body><main id="page"><section class="sqs-block-content">
        <h1>About Sandra</h1><p>Sandra Cami is a first-generation designer with a decade of experience.</p>
        <img src="https://images.squarespace-cdn.com/content/v1/abc/img.jpeg" alt="portrait">
      </section></main></body>`;
    const result = sharedContent({});
    expect(result.body).toContain('Sandra Cami');
    expect(result.images[0].src).toContain('squarespace-cdn.com');
  });

  it('expandAccordionsSrc opens details and aria-expanded triggers', () => {
    document.documentElement.innerHTML = `
      <body><details><summary>Q</summary>A</details>
      <button aria-expanded="false">FAQ</button></body>`;
    const count = expandAccordionsSrc();
    expect(count).toBe(2);
    expect(document.querySelector('details').open).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run test/wix-page-functions.test.js --reporter=basic`
Expected: FAIL — cannot resolve `../scripts/import/browser/page-functions.mjs`

- [ ] **Step 3: Create the module and slim the Wix driver**

Create `scripts/import/browser/page-functions.mjs` with this header, then **move** (cut, don't copy) `extractStylesSrc` and `extractContentSrc` from `wix-playwright.mjs` into it verbatim, and convert `expandAccordions(page)` into the page-side-only `expandAccordionsSrc`:

```js
// Browser-context extraction functions shared by every rendered-page backend
// (Playwright driver at scripts/import/wix/wix-playwright.mjs, Safari MCP
// driver at scripts/import/browser/safari-driver.mjs). These functions are
// serialized with String(fn) and executed INSIDE the page — they must not
// close over module scope or use Node APIs.

/** Extract computed styles from visible elements on the page. */
export const extractStylesSrc = /* moved verbatim from wix-playwright.mjs */;

/** Extract text content from the rendered page via TreeWalker. */
export const extractContentSrc = /* moved verbatim from wix-playwright.mjs */;

/**
 * Expand accordion/FAQ items so collapsed content is visible.
 * Returns the number of items expanded; callers should wait ~500 ms for
 * animations when the count is > 0.
 */
export const expandAccordionsSrc = function () {
  let count = 0;
  const triggers = document.querySelectorAll(
    '[aria-expanded="false"]:not([role="menuitem"])',
  );
  for (const el of triggers) {
    el.click();
    count++;
  }
  for (const details of document.querySelectorAll('details:not([open])')) {
    details.open = true;
    count++;
  }
  for (const el of document.querySelectorAll('[data-hook="faq-question"]')) {
    if (el.getAttribute('aria-expanded') !== 'true') {
      el.click();
      count++;
    }
  }
  return count;
};
```

While moving, make exactly these selector extensions (Squarespace support):

1. In `extractStylesSrc`, extend `bgCandidates` explicit list with Squarespace wrappers:

```js
  const bgCandidates = [
    document.body,
    document.querySelector('#SITE_CONTAINER'),
    document.querySelector('#PAGES_CONTAINER'),
    document.querySelector('[data-hook="post-page"]'),
    document.querySelector('#siteWrapper'),        // Squarespace 7.x
    document.querySelector('#page'),               // Squarespace 7.1 main content
    document.querySelector('.content-wrapper'),    // Squarespace 7.0 templates
    document.querySelector('main'),
  ].filter(Boolean);
```

2. In `extractContentSrc`, extend the container cascade:

```js
    container = document.querySelector('#PAGES_CONTAINER')
      || document.querySelector('main#page')          // Squarespace 7.1
      || document.querySelector('.content-wrapper')   // Squarespace 7.0
      || document.querySelector('main')
      || document.body;
```

In `wix-playwright.mjs`:
- Remove the moved function bodies and the old `expandAccordions(page)` helper.
- Add at the top (keeping the existing `color-utils.mjs` import):

```js
import {
  extractStylesSrc,
  extractContentSrc,
  expandAccordionsSrc,
} from '../browser/page-functions.mjs';

export { extractStylesSrc, extractContentSrc, expandAccordionsSrc };
```

- Where `extractWixPage` called `await expandAccordions(page)`, replace with:

```js
  const expanded = await page.evaluate(expandAccordionsSrc);
  if (expanded > 0) {
    await page.waitForTimeout(500);
  }
```

- [ ] **Step 4: Run the file's tests, then the full suite**

Run: `npx vitest run test/wix-page-functions.test.js --reporter=basic` → PASS
Run: `npm test` → PASS (especially `test/wix-playwright.test.js`)

- [ ] **Step 5: Commit**

```sh
git add scripts/import/browser/page-functions.mjs scripts/import/wix/wix-playwright.mjs test/wix-page-functions.test.js
git commit -m "refactor(import): share page-functions between rendered backends

Moves extractStylesSrc/extractContentSrc/expandAccordionsSrc to
scripts/import/browser/ and adds Squarespace selector support.
wix-playwright.mjs re-exports; behavior unchanged."
```

---

### Task 3: `scripts/import/browser/safari-mcp.mjs` (stdio JSON-RPC client)

**Files:**
- Create: `scripts/import/browser/safari-mcp.mjs`
- Create: `test/fixtures/fake-safaridriver.mjs`
- Test: `test/safari-mcp.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (exact, Task 4 depends on these):
  - `export class SafariMcpError extends Error` with `.code` ∈ `'not-installed' | 'not-enabled' | 'session-failed' | 'page-failure' | 'timeout'`
  - `export function locateSafaridriver()` → `string | null` — first of `process.env.SAFARIDRIVER_PATH`, `/usr/bin/safaridriver`, `/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver` whose `--help` output contains `--mcp` (paths ending in `.mjs` are trusted without probing — test hook).
  - `export class SafariMcp` with `constructor(binaryPath)`, `async start()`, `async call(name, args = {}, timeoutMs = 60000)` → string (concatenated text content), `close()`. `call` throws `SafariMcpError('not-enabled')` when the tool error text matches `/allow remote automation/i`, else `SafariMcpError('page-failure')` on `isError`, `SafariMcpError('timeout')` on deadline.

- [ ] **Step 1: Write the fake safaridriver test fixture**

Create `test/fixtures/fake-safaridriver.mjs` (executable stand-in speaking MCP on stdio; mode via `FAKE_SAFARIDRIVER_MODE`):

```js
#!/usr/bin/env node
// Fake `safaridriver --mcp` for tests. Modes via FAKE_SAFARIDRIVER_MODE:
//   ok          — happy path, canned tool responses
//   not-enabled — every tools/call returns the WebDriver enable error
//   hang        — never responds to tools/call (for timeout tests)
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_SAFARIDRIVER_MODE || 'ok';
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const NOT_ENABLED_TEXT =
  'Tool error: Error Domain=WebDriverErrorDomain Code=6 "Could not create a session: ' +
  "You must enable 'Allow remote automation' in the Developer section of Safari Settings " +
  'to control Safari via WebDriver."';

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'Safari', version: '1.0.0' },
    }});
    return;
  }
  if (msg.id === undefined) return; // notifications
  if (msg.method === 'tools/call') {
    if (mode === 'hang') return;
    if (mode === 'not-enabled') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: NOT_ENABLED_TEXT }], isError: true,
      }});
      return;
    }
    const { name, arguments: args = {} } = msg.params;
    const canned = {
      navigate_to_url: () => args.url === 'https://fails.example'
        ? { content: [{ type: 'text', text: 'Tool error: navigation failed' }], isError: true }
        : { content: [{ type: 'text', text: `Loaded ${args.url}` }] },
      create_tab: () => ({ content: [{ type: 'text', text: '{"handle":"tab-1"}' }] }),
      wait_for_navigation: () => ({ content: [{ type: 'text', text: '{"url":"done"}' }] }),
      evaluate_javascript: () => {
        const expr = args.expression || '';
        if (expr.includes('extractStylesSrc') || expr.includes('samples')) {
          return { content: [{ type: 'text', text: JSON.stringify({
            samples: { bg: ['rgb(200, 164, 126)'], text: ['rgb(118, 118, 118)'], heading: ['rgb(0, 0, 0)'] },
            fonts: { heading: ['Poppins'], body: ['Poppins'] },
          })}] };
        }
        if (process.env.FAKE_EMPTY_BODY === '1' && expr.includes('images')) {
          return { content: [{ type: 'text', text: JSON.stringify({ body: '', images: [], title: '', navLinks: [], tags: [] }) }] };
        }
        if (expr.includes('images')) {
          return { content: [{ type: 'text', text: JSON.stringify({
            body: 'Hello from the fake page', images: [{ src: 'https://cdn.example/a.jpg', alt: 'a' }],
            title: 'Fake Page', navLinks: [], tags: [],
          })}] };
        }
        return { content: [{ type: 'text', text: '3' }] }; // accordion count
      },
      get_page_content: () => ({ content: [{ type: 'text', text: JSON.stringify({
        url: 'https://rescue.example', format: 'markdown',
        content: 'Rescued markdown body\n\n![alt](https://cdn.example/rescued.jpg)',
      })}] }),
    };
    const fn = canned[name];
    send({ jsonrpc: '2.0', id: msg.id, result: fn
      ? fn()
      : { content: [{ type: 'text', text: `Tool error: unknown tool ${name}` }], isError: true } });
  }
});
```

- [ ] **Step 2: Write the failing client tests**

Create `test/safari-mcp.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SafariMcp, SafariMcpError, locateSafaridriver } from '../scripts/import/browser/safari-mcp.mjs';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-safaridriver.mjs');
let client;
afterEach(() => { client?.close(); delete process.env.FAKE_SAFARIDRIVER_MODE; delete process.env.SAFARIDRIVER_PATH; });

describe('locateSafaridriver', () => {
  it('honors SAFARIDRIVER_PATH and trusts .mjs paths without probing', () => {
    process.env.SAFARIDRIVER_PATH = FAKE;
    expect(locateSafaridriver()).toBe(FAKE);
  });
});

describe('SafariMcp', () => {
  it('completes the initialize handshake and round-trips a call', async () => {
    client = new SafariMcp(FAKE);
    await client.start();
    const text = await client.call('navigate_to_url', { url: 'https://ok.example' });
    expect(text).toBe('Loaded https://ok.example');
  });

  it('maps the remote-automation error to code not-enabled', async () => {
    process.env.FAKE_SAFARIDRIVER_MODE = 'not-enabled';
    client = new SafariMcp(FAKE);
    await client.start();
    await expect(client.call('create_tab')).rejects.toMatchObject({ code: 'not-enabled' });
  });

  it('maps other tool errors to page-failure', async () => {
    client = new SafariMcp(FAKE);
    await client.start();
    await expect(client.call('navigate_to_url', { url: 'https://fails.example' }))
      .rejects.toMatchObject({ code: 'page-failure' });
  });

  it('times out on a hung call', async () => {
    process.env.FAKE_SAFARIDRIVER_MODE = 'hang';
    client = new SafariMcp(FAKE);
    await client.start();
    await expect(client.call('create_tab', {}, 300)).rejects.toMatchObject({ code: 'timeout' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/safari-mcp.test.js --reporter=basic`
Expected: FAIL — cannot resolve `../scripts/import/browser/safari-mcp.mjs`

- [ ] **Step 4: Implement the client**

Create `scripts/import/browser/safari-mcp.mjs`:

```js
// Minimal MCP stdio client for Apple's Safari MCP server (`safaridriver --mcp`,
// Safari Technology Preview 247+). Spawns the driver as a child process and
// speaks newline-delimited JSON-RPC — no MCP client configuration required.
// Each process is an isolated browser session; one SafariMcp instance = one
// visible Safari window that closes when close() is called.

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const CANDIDATE_PATHS = [
  '/usr/bin/safaridriver', // stable Safari, once Apple ships MCP there
  '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver',
];

export class SafariMcpError extends Error {
  /** @param {'not-installed'|'not-enabled'|'session-failed'|'page-failure'|'timeout'} code */
  constructor(code, message) {
    super(message);
    this.name = 'SafariMcpError';
    this.code = code;
  }
}

function supportsMcp(path) {
  const probe = spawnSync(path, ['--help'], { encoding: 'utf8', timeout: 5000 });
  return !probe.error && `${probe.stdout}${probe.stderr}`.includes('--mcp');
}

/**
 * Find a safaridriver binary that supports --mcp, or null.
 * An explicit SAFARIDRIVER_PATH is authoritative: when set, the fallback
 * candidates are NOT consulted (so tests and users can pin a binary).
 */
export function locateSafaridriver() {
  const envPath = process.env.SAFARIDRIVER_PATH;
  if (envPath) {
    if (envPath.endsWith('.mjs')) return envPath; // test fixture — trusted
    return supportsMcp(envPath) ? envPath : null;
  }
  for (const path of CANDIDATE_PATHS) {
    if (supportsMcp(path)) return path;
  }
  return null;
}

export class SafariMcp {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  async start() {
    const args = ['--mcp'];
    this.child = this.binaryPath.endsWith('.mjs')
      ? spawn(process.execPath, [this.binaryPath, ...args], { stdio: ['pipe', 'pipe', 'ignore'] })
      : spawn(this.binaryPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child.on('error', (err) => {
      for (const { reject } of this.pending.values()) {
        reject(new SafariMcpError('session-failed', err.message));
      }
      this.pending.clear();
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new SafariMcpError('session-failed', JSON.stringify(msg.error)));
      } else {
        entry.resolve(msg.result);
      }
    });
    await this.#request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'anglesite-import', version: '1.0.0' },
    }, 15000);
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n',
    );
  }

  #request(method, params, timeoutMs) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new SafariMcpError('timeout', `${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return promise;
  }

  /**
   * Call an MCP tool; returns the concatenated text content.
   * Throws SafariMcpError('not-enabled') when Safari's remote-automation
   * setting is off, ('page-failure') for other tool errors.
   */
  async call(name, args = {}, timeoutMs = 60000) {
    const result = await this.#request('tools/call', { name, arguments: args }, timeoutMs);
    const text = (result.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (result.isError) {
      if (/allow remote automation/i.test(text)) {
        throw new SafariMcpError('not-enabled', text);
      }
      throw new SafariMcpError('page-failure', text);
    }
    return text;
  }

  close() {
    this.child?.kill();
    this.child = null;
  }
}
```

- [ ] **Step 5: Run tests to verify pass, then full suite**

Run: `npx vitest run test/safari-mcp.test.js --reporter=basic` → PASS
Run: `npm test` → PASS

- [ ] **Step 6: Commit**

```sh
git add scripts/import/browser/safari-mcp.mjs test/fixtures/fake-safaridriver.mjs test/safari-mcp.test.js
git commit -m "feat(import): stdio JSON-RPC client for Safari's MCP server"
```

---

### Task 4: `scripts/import/browser/safari-driver.mjs` (extraction CLI)

**Files:**
- Create: `scripts/import/browser/safari-driver.mjs`
- Test: `test/safari-driver.test.js`

**Interfaces:**
- Consumes: `SafariMcp`, `SafariMcpError`, `locateSafaridriver` (Task 3); `extractStylesSrc`, `extractContentSrc`, `expandAccordionsSrc` (Task 2); `rgbToHex`, `classifyTokens` from `scripts/import/wix/color-utils.mjs`.
- Produces (the import skill's contract):
  - `node safari-driver.mjs --check` → stdout `{"backend":"safari","binary":"<path>"}`; exit 0 usable / 2 not installed / 3 not enabled / 4 session failure.
  - `node safari-driver.mjs <url…> [--content-only|--styles-only|--fullPage]` → NDJSON, one line per URL: `{"url", "tokens": {...}|null, "content": {...}|null}` or `{"url", "error": "..."}`. Tokens are extracted only for the **first** URL (or all, with `--styles-only`), matching the "homepage only" rule. Exit 0 if ≥1 page succeeded, 1 if all failed, 2/3/4 as in `--check`.

- [ ] **Step 1: Write the failing CLI tests**

Create `test/safari-driver.test.js`:

```js
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/safari-driver.test.js --reporter=basic`
Expected: FAIL — CLI file does not exist

- [ ] **Step 3: Implement the CLI**

Create `scripts/import/browser/safari-driver.mjs`:

```js
#!/usr/bin/env node
// Safari-backed rendered-page extraction with the same output contract as
// scripts/import/wix/wix-playwright.mjs. One process = one Safari session =
// one visible window; pass every URL in a single invocation.
//
//   node safari-driver.mjs --check
//   node safari-driver.mjs <url…> [--content-only|--styles-only|--fullPage]
//
// NDJSON output: {"url", "tokens": {...}|null, "content": {...}|null} per URL,
// or {"url", "error": "..."} for pages that failed.
// Exit codes: 0 ok, 1 all pages failed, 2 not installed, 3 automation not
// enabled, 4 session failure.

import { SafariMcp, SafariMcpError, locateSafaridriver } from './safari-mcp.mjs';
import {
  extractStylesSrc,
  extractContentSrc,
  expandAccordionsSrc,
} from './page-functions.mjs';
import { rgbToHex, classifyTokens } from '../wix/color-utils.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const urls = args.filter((a) => !a.startsWith('--'));

const EXIT = { OK: 0, ALL_FAILED: 1, NOT_INSTALLED: 2, NOT_ENABLED: 3, SESSION_FAILED: 4 };

function exitForError(err) {
  if (err instanceof SafariMcpError && err.code === 'not-enabled') return EXIT.NOT_ENABLED;
  return EXIT.SESSION_FAILED;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** IIFE-wrap a page function — Safari's evaluate_javascript rejects top-level `return`. */
const iife = (fn, arg) =>
  arg === undefined ? `(${String(fn)})()` : `(${String(fn)})(${JSON.stringify(arg)})`;

async function extractStyles(mcp) {
  const raw = await mcp.call('evaluate_javascript', { expression: iife(extractStylesSrc) });
  const { samples, fonts } = JSON.parse(raw);
  const hexSamples = {
    bg: (samples.bg || []).map(rgbToHex).filter((c) => c.startsWith('#')),
    text: (samples.text || []).map(rgbToHex).filter((c) => c.startsWith('#')),
    heading: (samples.heading || []).map(rgbToHex).filter((c) => c.startsWith('#')),
  };
  return classifyTokens(hexSamples, fonts);
}

async function extractContent(mcp, fullPage) {
  const raw = await mcp.call('evaluate_javascript', {
    expression: iife(extractContentSrc, { fullPage }),
  });
  let content = JSON.parse(raw);
  if (!content.body) {
    // Rescue: WebKit-native extraction. Defaults truncate paragraphs to 15
    // words and strip URL params — override both.
    const rescueRaw = await mcp.call('get_page_content', {
      format: 'markdown',
      region: 'entire_page',
      maxWordsPerParagraph: 5000,
      shortenURLs: false,
    });
    const rescued = JSON.parse(rescueRaw);
    const body = rescued.content || '';
    const images = [...body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => ({
      src: m[2].replace(/\\\//g, '/'),
      alt: m[1],
    }));
    content = { ...content, body, images: content.images?.length ? content.images : images };
  }
  return content;
}

async function main() {
  const binary = locateSafaridriver();
  if (!binary) {
    console.error('safaridriver with --mcp support not found');
    process.exit(EXIT.NOT_INSTALLED);
  }

  const mcp = new SafariMcp(binary);
  const done = () => mcp.close();
  process.on('exit', done);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));

  try {
    await mcp.start();
  } catch (err) {
    console.error(err.message);
    process.exit(EXIT.SESSION_FAILED);
  }

  if (flags.has('--check')) {
    try {
      await mcp.call('create_tab', {}, 30000);
      console.log(JSON.stringify({ backend: 'safari', binary }));
      process.exit(EXIT.OK);
    } catch (err) {
      console.error(err.message);
      process.exit(exitForError(err));
    }
  }

  if (urls.length === 0) {
    console.error('usage: safari-driver.mjs --check | <url…> [--content-only|--styles-only|--fullPage]');
    process.exit(EXIT.SESSION_FAILED);
  }

  const stylesOnly = flags.has('--styles-only');
  const contentOnly = flags.has('--content-only');
  const fullPage = flags.has('--fullPage');
  let successes = 0;

  for (const [index, url] of urls.entries()) {
    try {
      await mcp.call('navigate_to_url', { url }, 30000);
      await mcp.call('wait_for_navigation', {}, 30000).catch(() => {});

      const expanded = Number(
        await mcp.call('evaluate_javascript', { expression: iife(expandAccordionsSrc) }),
      );
      if (expanded > 0) await sleep(500);

      // Design tokens come from the homepage only (first URL), mirroring the
      // Playwright driver's "extract styles from the homepage" rule.
      const wantStyles = !contentOnly && (stylesOnly || index === 0);
      const tokens = wantStyles ? await extractStyles(mcp) : null;
      const content = stylesOnly ? null : await extractContent(mcp, fullPage);

      console.log(JSON.stringify({ url, tokens, content }));
      successes++;
    } catch (err) {
      if (err instanceof SafariMcpError && err.code === 'not-enabled') {
        console.error(err.message);
        process.exit(EXIT.NOT_ENABLED);
      }
      console.log(JSON.stringify({ url, error: err.message }));
    }
  }

  process.exit(successes > 0 ? EXIT.OK : EXIT.ALL_FAILED);
}

main();
```

- [ ] **Step 4: Run tests to verify pass, then full suite**

Run: `npx vitest run test/safari-driver.test.js --reporter=basic` → PASS
Run: `npm test` → PASS

- [ ] **Step 5: Manual smoke test (macOS with automation enabled only — skip in CI)**

Run: `node scripts/import/browser/safari-driver.mjs --check`
Expected: `{"backend":"safari","binary":"/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver"}`, exit 0.

Run: `node scripts/import/browser/safari-driver.mjs "https://cami-demo.squarespace.com"`
Expected: one NDJSON line; `tokens['--color-bg']` is `#c8a47e`; `content.body` contains "Sandra Cami".

- [ ] **Step 6: Commit**

```sh
git add scripts/import/browser/safari-driver.mjs test/safari-driver.test.js
git commit -m "feat(import): Safari MCP extraction CLI with wix-playwright contract"
```

---

### Task 5: Platform docs — `docs/import/squarespace.md` and `docs/import/wix.md`

**Files:**
- Modify: `docs/import/squarespace.md`
- Modify: `docs/import/wix.md`

**Interfaces:**
- Consumes: the CLI contract from Task 4 (`--check` exit codes, NDJSON shape, flags).
- Produces: extraction-method documentation the import skill (Task 6) references by section name: squarespace.md sections "Page JSON endpoint" and "Rendered extraction (design tokens, accordions, galleries)"; wix.md section "Safari extraction (preferred rendered backend)".

- [ ] **Step 1: Add the `?format=json` section to squarespace.md**

Insert after the "### 2. RSS feed" section (renumbering the WebFetch fallback to 4):

```markdown
### 3. Page JSON endpoint

Every Squarespace page also serves a structured JSON version of itself: append
`?format=json` to any page URL (validated live 2026-07-03).

```sh
curl -s "https://SITE/page-url?format=json"
```

The response includes:

- `mainContent` — the page body as HTML (convert with the standard rules)
- `collection` / `items` — for blog and gallery collections, the item list
  with metadata and pagination
- `website` — site-wide configuration (title, locale, social accounts)

Prefer this over scraping rendered HTML for any page that isn't in the WXR
export — it's structured, complete, and needs no browser. Note it does NOT
expose computed styles; design tokens come from rendered extraction below.
Some sites disable it (returns HTML instead of JSON) — fall through to
rendered extraction or WebFetch when the response doesn't parse as JSON.
```

- [ ] **Step 2: Add the rendered-extraction section to squarespace.md**

Insert after the new Page JSON section:

```markdown
### Rendered extraction (design tokens, accordions, galleries)

Exports and JSON endpoints can't see computed styles, collapsed accordion
panels, or full-resolution gallery layouts. For those, use the rendered
backend chosen in import Step 1a.2 (RENDER_BACKEND):

```sh
# Safari backend (macOS, preferred — no install required)
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/browser/safari-driver.mjs "HOMEPAGE_URL" --styles-only
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/browser/safari-driver.mjs "PAGE_URL…" --content-only
```

Output is NDJSON — one `{"url", "tokens", "content"}` line per page. The
same design-token map (`--color-bg`, `--color-primary`, `--font-heading`, …)
maps onto `src/styles/global.css` custom properties exactly as it does for
Wix (see import Step 5.5). Accordion/FAQ panels are expanded automatically
before extraction. Gallery pages return every `<img>` with full
`images.squarespace-cdn.com` URLs — apply the standard `?format=2500w`
normalization from the Image handling section.

When RENDER_BACKEND is `playwright`, the equivalent Playwright invocation
(`scripts/import/wix/wix-playwright.mjs`) works on Squarespace pages too —
the extraction functions are shared. When neither backend is available,
design tokens are skipped and the owner picks colors via
`/anglesite:design-interview`.
```

- [ ] **Step 3: Add the Safari backend section to wix.md**

Insert immediately before the "### Playwright extraction" section, and retitle that section "### Playwright extraction (fallback rendered backend)":

```markdown
### Safari extraction (preferred rendered backend on macOS)

When import Step 1a.2 resolved RENDER_BACKEND=safari, use the Safari driver
for everything the Playwright section below describes — same flags, same
JSON shape, no browser download:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/browser/safari-driver.mjs "URL…" [--content-only|--styles-only|--fullPage]
```

Differences from Playwright:

- **Pass all URLs in one invocation.** Each run opens one visible Safari
  window (an isolated session — no cookies or logins); output is NDJSON,
  one line per URL. Lines with `{"url", "error"}` should fall back to
  curl + `wix-extract.mjs` for that page, exactly like a Playwright timeout.
- **Real-Safari fingerprint.** Wix's throttling of rapid curl/headless
  requests does not apply; no pause between pages is needed.
- Requires macOS with Safari's "Allow remote automation" enabled
  (Safari Technology Preview 247+ or any stable Safari whose safaridriver
  supports `--mcp`). Detection and owner-facing setup instructions live in
  import Step 1a.2 — do not repeat them here.
```

- [ ] **Step 4: Verify doc consistency**

Run: `grep -n "safari-driver.mjs" docs/import/*.md` — both files reference the same path and flags.
Run: `npm test` → PASS (no code touched; sanity only)

- [ ] **Step 5: Commit**

```sh
git add docs/import/squarespace.md docs/import/wix.md
git commit -m "docs(import): Squarespace ?format=json + rendered tier; Safari backend for Wix"
```

---

### Task 6: Import skill — Step 1a.2 backend detection + backend-agnostic steps

**Files:**
- Modify: `skills/import/SKILL.md`
- Regenerate: `agent-skills/` via `npm run build:agent-skills`

**Interfaces:**
- Consumes: `safari-driver.mjs --check` exit codes (0/2/3/4) and NDJSON contract (Task 4); doc sections (Task 5).
- Produces: `RENDER_BACKEND` ∈ `safari | playwright | none`, referenced by Steps 2a, 3b, 5.5 and the Squarespace flow.

- [ ] **Step 1: Insert Step 1a.2 after Step 1a.1**

Add after the existing "### 1a.1 — Wix MCP server detection (Wix only)" section:

````markdown
### 1a.2 — Rendered-page backend detection (Wix and Squarespace)

If PLATFORM is `wix` or `squarespace`, resolve which backend renders pages
for extraction. Run:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/browser/safari-driver.mjs --check
```

Branch on the exit code:

- **0** — set RENDER_BACKEND=safari. Tell the owner:
  > "I can use Safari on your Mac to read your site exactly the way visitors
  > see it. A Safari window will open and browse your pages by itself —
  > you don't need to do anything, just don't click inside that window."
- **3** (Safari present, automation not enabled) — show this once:
  > "Your Mac's Safari can help me import your site more accurately, but it
  > needs one-time permission. In Safari Technology Preview, open
  > Settings → Advanced and turn on 'Show features for web developers',
  > then Settings → Developer and turn on 'Allow remote automation'.
  > Say 'ready' when done, or 'skip' to continue without it."
  If the owner enables it, re-run the check. If they skip, fall through to
  the Playwright branch below.
- **2 or 4** — fall through to Playwright silently (Safari unavailable is
  the normal case on Linux/Windows).

**Playwright branch:** follow the existing Playwright install check (Step 2a);
if installed or the owner accepts the install, set RENDER_BACKEND=playwright.
Otherwise set RENDER_BACKEND=none (content still imports via curl/regex,
JSON endpoints, and WebFetch; design tokens are skipped).

Both backends share one invocation contract — the same flags and the same
`tokens`/`content` JSON. Substitute the driver path for the resolved backend:

- safari: `node ${CLAUDE_PLUGIN_ROOT}/scripts/import/browser/safari-driver.mjs "URL…" [flags]` (batch all URLs in ONE invocation; NDJSON out, one line per URL; a line with `"error"` falls back per-page like a Playwright timeout)
- playwright: `node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-playwright.mjs "URL" [flags]` (one URL per invocation)
````

- [ ] **Step 2: Make Steps 2a, 3b, 5.5 backend-agnostic**

- In Step 2a (`**Wix (USE_WIX_MCP=false):**` block): change "Use Playwright to extract content and design tokens" to "Use the RENDER_BACKEND driver (Step 1a.2) to extract content and design tokens", and precede the existing Playwright install check with "Skip this check when RENDER_BACKEND=safari."
- In Step 3b: same substitution for the `--content-only` static-page extraction; add "With the Safari backend, pass every static page URL in one invocation and read the NDJSON lines."
- In Step 5.5: retitle "## Step 5.5 — Apply design tokens (Playwright only)" to "## Step 5.5 — Apply design tokens (rendered backend)" and change "If Playwright was used" to "If a rendered backend (Safari or Playwright) captured tokens". Add at the end: "This step now applies to Squarespace imports too — extract homepage tokens with `--styles-only` via RENDER_BACKEND when available."

- [ ] **Step 3: Wire the Squarespace rendered tier into the flow**

In the Squarespace extraction instructions (Step 1b / content-discovery reference), append:

```markdown
For Squarespace, after the WXR/RSS/JSON passes, use RENDER_BACKEND (when not
`none`) for the three things exports can't see — read the "Rendered
extraction" section of `${CLAUDE_PLUGIN_ROOT}/docs/import/squarespace.md`:
1. Design tokens from the homepage (`--styles-only`) → Step 5.5
2. Pages with accordion/FAQ blocks (accordions expand automatically)
3. Gallery pages (full-resolution image URLs)
```

- [ ] **Step 4: Regenerate the agent-skills export and verify**

Run: `npm run build:agent-skills`
Run: `git status --short agent-skills/` — regenerated files appear; commit them with the skill change.
Run: `npm test` → PASS

- [ ] **Step 5: Commit**

```sh
git add skills/import/SKILL.md agent-skills/
git commit -m "feat(import): RENDER_BACKEND resolution — Safari preferred, Playwright fallback"
```

---

### Task 7: ADR-0024, decisions index, and manual-testing doc

**Files:**
- Create: `docs/decisions/0024-safari-rendered-extraction-backend.md`
- Modify: `docs/decisions/README.md` (add index row, matching existing format)
- Modify: `docs/dev/testing.md` (manual validation section)

**Interfaces:**
- Consumes: everything above (documents it).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0024-safari-rendered-extraction-backend.md` following the structure of `docs/decisions/0021-*.md` (read it first for the house format). Required content:

- **Status:** Accepted (2026-07-03)
- **Context:** Wix/Squarespace are the lowest-fidelity imports; Playwright costs a ~150 MB per-project chromium download; Wix throttles curl/headless scraping; Squarespace had no rendered tier. Apple shipped an MCP server in `safaridriver --mcp` (STP 247, July 2026): stdio JSON-RPC, isolated WebDriver session, local-only.
- **Decision:** Treat Safari's MCP server as an optional on-device rendered-extraction backend, spawned directly as a child process (no MCP client configuration), preferred over Playwright when usable. Shared browser-context extractors live in `scripts/import/browser/page-functions.mjs`; both drivers emit the same `{tokens, content}` JSON. Detection is `safari-driver.mjs --check` with exit codes 0/2/3/4; enabling remote automation is a deliberate human-only step surfaced to the owner once.
- **Consequences:** macOS-only accelerator — Playwright and curl paths remain fully supported (cross-platform rule); CI tests against a fake safaridriver, live Safari validation is manual; tool names/protocol tracked against Safari releases (currently protocol `2024-11-05`, 17 tools); precedent follows ADR-0021 (`fm`): free, private, offline, never required.

- [ ] **Step 2: Add the README index row and testing doc section**

In `docs/decisions/README.md`, add ADR-0024 to the index table using the same row format as ADR-0023. In `docs/dev/testing.md`, add:

```markdown
## Manual validation: Safari rendered-extraction backend

CI covers the Safari driver against a fake safaridriver
(`test/fixtures/fake-safaridriver.mjs`). Before releases that touch
`scripts/import/browser/`, validate against live Safari on macOS:

1. Safari Technology Preview installed; Settings → Developer →
   "Allow remote automation" enabled.
2. `node scripts/import/browser/safari-driver.mjs --check` → exit 0.
3. `node scripts/import/browser/safari-driver.mjs "https://cami-demo.squarespace.com"`
   → NDJSON line with `tokens["--color-bg"] === "#c8a47e"` (template tan)
   and body containing "Sandra Cami".
4. `node scripts/import/browser/safari-driver.mjs "https://www.wix.com/blog" --content-only`
   → body with full `static.wixstatic.com` image URLs.
```

- [ ] **Step 3: Run the suite and commit**

Run: `npm test` → PASS

```sh
git add docs/decisions/0024-safari-rendered-extraction-backend.md docs/decisions/README.md docs/dev/testing.md
git commit -m "docs: ADR-0024 Safari rendered-extraction backend + manual test protocol"
```

---

### Task 8: Final verification

**Files:** none new.

- [ ] **Step 1: Full suite and export freshness**

Run: `npm test` → PASS
Run: `npm run build:agent-skills && git status --short agent-skills/` → no output (export current)

- [ ] **Step 2: Live end-to-end (macOS, automation enabled)**

Run the four manual-validation steps from `docs/dev/testing.md` (Task 7). All pass.

- [ ] **Step 3: Review the diff against the spec**

Run: `git log --oneline main..HEAD` and `git diff main --stat`
Confirm every spec section maps to a commit; no `agent-skills/` hand edits; no new runtime deps in `package.json` `dependencies`.
