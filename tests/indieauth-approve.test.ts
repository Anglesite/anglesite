/**
 * approveAuthorization + consent (#363, problem 2). The consent token binds an
 * approval to one specific authorization request so a malicious client can't
 * deep-link past the visible consent screen.
 */
import { describe, it, expect, vi } from "vitest";
import worker from "../template/worker/site-entry.js";
import {
  mintConsentToken,
  verifyConsentToken,
  issueOwnerSession,
  OWNER_COOKIE,
} from "../template/worker/owner-auth.js";

const KEY = "00112233445566778899aabbccddeeff";
const SESSION_KEY = "aabbccddeeff00112233445566778899";

function ctx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}
function env(o: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    SITE_URL: "https://example.com",
    AUTH_DB: {},
    WEBAUTHN: {},
    INDIEAUTH_SESSION_KEY: SESSION_KEY,
    ...o,
  } as any;
}
function authUrl(extra = "") {
  return (
    "https://example.com/auth?response_type=code" +
    "&client_id=https://app.example&redirect_uri=https://app.example/cb" +
    "&state=xyz&code_challenge=abc&code_challenge_method=S256&scope=create" +
    extra
  );
}
const REQ = {
  clientId: "https://app.example",
  redirectUri: "https://app.example/cb",
  scope: "create",
};

describe("consent token", () => {
  it("verifies a token bound to the same request", async () => {
    const t = await mintConsentToken(KEY, REQ, 300);
    expect(await verifyConsentToken(t, KEY, REQ)).toBe(true);
  });

  it("rejects when a bound field differs", async () => {
    const t = await mintConsentToken(KEY, REQ, 300);
    expect(await verifyConsentToken(t, KEY, { ...REQ, scope: "create media" })).toBe(false);
    expect(
      await verifyConsentToken(t, KEY, { ...REQ, redirectUri: "https://evil.example/cb" }),
    ).toBe(false);
  });

  it("rejects an expired token", async () => {
    const t = await mintConsentToken(KEY, REQ, -1);
    expect(await verifyConsentToken(t, KEY, REQ)).toBe(false);
  });

  it("rejects a malformed token", async () => {
    expect(await verifyConsentToken("", KEY, REQ)).toBe(false);
    expect(await verifyConsentToken("nodot", KEY, REQ)).toBe(false);
  });
});

describe("approveAuthorization via the worker", () => {
  it("returns the consent page when there is no owner session", async () => {
    const res = await worker.fetch(new Request(authUrl()), env(), ctx());
    expect(res.headers.get("x-approval")).toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="passkey-signin"');
  });

  it("returns an approval (me=SITE_URL) given a valid session + consent token", async () => {
    const session = await issueOwnerSession(SESSION_KEY, 900);
    const consent = await mintConsentToken(
      SESSION_KEY,
      {
        clientId: "https://app.example",
        redirectUri: "https://app.example/cb",
        scope: "create",
      },
      300,
    );
    const request = new Request(authUrl("&_consent=" + encodeURIComponent(consent)), {
      headers: { Cookie: `${OWNER_COOKIE}=${session}` },
    });
    const res = await worker.fetch(request, env(), ctx());
    expect(res.headers.get("x-approval")).toBe("1");
    const approval = await res.json();
    expect(approval.me).toBe("https://example.com");
    expect(approval.scopes).toContain("create");
  });

  it("ignores a forged consent token even with a valid session", async () => {
    const session = await issueOwnerSession(SESSION_KEY, 900);
    const request = new Request(authUrl("&_consent=deadbeef.0000"), {
      headers: { Cookie: `${OWNER_COOKIE}=${session}` },
    });
    const res = await worker.fetch(request, env(), ctx());
    expect(res.headers.get("x-approval")).toBeNull();
    expect(await res.text()).toContain("passkey");
  });
});
