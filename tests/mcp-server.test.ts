import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const SERVER_PATH = resolve(__dirname, "..", "server", "index.mjs");

// ---------------------------------------------------------------------------
// Helpers — send JSON-RPC messages to the MCP server over stdio
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function startServer(projectRoot: string) {
  const proc = spawn("node", [SERVER_PATH], {
    env: { ...process.env, ANGLESITE_PROJECT_ROOT: projectRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return proc;
}

/** Shared readline-style response queue per process. */
const responseQueues = new WeakMap<
  ReturnType<typeof spawn>,
  { pending: Array<(resp: JsonRpcResponse) => void>; buffer: string }
>();

function getQueue(proc: ReturnType<typeof spawn>) {
  if (!responseQueues.has(proc)) {
    const state = { pending: [] as Array<(resp: JsonRpcResponse) => void>, buffer: "" };
    responseQueues.set(proc, state);
    proc.stdout!.on("data", (chunk: Buffer) => {
      state.buffer += chunk.toString();
      const lines = state.buffer.split("\n");
      state.buffer = lines.pop()!; // keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id !== undefined && state.pending.length > 0) {
            state.pending.shift()!(parsed);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });
  }
  return responseQueues.get(proc)!;
}

function sendNotification(
  proc: ReturnType<typeof spawn>,
  message: object,
): void {
  getQueue(proc); // ensure listener is attached
  proc.stdin!.write(JSON.stringify(message) + "\n");
}

function sendMessage(
  proc: ReturnType<typeof spawn>,
  message: object,
): Promise<JsonRpcResponse> {
  const queue = getQueue(proc);
  return new Promise((resolve) => {
    queue.pending.push(resolve);
    proc.stdin!.write(JSON.stringify(message) + "\n");
  });
}

// ---------------------------------------------------------------------------
// MCP server integration tests
// ---------------------------------------------------------------------------

describe("MCP annotation server", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-mcp-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("responds to initialize with server info and tool capabilities", async () => {
    const proc = startServer(tmpDir);
    try {
      const response = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });
      expect(response.result).toBeDefined();
      const result = response.result as {
        serverInfo: { name: string };
        capabilities: { tools: object };
      };
      expect(result.serverInfo.name).toBe("anglesite-annotations");
      expect(result.capabilities.tools).toBeDefined();
    } finally {
      proc.kill();
    }
  });

  it("lists three annotation tools", async () => {
    const proc = startServer(tmpDir);
    try {
      await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });
      sendNotification(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      const response = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
      const result = response.result as { tools: { name: string }[] };
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "add_annotation",
        "list_annotations",
        "resolve_annotation",
      ]);
    } finally {
      proc.kill();
    }
  });

  it("add_annotation creates and returns an annotation", async () => {
    const proc = startServer(tmpDir);
    try {
      await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });
      sendNotification(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      const response = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "add_annotation",
          arguments: {
            path: "/about",
            selector: "h1.hero",
            text: "Fix line-height",
          },
        },
      });
      const result = response.result as {
        content: { type: string; text: string }[];
      };
      expect(result.content).toHaveLength(1);
      const annotation = JSON.parse(result.content[0].text);
      expect(annotation.path).toBe("/about");
      expect(annotation.selector).toBe("h1.hero");
      expect(annotation.text).toBe("Fix line-height");
      expect(annotation.resolved).toBe(false);

      // Verify persisted to disk in versioned format
      const stored = JSON.parse(
        readFileSync(join(tmpDir, "annotations.json"), "utf-8"),
      );
      expect(stored.version).toBe(1);
      expect(stored.annotations).toHaveLength(1);
    } finally {
      proc.kill();
    }
  });

  it("list_annotations returns unresolved annotations", async () => {
    const proc = startServer(tmpDir);
    try {
      await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });
      sendNotification(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // Add two annotations
      await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "add_annotation",
          arguments: { path: "/", selector: "h1", text: "Note 1" },
        },
      });
      await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "add_annotation",
          arguments: { path: "/about", selector: "h2", text: "Note 2" },
        },
      });

      // List all
      const response = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "list_annotations", arguments: {} },
      });
      const result = response.result as {
        content: { type: string; text: string }[];
      };
      const annotations = JSON.parse(result.content[0].text);
      expect(annotations).toHaveLength(2);
    } finally {
      proc.kill();
    }
  });

  it("resolve_annotation marks annotation as resolved", async () => {
    const proc = startServer(tmpDir);
    try {
      await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });
      sendNotification(proc, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      // Add annotation
      const addResponse = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "add_annotation",
          arguments: { path: "/", selector: "h1", text: "Fix this" },
        },
      });
      const addResult = addResponse.result as {
        content: { text: string }[];
      };
      const { id } = JSON.parse(addResult.content[0].text);

      // Resolve it
      const resolveResponse = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "resolve_annotation", arguments: { id } },
      });
      const resolveResult = resolveResponse.result as {
        content: { text: string }[];
      };
      const resolved = JSON.parse(resolveResult.content[0].text);
      expect(resolved.resolved).toBe(true);

      // Verify list excludes it
      const listResponse = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "list_annotations", arguments: {} },
      });
      const listResult = listResponse.result as {
        content: { text: string }[];
      };
      const remaining = JSON.parse(listResult.content[0].text);
      expect(remaining).toHaveLength(0);
    } finally {
      proc.kill();
    }
  });
});
