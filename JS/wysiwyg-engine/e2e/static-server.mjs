import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;

// This fixture server has exactly two files to serve — enumerate them explicitly rather than
// building a filesystem path from the request URL. There is no dynamic path expression here for
// a path-traversal scanner (or a future edit) to worry about: `route.file` below is always one
// of these two literals, never derived from `req.url`.
const ROUTES = {
  "/": { file: "fixture.html", type: "text/html" },
  "/fixture.html": { file: "fixture.html", type: "text/html" },
  "/.generated/fixture-bundle.js": { file: ".generated/fixture-bundle.js", type: "text/javascript" },
};

createServer(async (req, res) => {
  const route = ROUTES[(req.url ?? "/").split("?")[0]];
  if (!route) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  try {
    const body = await readFile(join(root, route.file));
    res.writeHead(200, { "Content-Type": route.type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(4173, "127.0.0.1", () => {
  console.log("fixture server listening on http://127.0.0.1:4173");
});
