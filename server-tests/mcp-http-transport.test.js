import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../server/http-server.mjs";

describe("MCP Streamable HTTP transport", () => {
  let root;
  let handle;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mcp-http-"));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it("serves initialize, tools/list and a tool call over HTTP", async () => {
    handle = await startHttpServer({ projectRoot: root, host: "127.0.0.1", port: 0 });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("list_annotations");
    expect(names).toContain("apply_edit");

    const res = await client.callTool({ name: "list_annotations", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual([]);

    await client.close();
  });
});
