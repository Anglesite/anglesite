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
