import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const urlPath = (req.url ?? "/fixture.html").split("?")[0];
  const requestedPath = urlPath === "/" ? "/fixture.html" : urlPath;
  const resolvedPath = join(root, normalize(requestedPath));

  // Bound to 127.0.0.1 and test-only, but still validate: normalize() collapses `..`
  // segments, and this check refuses anything that still resolves outside `root` (e.g.
  // `/../../etc/passwd`) before it ever reaches the filesystem.
  if (resolvedPath !== root && !resolvedPath.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  try {
    const body = await readFile(resolvedPath);
    res.writeHead(200, { "Content-Type": types[extname(resolvedPath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(4173, "127.0.0.1", () => {
  console.log("fixture server listening on http://127.0.0.1:4173");
});
