import { startStdioServer } from "./index-tools.mjs";
import { startHttpServer } from "./http-server.mjs";

const projectRoot = process.env.ANGLESITE_PROJECT_ROOT || process.cwd();
const transport = (process.env.ANGLESITE_MCP_TRANSPORT || "stdio").toLowerCase();

if (transport === "http") {
  const host = process.env.ANGLESITE_MCP_HOST || "127.0.0.1";
  const port = Number(process.env.ANGLESITE_MCP_PORT || "4399");
  await startHttpServer({ projectRoot, host, port });
} else {
  await startStdioServer({ projectRoot });
}
