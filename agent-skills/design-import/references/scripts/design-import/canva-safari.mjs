#!/usr/bin/env node

// Safari-backed Canva published-site extraction with the same output contract
// as canva-playwright.mjs. One process = one Safari session = one visible
// window, so a whole --site crawl happens in a single invocation.
//
//   node canva-safari.mjs --check
//   node canva-safari.mjs <url> [--site] [--content-only]
//
// Output matches canva-playwright.mjs exactly:
//   single page: { tokens, sections, navigation, images }
//   --site:      { tokens, pages, images, navigation }
// Exit codes (shared with the import skill's Safari backend): 0 ok,
// 1 extraction failed, 2 safaridriver not installed, 3 remote automation not
// enabled, 4 session failure.
//
// Requires no npm packages — Safari MCP (`safaridriver --mcp`, Safari
// Technology Preview 247+) is spawned directly. Playwright stays the
// cross-platform fallback; this driver is a macOS accelerator only.

import {
  SafariMcp,
  SafariMcpError,
  locateSafaridriver,
} from '../import/browser/safari-mcp.mjs';
import { extractCanvaPage, crawlCanvaSite } from './canva-playwright.mjs';

const EXIT = { OK: 0, FAILED: 1, NOT_INSTALLED: 2, NOT_ENABLED: 3, SESSION_FAILED: 4 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Adapt a SafariMcp session to the subset of the Playwright Page API that
 * extractCanvaPage/crawlCanvaSite use: goto, waitForSelector, waitForTimeout,
 * evaluate. Page functions are serialized with String(fn) and wrapped in a
 * bare IIFE — Safari's evaluate_javascript rejects top-level `return`.
 *
 * @param {SafariMcp} mcp
 */
export function safariPage(mcp) {
  return {
    async goto(url, { timeout = 30000 } = {}) {
      await mcp.call('navigate_to_url', { url }, timeout);
      await mcp.call('wait_for_navigation', {}, timeout).catch(() => {});
    },

    async waitForSelector(selector, { timeout = 10000 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const count = Number(
          await mcp.call('evaluate_javascript', {
            expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
          }),
        );
        if (count > 0) return;
        if (Date.now() >= deadline) {
          throw new SafariMcpError('page-failure', `Timed out waiting for selector: ${selector}`);
        }
        await sleep(250);
      }
    },

    async waitForTimeout(ms) {
      await sleep(ms);
    },

    async evaluate(fn) {
      const raw = await mcp.call('evaluate_javascript', { expression: `(${String(fn)})()` });
      return JSON.parse(raw);
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const url = args.find((a) => !a.startsWith('--'));

  const binary = locateSafaridriver();
  if (!binary) {
    console.error('safaridriver with --mcp support not found');
    process.exit(EXIT.NOT_INSTALLED);
  }

  const mcp = new SafariMcp(binary);
  process.on('exit', () => mcp.close());
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
      process.exit(err instanceof SafariMcpError && err.code === 'not-enabled'
        ? EXIT.NOT_ENABLED
        : EXIT.SESSION_FAILED);
    }
  }

  if (!url) {
    console.error('Usage: node canva-safari.mjs --check | <url> [--site] [--content-only]');
    process.exit(EXIT.SESSION_FAILED);
  }

  const page = safariPage(mcp);

  try {
    const result = flags.has('--site')
      ? await crawlCanvaSite(page, url)
      : await extractCanvaPage(page, url, { contentOnly: flags.has('--content-only') });
    console.log(JSON.stringify(result, null, 2));
    process.exit(EXIT.OK);
  } catch (err) {
    if (err instanceof SafariMcpError && err.code === 'not-enabled') {
      console.error(err.message);
      process.exit(EXIT.NOT_ENABLED);
    }
    console.error(err.message);
    process.exit(EXIT.FAILED);
  }
}

main();
