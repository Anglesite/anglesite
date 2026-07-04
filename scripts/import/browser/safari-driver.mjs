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
    if (typeof rescued.content !== 'string') {
      throw new Error(
        `get_page_content rescue returned an unexpected shape (expected string "content", got ${typeof rescued.content}); WebKit's tool response format may have changed`,
      );
    }
    const body = rescued.content;
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
  // Design tokens are normally captured from the homepage (index 0), mirroring
  // the Playwright driver's "extract styles from the homepage" rule. If index
  // 0 fails before tokens are captured (redirect loop, timeout, etc.), keep
  // trying on each subsequent successful page until tokens are captured, so a
  // single homepage failure doesn't zero out tokens for an otherwise-healthy
  // batch.
  let tokensCaptured = false;

  for (const [index, url] of urls.entries()) {
    try {
      await mcp.call('navigate_to_url', { url }, 30000);
      await mcp.call('wait_for_navigation', {}, 30000).catch(() => {});

      const expanded = Number(
        await mcp.call('evaluate_javascript', { expression: iife(expandAccordionsSrc) }),
      );
      if (expanded > 0) await sleep(500);

      const wantStyles = !contentOnly && (stylesOnly || !tokensCaptured);
      // Isolate style-extraction failures from content extraction: a page
      // whose style pass throws (redirect loop, timeout, etc.) should still
      // have its content extracted normally, and should leave tokensCaptured
      // false so a later page gets a chance to supply tokens instead.
      let tokens = null;
      if (wantStyles) {
        try {
          tokens = await extractStyles(mcp);
          tokensCaptured = true;
        } catch (err) {
          if (err instanceof SafariMcpError && err.code === 'not-enabled') throw err;
          console.error(`style extraction failed for ${url}: ${err.message}`);
        }
      }
      const content = stylesOnly ? null : await extractContent(mcp, fullPage);

      console.log(JSON.stringify({ url, tokens, content }));
      successes++;
    } catch (err) {
      if (err instanceof SafariMcpError && err.code === 'not-enabled') {
        console.error(err.message);
        // Emit an error line for this URL and every URL not yet attempted so
        // NDJSON consumers see one line per input URL (SKILL.md's documented
        // contract: "a line with error falls back per-page"), instead of the
        // remaining batch silently vanishing from output.
        for (const remaining of urls.slice(index)) {
          console.log(JSON.stringify({ url: remaining, error: err.message }));
        }
        process.exit(EXIT.NOT_ENABLED);
      }
      console.log(JSON.stringify({ url, error: err.message }));
    }
  }

  process.exit(successes > 0 ? EXIT.OK : EXIT.ALL_FAILED);
}

main();
