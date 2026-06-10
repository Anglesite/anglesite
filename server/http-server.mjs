import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./index-tools.mjs";

/** Read and JSON-parse a request body. Returns `undefined` for an empty body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => { chunks.push(chunk); });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Start the Anglesite MCP server over Streamable HTTP on a single `/mcp` endpoint.
 * Session-managed: an `initialize` POST mints a session + per-session transport;
 * subsequent requests carry `Mcp-Session-Id`.
 *
 * Returns `{ url, close }` where `url` is the full endpoint (`http://host:port/mcp`).
 */
export async function startHttpServer({ projectRoot, host = "127.0.0.1", port = 4399 }) {
  /** @type {Map<string, StreamableHTTPServerTransport>} */
  const transports = new Map();

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== "/mcp") { res.writeHead(404).end(); return; }

      const sid = req.headers["mcp-session-id"];

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        let transport = typeof sid === "string" ? transports.get(sid) : undefined;

        if (!transport) {
          if (!isInitializeRequest(body)) {
            sendJson(res, 400, {
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request: no valid session ID provided" },
              id: null,
            });
            return;
          }
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          const server = buildServer(projectRoot);
          await server.connect(transport);
        }

        await transport.handleRequest(req, res, body);
        if (transport.sessionId) transports.set(transport.sessionId, transport);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const transport = typeof sid === "string" ? transports.get(sid) : undefined;
        if (!transport) { res.writeHead(400).end("Invalid or missing session ID"); return; }
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405).end();
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: String(err) }, id: null });
    }
  });

  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  const actualPort = httpServer.address().port;
  const endpoint = `http://${host}:${actualPort}/mcp`;
  console.log(`Anglesite MCP listening on ${endpoint}`);

  return {
    url: endpoint,
    close: async () => {
      await Promise.all([...transports.values()].map((t) => t.close?.()));
      transports.clear();
      await new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}
