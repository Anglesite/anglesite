#!/usr/bin/env node
// Fake `safaridriver --mcp` for tests. Modes via FAKE_SAFARIDRIVER_MODE:
//   ok                  — happy path, canned tool responses
//   not-enabled         — every tools/call returns the WebDriver enable error
//   not-enabled-second-url — navigate_to_url succeeds for the first URL seen,
//                          then every call for the second (and later) URL
//                          returns the WebDriver enable error (mid-batch test)
//   hang                — never responds to tools/call (for timeout tests)
//   die-after-first-call — respond normally to the first tools/call, then
//                          exit(0) on the second tools/call before responding
//   fail                — every tools/call returns a generic (non-"not-enabled")
//                          JSON-RPC error, exercising the SESSION_FAILED (exit 4) path
//
// FAKE_TOKENS_FAIL_URL=<url> makes style extraction (evaluate_javascript for
// extractStylesSrc) fail with a page-failure error only while `currentUrl`
// equals that URL — used to test the design-token fallback-to-later-page path.
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_SAFARIDRIVER_MODE || 'ok';
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const NOT_ENABLED_TEXT =
  'Tool error: Error Domain=WebDriverErrorDomain Code=6 "Could not create a session: ' +
  "You must enable 'Allow remote automation' in the Developer section of Safari Settings " +
  'to control Safari via WebDriver."';

let callCount = 0;
let seenFirstUrl = null; // the first URL passed to navigate_to_url, for mode branches keyed on "which page is this"
let currentUrl = null; // the most recent URL passed to navigate_to_url

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
    if (mode === 'die-after-first-call') {
      callCount++;
      if (callCount >= 2) {
        process.exit(0);
      }
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: 'Loaded https://ok.example' }],
      }});
      return;
    }
    if (mode === 'not-enabled') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: NOT_ENABLED_TEXT }], isError: true,
      }});
      return;
    }
    if (mode === 'fail') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: 'Tool error: internal WebDriver session error' }], isError: true,
      }});
      return;
    }
    if (msg.params?.name === 'navigate_to_url') {
      currentUrl = msg.params?.arguments?.url;
      if (seenFirstUrl === null) seenFirstUrl = currentUrl;
    }
    if (mode === 'not-enabled-second-url' && msg.params?.name === 'navigate_to_url') {
      if (currentUrl !== seenFirstUrl) {
        send({ jsonrpc: '2.0', id: msg.id, result: {
          content: [{ type: 'text', text: NOT_ENABLED_TEXT }], isError: true,
        }});
        return;
      }
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
        if (process.env.FAKE_EVAL_ERROR_TEXT) {
          return { content: [{ type: 'text', text: process.env.FAKE_EVAL_ERROR_TEXT }], isError: true };
        }
        // — Canva page-functions (design-import), keyed on source markers unique
        //   to each serialized extractor so they can't shadow the Wix ones —
        if (expr.includes('FONT_FACE_RULE')) {
          return { content: [{ type: 'text', text: JSON.stringify({
            styles: [
              'color: rgb(20, 20, 20); font-size: 48px',
              'background-color: rgb(245, 245, 245)',
              'color: rgb(200, 30, 60)',
              'color: rgb(200, 30, 60)',
              'color: rgb(30, 90, 180)',
            ],
            fontFaces: [{ family: 'Canva Sans' }, { family: 'Playfair Display' }, { family: 'Open Sans' }],
          })}] };
        }
        if (expr.includes('data-section-id')) {
          return { content: [{ type: 'text', text: JSON.stringify([{
            id: 'section-0',
            bounds: { x: 0, y: 0, width: 1280, height: 640 },
            elements: [
              { tagName: 'H1', textContent: 'Welcome',
                style: { fontSize: '48px', fontFamily: 'Playfair Display', color: 'rgb(20, 20, 20)' },
                bounds: { x: 100, y: 120, width: 600, height: 60 }, src: null },
              { tagName: 'IMG', textContent: '', style: {},
                bounds: { x: 0, y: 0, width: 1280, height: 640 }, src: 'https://cdn.example/hero.jpg' },
            ],
          }])}] };
        }
        if (expr.includes('nav a[href]')) {
          return { content: [{ type: 'text', text: JSON.stringify([{ label: 'About', path: '/about' }]) }] };
        }
        if (expr.includes('img[src]')) {
          return { content: [{ type: 'text', text: JSON.stringify([{ src: 'https://cdn.example/hero.jpg', alt: 'Hero' }]) }] };
        }
        if (expr.startsWith('document.querySelectorAll(') && expr.endsWith('.length')) {
          return { content: [{ type: 'text', text: '1' }] }; // selector-poll: element present
        }
        if (expr.includes('extractStylesSrc') || expr.includes('samples')) {
          if (process.env.FAKE_TOKENS_FAIL_URL && currentUrl === process.env.FAKE_TOKENS_FAIL_URL) {
            return { content: [{ type: 'text', text: 'Tool error: style extraction blew up' }], isError: true };
          }
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
