// Stub for the @dwk/micropub package (real 0.1.0-beta.x API). site-entry.js
// composes createMicropub({ baseUrl, me, generatePostUrl }) per-env. The real
// package validates baseUrl/me and self-asserts its MEDIA / MICROPUB_DB /
// AUTH_DB / TOKEN_SIGNING_KEY bindings on each request; the stub ignores config
// and returns a tagged fetch handler so the dispatch tests can identify the
// /micropub and /media routes by their `x-handler` response header.
export function createMicropub(_config?: unknown) {
  return (_request: Request, _env: unknown, _ctx: unknown) =>
    new Response("micropub", { headers: { "x-handler": "micropub" } });
}
