// Stub for the @dwk/webmention package (real API: 0.1.0-beta.2). site-entry.js
// composes the receiver + queue consumer at module load and backs the inbox
// with the rich inbox (worker/webmention-inbox.js, which imports `safeFetch`
// from here). The vitest alias maps "@dwk/webmention" to this file so the worker
// and the test share one module instance (and one set of counters).
export const webmentionCalls = { fetch: 0, queue: 0 };

export function resetWebmentionCalls() {
  webmentionCalls.fetch = 0;
  webmentionCalls.queue = 0;
}

// createWebmention(config) → fetch handler (validates + 202 + enqueue).
export function createWebmention(_config?: unknown) {
  return (_request: Request, _env: unknown, _ctx: unknown) => {
    webmentionCalls.fetch++;
    return new Response("webmention", { headers: { "x-handler": "webmention" } });
  };
}

// createWebmentionQueueConsumer(config) → (batch, env, ctx) => Promise<void>.
// The queue consumer is a SEPARATE factory from the handler in the real package;
// here it just records that the drain ran.
export function createWebmentionQueueConsumer(_config?: unknown) {
  return async (_batch: unknown, _env: unknown, _ctx: unknown) => {
    webmentionCalls.queue++;
  };
}

// safeFetch(doFetch, url, init, options) → { response, url }. The real package
// adds SSRF guards; the stub just delegates to the injected fetch so inbox tests
// can serve canned source HTML through `fetchImpl`.
export async function safeFetch(
  doFetch: unknown,
  url: string,
  init?: RequestInit,
  _options?: unknown,
) {
  const response =
    typeof doFetch === "function"
      ? await (doFetch as typeof fetch)(url, init)
      : new Response("", { status: 200 });
  return { response, url };
}
