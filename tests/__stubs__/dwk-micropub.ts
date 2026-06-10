// Stub for the unpublished @dwk/micropub package. See dwk-indieauth.ts for the
// rationale. site-entry.js calls createHandler({ generatePostUrl }); the stub
// accepts and ignores config and returns a tagged handler.
export function createHandler(_config?: unknown) {
  return Object.assign(
    (_request: Request, _env: unknown, _ctx: unknown) =>
      new Response("micropub", { headers: { "x-handler": "micropub" } }),
    {
      queue: async () => {},
      scheduled: async () => {},
    },
  );
}
