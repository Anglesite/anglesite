// Stub for the unpublished @dwk/webmention package. See dwk-indieauth.ts for
// the rationale. This stub also records queue/scheduled invocations on a shared
// `webmentionCalls` object so the queue()/scheduled() dispatch tests can assert
// that the webmention worker hooks run only when WEBMENTION_DB is bound.
// Because the vitest alias maps "@dwk/webmention" to this same file, the test
// and site-entry.js share one module instance — and therefore one counter.
export const webmentionCalls = { fetch: 0, queue: 0, scheduled: 0 };

export function resetWebmentionCalls() {
  webmentionCalls.fetch = 0;
  webmentionCalls.queue = 0;
  webmentionCalls.scheduled = 0;
}

export function createHandler(_config?: unknown) {
  return Object.assign(
    (_request: Request, _env: unknown, _ctx: unknown) => {
      webmentionCalls.fetch++;
      return new Response("webmention", { headers: { "x-handler": "webmention" } });
    },
    {
      queue: async () => {
        webmentionCalls.queue++;
      },
      scheduled: async () => {
        webmentionCalls.scheduled++;
      },
    },
  );
}
