/**
 * Passkey-IndieAuth dispatch (Anglesite/anglesite#363, problem 2 / IndieAuth).
 * The WebAuthn ceremony endpoints, the consent endpoint, and the generic /auth
 * authorization endpoint mount under /auth, gated on AUTH_DB.
 */
import { describe, it, expect, vi } from "vitest";
import worker from "../template/worker/site-entry.js";

function ctx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}
function env(overrides: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset", { headers: { "x-asset": "1" } })) },
    SITE_URL: "https://example.com",
    ...overrides,
  } as any;
}
function req(path: string, init: RequestInit = {}) {
  return new Request(`https://example.com${path}`, { method: "POST", ...init });
}

describe("WebAuthn ceremony dispatch", () => {
  it("routes /auth/webauthn/* to the WebAuthn handler when AUTH_DB is bound", async () => {
    const res = await worker.fetch(
      req("/auth/webauthn/authenticate/options"),
      env({ AUTH_DB: {}, WEBAUTHN: {} }),
      ctx(),
    );
    expect(res.headers.get("x-handler")).toBe("webauthn");
  });

  it("falls through /auth/webauthn/* to ASSETS when AUTH_DB is absent", async () => {
    const e = env();
    const res = await worker.fetch(req("/auth/webauthn/authenticate/options"), e, ctx());
    expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-handler")).toBeNull();
  });
});
