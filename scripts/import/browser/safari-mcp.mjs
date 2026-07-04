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
    const failPending = (message) => {
      for (const { reject } of this.pending.values()) {
        reject(new SafariMcpError('session-failed', message));
      }
      this.pending.clear();
    };
    this.child.on('error', (err) => failPending(err.message));
    // A broken pipe (e.g. the Safari window was closed) surfaces as an EPIPE
    // write error on stdin; without a listener here it's an unhandled stream
    // error that crashes the process instead of rejecting the in-flight call.
    this.child.stdin.on('error', (err) => failPending(err.message));
    // If safaridriver dies while requests are pending, reject them immediately
    // instead of letting each one silently wait out its own timeout (up to 60s).
    this.child.on('exit', (code, signal) => {
      failPending(`safaridriver exited (code=${code}, signal=${signal})`);
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
