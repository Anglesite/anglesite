// Stub for the @dwk/webmention package, matching the real 0.1.0-beta.3 API.
// site-entry.js composes the receiver and queue consumer at module load and
// reads the inbox through createD1Inbox(); the vitest alias maps
// "@dwk/webmention" to this file so the worker and the test share one module
// instance (and one set of counters).
//
// The real inbox stores only { source, target, verifiedAt } — no author/content.
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
// The queue consumer is a SEPARATE factory from the handler in the real package.
export function createWebmentionQueueConsumer(_config?: unknown) {
  return async (_batch: unknown, _env: unknown, _ctx: unknown) => {
    webmentionCalls.queue++;
  };
}

// createD1Inbox(db) → InboxStore. The edge-render reads mentions via
// inbox.list(target?). Tests drive the data through a fake `db.__list`.
export function createD1Inbox(db: any) {
  return {
    list: async (target?: string) =>
      db && typeof db.__list === "function" ? db.__list(target) : [],
    upsert: async () => {},
    remove: async () => {},
  };
}
