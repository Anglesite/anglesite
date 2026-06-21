/**
 * /auth/consent (#363, problem 2): a verified passkey assertion or a redeemed
 * backup code establishes the owner session and mints a request-bound consent
 * token, then 302s back to /auth so approveAuthorization can complete.
 */
import { describe, it, expect, vi } from "vitest";
import worker from "../template/worker/site-entry.js";
import {
  generateBackupCodes,
  verifyConsentToken,
  OWNER_COOKIE,
} from "../template/worker/owner-auth.js";

const SESSION_KEY = "aabbccddeeff00112233445566778899";
const QUERY =
  "response_type=code&client_id=https://app.example" +
  "&redirect_uri=https://app.example/cb&state=xyz&code_challenge=abc&scope=create";

function ctx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}
function fakeD1() {
  const rows: any[] = [];
  return {
    prepare(sql: string) {
      const stmt: any = {
        _args: [] as any[],
        bind(...a: any[]) { stmt._args = a; return stmt; },
        async run() {
          if (/INSERT/.test(sql)) rows.push({ code_hash: stmt._args[0], used_at: null });
          else if (/UPDATE/.test(sql)) { const r = rows.find((x) => x.code_hash === stmt._args[0] && !x.used_at); if (r) r.used_at = stmt._args[1]; }
          return { success: true };
        },
        async first() {
          if (/SELECT/.test(sql)) return rows.find((x) => x.code_hash === stmt._args[0] && !x.used_at) ?? null;
          return null;
        },
        async all() { return { results: rows }; },
      };
      return stmt;
    },
  } as any;
}
function env(db: any) {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    SITE_URL: "https://example.com",
    AUTH_DB: {},
    WEBAUTHN: {},
    INDIEAUTH_SESSION_KEY: SESSION_KEY,
    OWNER_AUTH_DB: db,
  } as any;
}
function consentPost(body: unknown) {
  return new Request("https://example.com/auth/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/auth/consent", () => {
  it("redeems a backup code → 302 with owner session + valid consent token", async () => {
    const db = fakeD1();
    const [code] = await generateBackupCodes(db, 1);
    const res = await worker.fetch(consentPost({ backupCode: code, query: QUERY }), env(db), ctx());

    expect(res.status).toBe(302);
    const loc = res.headers.get("Location")!;
    expect(loc).toContain("/auth?");
    expect(res.headers.get("Set-Cookie")).toContain(`${OWNER_COOKIE}=`);

    const consent = new URL("https://example.com" + loc).searchParams.get("_consent")!;
    expect(
      await verifyConsentToken(consent, SESSION_KEY, {
        clientId: "https://app.example",
        redirectUri: "https://app.example/cb",
        scope: "create",
      }),
    ).toBe(true);
  });

  it("rejects a bad backup code → 401, no session cookie", async () => {
    const db = fakeD1();
    await generateBackupCodes(db, 1);
    const res = await worker.fetch(consentPost({ backupCode: "ZZZZZ-ZZZZZ", query: QUERY }), env(db), ctx());
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects a used backup code on the second attempt", async () => {
    const db = fakeD1();
    const [code] = await generateBackupCodes(db, 1);
    await worker.fetch(consentPost({ backupCode: code, query: QUERY }), env(db), ctx());
    const res = await worker.fetch(consentPost({ backupCode: code, query: QUERY }), env(db), ctx());
    expect(res.status).toBe(401);
  });
});
