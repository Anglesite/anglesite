// Stub for the unpublished @dwk/webmention package. The real package composes
// into the site Worker via worker/webmention.js; in tests the vitest alias maps
// "@dwk/webmention" to this file so that module imports cleanly. It records
// receiver/consumer invocations on a shared `webmentionCalls` object so the
// dispatch tests can assert the hooks fire only when WEBMENTION_DB is bound.
// Because the alias maps to this same file, the test and worker code share one
// module instance — and therefore one counter.
export const webmentionCalls = { receive: 0, queue: 0 };

export function resetWebmentionCalls() {
  webmentionCalls.receive = 0;
  webmentionCalls.queue = 0;
}

/** Mirrors `createWebmention({ baseUrl })` → the `/webmention` receiver. */
export function createWebmention(_config?: unknown) {
  return (_request: Request, _env: unknown, _ctx: unknown) => {
    webmentionCalls.receive++;
    return new Response(null, {
      status: 202,
      headers: { "x-handler": "webmention" },
    });
  };
}

/** Mirrors `createWebmentionQueueConsumer({ inbox })` → the queue consumer. */
export function createWebmentionQueueConsumer(_config?: unknown) {
  return async (_batch: unknown, _env: unknown, _ctx: unknown) => {
    webmentionCalls.queue++;
  };
}

/** Mirrors `safeFetch(doFetch, url, init, options)` → `{ response, url }`. */
export async function safeFetch(
  _doFetch: unknown,
  url: string,
  _init?: unknown,
  _options?: unknown,
) {
  return { response: new Response("", { status: 200 }), url };
}
