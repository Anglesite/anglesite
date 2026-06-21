/**
 * Passkey-IndieAuth dispatch (Anglesite/anglesite#363, problem 2 / IndieAuth).
 * The WebAuthn ceremony endpoints, the consent endpoint, and the generic /auth
 * authorization endpoint mount under /auth, gated on AUTH_DB.
 */
import { describe, it, expect, vi } from "vitest";
import worker from "../template/worker/site-entry.js";
import { issueOwnerSession, OWNER_COOKIE } from "../template/worker/owner-auth.js";

const REG_TOKEN = "one-time-reg-token";
const SESSION_KEY = "aabbccddeeff00112233445566778899";

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

describe("owner-only registration gating", () => {
  const base = { AUTH_DB: {}, WEBAUTHN: {}, INDIEWEB_REG_TOKEN: REG_TOKEN, INDIEAUTH_SESSION_KEY: SESSION_KEY };

  it("403s /auth/webauthn/register/* with no token and no session", async () => {
    const res = await worker.fetch(req("/auth/webauthn/register/options"), env(base), ctx());
    expect(res.status).toBe(403);
    expect(res.headers.get("x-handler")).toBeNull();
  });

  it("allows registration with the one-time token", async () => {
    const res = await worker.fetch(
      req(`/auth/webauthn/register/options?token=${REG_TOKEN}`),
      env(base),
      ctx(),
    );
    expect(res.headers.get("x-handler")).toBe("webauthn");
  });

  it("allows registration with a valid owner session", async () => {
    const session = await issueOwnerSession(SESSION_KEY, 900);
    const r = new Request("https://example.com/auth/webauthn/register/options", {
      method: "POST",
      headers: { Cookie: `${OWNER_COOKIE}=${session}` },
    });
    const res = await worker.fetch(r, env(base), ctx());
    expect(res.headers.get("x-handler")).toBe("webauthn");
  });

  it("does NOT gate the authenticate ceremony (proves possession only)", async () => {
    const res = await worker.fetch(req("/auth/webauthn/authenticate/options"), env(base), ctx());
    expect(res.headers.get("x-handler")).toBe("webauthn");
  });

  it("serves the register page at GET /auth/register", async () => {
    const r = new Request(`https://example.com/auth/register?token=${REG_TOKEN}`, { method: "GET" });
    const res = await worker.fetch(r, env(base), ctx());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="passkey-register"');
  });
});
