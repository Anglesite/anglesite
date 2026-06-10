// Stub for the unpublished @dwk/indieauth package. site-entry.js composes the
// real handler at module load; in tests we only need a tagged handler so the
// dispatch assertions can prove which endpoint a request reached. Tests never
// mock this — the stub IS the substitute (the real package is 0.0.0/unpublished).
export function createHandler(_config?: unknown) {
  return Object.assign(
    (_request: Request, _env: unknown, _ctx: unknown) =>
      new Response("indieauth", { headers: { "x-handler": "indieauth" } }),
    {
      queue: async () => {},
      scheduled: async () => {},
    },
  );
}
