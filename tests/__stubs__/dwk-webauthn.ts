// Stub for the @dwk/webauthn package (real 0.1.0-beta.3 API). site-entry.js
// composes createWebAuthn at module load and binds WebAuthnObject as a Durable
// Object. The vitest alias maps "@dwk/webauthn" to this file so the worker and
// the test share one module instance (and one counter).
export const webauthnCalls = { fetch: 0 };
export function resetWebauthnCalls() {
  webauthnCalls.fetch = 0;
}

// Bound as a Durable Object class in wrangler; never instantiated in tests.
export class WebAuthnObject {}

// createWebAuthn(config) → fetch handler exposing the four ceremony endpoints.
// The stub tags the response and echoes the ceremony path so dispatch + the
// /auth/consent verify step can assert which ceremony was reached.
export function createWebAuthn(_config?: unknown) {
  return (req: Request, _env: unknown, _ctx: unknown) => {
    webauthnCalls.fetch++;
    const path = new URL(req.url).pathname;
    return new Response("webauthn", {
      headers: { "x-handler": "webauthn", "x-webauthn-path": path },
    });
  };
}
