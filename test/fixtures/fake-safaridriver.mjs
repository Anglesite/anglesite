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
