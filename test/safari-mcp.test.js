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

  it('maps a page-thrown error containing "allow remote automation" without the WebDriver signature to page-failure', async () => {
    process.env.FAKE_EVAL_ERROR_TEXT = 'Uncaught ReferenceError: please allow remote automation of this widget';
    client = new SafariMcp(FAKE);
    await client.start();
    await expect(client.call('evaluate_javascript', { expression: '1' }))
      .rejects.toMatchObject({ code: 'page-failure' });
    delete process.env.FAKE_EVAL_ERROR_TEXT;
  });

  it('rejects pending calls with session-failed when safaridriver dies mid-batch, and guards use-after-death', async () => {
    process.env.FAKE_SAFARIDRIVER_MODE = 'die-after-first-call';
    client = new SafariMcp(FAKE);
    await client.start();

    // First call succeeds normally.
    const first = await client.call('navigate_to_url', { url: 'https://ok.example' });
    expect(first).toBe('Loaded https://ok.example');

    // Second call: the fake driver exits before responding. Must reject
    // promptly with session-failed, well under the large timeout passed.
    await expect(client.call('navigate_to_url', { url: 'https://ok.example' }, 30000))
      .rejects.toMatchObject({ code: 'session-failed' });

    // A subsequent call after the child has died must also reject immediately
    // instead of writing to a dead stdin.
    await expect(client.call('navigate_to_url', { url: 'https://ok.example' }, 30000))
      .rejects.toMatchObject({ code: 'session-failed' });
  }, 5000);
});
