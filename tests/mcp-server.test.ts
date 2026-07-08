import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

interface ProcessState {
  pending: Array<{
    resolve: (resp: JsonRpcResponse) => void;
    reject: (err: Error) => void;
  }>;
  buffer: string;
  stderr: string;
  exited: boolean;
}

/** Shared readline-style response queue per process. */
const responseQueues = new WeakMap<ReturnType<typeof spawn>, ProcessState>();

function getQueue(proc: ReturnType<typeof spawn>) {
  if (!responseQueues.has(proc)) {
    const state: ProcessState = {
      pending: [],
      buffer: "",
      stderr: "",
      exited: false,
    };
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
            state.pending.shift()!.resolve(parsed);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      state.stderr += chunk.toString();
    });

    proc.on("exit", (code) => {
      state.exited = true;
      if (code !== 0 && state.pending.length > 0) {
        const err = new Error(
          `MCP server exited with code ${code}.\nstderr: ${state.stderr || "(empty)"}`,
        );
        for (const p of state.pending) {
          p.reject(err);
        }
        state.pending.length = 0;
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
  return new Promise((resolve, reject) => {
    if (queue.exited) {
      reject(
        new Error(
          `MCP server already exited.\nstderr: ${queue.stderr || "(empty)"}`,
        ),
      );
      return;
    }
    queue.pending.push({ resolve, reject });
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
      expect(result.serverInfo.name).toBe("anglesite");
      expect(result.capabilities.tools).toBeDefined();
    } finally {
      proc.kill();
    }
  });

  it("lists the annotation tools plus the apply_edit edit-pipeline tool", async () => {
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
        "apply_edit",
        "create_content",
        "create_page",
        "create_post",
        "get_component_model",
        "list_annotations",
        "list_content",
        "resolve_annotation",
        "undo_edit",
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

  it("list_content returns structured pages, posts, and images over stdio", async () => {
    mkdirSync(join(tmpDir, "src", "pages"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "pages", "about.astro"),
      `<BaseLayout title="About" description="x" />`,
    );
    mkdirSync(join(tmpDir, "src", "content", "posts"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "content", "posts", "hello.md"),
      `---\ntitle: Hello\ndescription: d\npublishDate: 2026-06-01\ndraft: false\ntags: [intro]\n---\nBody`,
    );

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
        params: { name: "list_content", arguments: {} },
      });
      const result = response.result as { content: { text: string }[] };
      const listing = JSON.parse(result.content[0].text);
      expect(listing.pages).toEqual([
        expect.objectContaining({ route: "/about", filePath: "src/pages/about.astro", title: "About" }),
      ]);
      expect(listing.posts).toEqual([
        expect.objectContaining({ collection: "posts", slug: "hello", title: "Hello", draft: false, tags: ["intro"] }),
      ]);
      expect(listing.images).toEqual([]);
    } finally {
      proc.kill();
    }
  });

  it("create_page scaffolds a page and reports its route over stdio", async () => {
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
        params: { name: "create_page", arguments: { name: "Contact Us" } },
      });
      const result = response.result as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBeFalsy();
      const created = JSON.parse(result.content[0].text);
      expect(created.route).toBe("/contact-us");
      expect(created.filePath).toBe("src/pages/contact-us.astro");
      expect(readFileSync(join(tmpDir, created.filePath), "utf-8")).toContain('title="Contact Us"');
    } finally {
      proc.kill();
    }
  });

  it("apply_edit with op edit-style + dry_run returns edit-preview and leaves file unchanged", async () => {
    mkdirSync(join(tmpDir, "src", "pages"), { recursive: true });
    const filePath = join(tmpDir, "src", "pages", "about.astro");
    writeFileSync(filePath, '---\n---\n<h1 id="t">Welcome</h1>\n');
    const before = readFileSync(filePath);

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
          name: "apply_edit",
          arguments: {
            id: "9",
            path: "/about/",
            selector: { tag: "h1", id: "t", classes: [], nthChild: 1, textContent: "Welcome" },
            op: "edit-style",
            value: { property: "color", value: "teal" },
            dry_run: true,
          },
        },
      });

      const result = response.result as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.type).toBe("anglesite:edit-preview");
      expect(body.after).toMatch(/color:\s*teal/);

      // File must be byte-identical — dry_run must not mutate disk
      expect(readFileSync(filePath)).toEqual(before);
    } finally {
      proc.kill();
    }
  });

  it("get_component_model returns a structured model over stdio", async () => {
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "components", "Card.astro"),
      `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<article class="card"><h2>{title}</h2></article>\n<style>.card { padding: 1rem; }</style>\n`,
    );
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
      sendNotification(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

      const response = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_component_model", arguments: { path: "src/components/Card.astro" } },
      });
      const result = response.result as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBeFalsy();
      const model = JSON.parse(result.content[0].text);
      expect(model.path).toBe("src/components/Card.astro");
      expect(model.template.children[0].tag).toBe("article");
      expect(model.frontmatter.props[0].name).toBe("title");
      expect(model.styles[0].selector).toBe(".card");

      const failure = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_component_model", arguments: { path: "src/components/Nope.astro" } },
      });
      const failResult = failure.result as { content: { text: string }[]; isError?: boolean };
      expect(failResult.isError).toBe(true);
      expect(JSON.parse(failResult.content[0].text).reason).toBe("read-failed");
    } finally {
      proc.kill();
    }
  });

  it("apply_edit set-style-property round trip returns a piggybacked model", async () => {
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "components", "Card.astro"),
      `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<article class="card"><h2>{title}</h2></article>\n<style>.card { padding: 1rem; }</style>\n`,
    );
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
      sendNotification(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

      const modelResponse = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_component_model", arguments: { path: "src/components/Card.astro" } },
      });
      const modelResult = modelResponse.result as { content: { text: string }[]; isError?: boolean };
      expect(modelResult.isError).toBeFalsy();
      const model = JSON.parse(modelResult.content[0].text);
      const rule = model.styles[0];
      expect(rule.selector).toBe(".card");

      const editResponse = await sendMessage(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "apply_edit",
          arguments: {
            id: "rt-1",
            path: "src/components/Card.astro",
            op: "set-style-property",
            component: {
              path: "src/components/Card.astro",
              baseVersion: model.version,
              ruleSpan: rule.span,
              property: "color",
              value: "blue",
            },
          },
        },
      });
      const editResult = editResponse.result as { content: { text: string }[]; isError?: boolean };
      expect(editResult.isError).toBeFalsy();
      const body = JSON.parse(editResult.content[0].text);
      expect(body.type).toBe("anglesite:edit-applied");
      expect(
        body.model.styles[0].declarations.some(
          (d: { property: string; value: string }) => d.property === "color" && d.value === "blue",
        ),
      ).toBe(true);

      // Confirm the write actually landed on disk, not just in the piggybacked model.
      const onDisk = readFileSync(join(tmpDir, "src", "components", "Card.astro"), "utf-8");
      expect(onDisk).toMatch(/color:\s*blue/);
    } finally {
      proc.kill();
    }
  });
});
