# Passkey-backed IndieAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@dwk/indieauth`'s `approveAuthorization` hook to a passkey
(`@dwk/webauthn`) owner-authentication + consent flow, with printable single-use
backup codes, so a site owner can sign in to IndieWeb services with their own
domain.

**Architecture:** All endpoints mount under `/auth` in `site-entry.js`, gated on
`env.AUTH_DB`. `approveAuthorization` returns the consent page (`Response`) until
a signed owner-session cookie + a request-bound consent token exist, then returns
`AuthorizationApproval`. Owner identity is proven by a passkey assertion (or a
backup code) against a `WEBAUTHN` Durable Object. Owner-side state (session keys,
consent tokens, backup-code hashes) lives in helpers we own, never in
`@dwk/indieauth`'s `AUTH_DB`.

**Tech Stack:** Cloudflare Workers (ESM), `@dwk/indieauth` + `@dwk/webauthn`
(`0.1.0-beta.3`), Durable Objects (SQLite), D1, WebCrypto (`crypto.subtle`
HMAC-SHA-256), Vitest with aliased package stubs.

## Global Constraints

- **Module system:** ESM only (`import`/`export`).
- **Worker files** live in `template/worker/*.js`; tests in `tests/*.test.ts`
  using the vitest aliases in `vitest.config.ts`.
- **No real `@dwk/*` at test time:** vitest aliases `@dwk/indieauth` and
  `@dwk/webauthn` to `tests/__stubs__/dwk-*.ts`. The stub IS the substitute.
- **Per-`env` memoized construction** (the `webmentionFor` pattern already in
  `site-entry.js`) — factories need config derived from `env.SITE_URL`.
- **Secrets never committed:** `INDIEAUTH_SESSION_KEY`, `INDIEWEB_REG_TOKEN` are
  wrangler secrets; the deploy scan asserts this.
- **Custom domain required** (skill preflight already enforces it) — passkeys are
  domain-bound.
- Reuse the existing HMAC cookie pattern (`verifyMembershipCookie` in
  `site-entry.js`) for the owner session.

## File Structure

- Create `template/worker/owner-auth.js` — owner session cookie
  (issue/verify), consent token (mint/verify), backup-code hash/redeem. Pure
  WebCrypto; no package deps. The testable security core.
- Create `template/worker/auth-pages.js` — `renderConsentPage()` and
  `renderRegisterPage()` returning HTML strings (inline JS drives the WebAuthn
  ceremonies). No logic beyond templating.
- Modify `template/worker/site-entry.js` — import `createIndieAuth` /
  `createWebAuthn`, re-export `WebAuthnObject`, add `/auth/*` dispatch +
  `approveAuthorization`.
- Modify `template/wrangler.jsonc` — `durable_objects` + `migrations` +
  `OWNER_AUTH_DB`.
- Create `tests/__stubs__/dwk-webauthn.ts`; rewrite `tests/__stubs__/dwk-indieauth.ts`.
- Create `tests/indieauth-session.test.ts`, `tests/indieauth-approve.test.ts`,
  `tests/indieauth-backup-codes.test.ts`, `tests/indieauth-dispatch.test.ts`.
- Modify `skills/indieweb/SKILL.md`, `scripts/pre-deploy-check.sh`,
  `docs/platforms/dwk-workers.md`; create `docs/decisions/0022-passkey-indieauth.md`.

---

### Task 1: `@dwk/webauthn` stub + DO binding + ceremonies reachable

**Files:**
- Create: `tests/__stubs__/dwk-webauthn.ts`
- Modify: `vitest.config.ts` (alias), `template/worker/site-entry.js`, `template/wrangler.jsonc`
- Test: `tests/indieauth-dispatch.test.ts`

**Interfaces:**
- Produces: `createWebAuthn(config) => (req,env,ctx)=>Response` and re-export
  `WebAuthnObject`; `webauthnFor(env)` memoized bundle `{ handler }`.

- [ ] **Step 1: Stub.** Create `tests/__stubs__/dwk-webauthn.ts`:

```ts
export const webauthnCalls = { fetch: 0 };
export function resetWebauthnCalls() { webauthnCalls.fetch = 0; }
export class WebAuthnObject {} // bound as a DO class; never instantiated in tests
export function createWebAuthn(_config?: unknown) {
  return (req: Request, _env: unknown, _ctx: unknown) => {
    webauthnCalls.fetch++;
    const path = new URL(req.url).pathname;
    return new Response("webauthn", {
      headers: { "x-handler": "webauthn", "x-webauthn-path": path },
    });
  };
}
```

- [ ] **Step 2: Alias.** In `vitest.config.ts` `alias`, add:
  `"@dwk/webauthn": resolve(__dirname, "tests/__stubs__/dwk-webauthn.ts"),`

- [ ] **Step 3: Failing test.** `tests/indieauth-dispatch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import worker from "../template/worker/site-entry.js";
const ctx = () => ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() });
const env = (o = {}) => ({ ASSETS: { fetch: vi.fn(async () => new Response("a")) }, SITE_URL: "https://example.com", ...o } as any);
const req = (p: string) => new Request(`https://example.com${p}`, { method: "POST" });

describe("WebAuthn ceremony dispatch", () => {
  it("routes /auth/webauthn/* to the WebAuthn handler when AUTH_DB is bound", async () => {
    const res = await worker.fetch(req("/auth/webauthn/authenticate/options"), env({ AUTH_DB: {}, WEBAUTHN: {} }), ctx());
    expect(res.headers.get("x-handler")).toBe("webauthn");
  });
  it("falls through /auth/webauthn/* to ASSETS when AUTH_DB absent", async () => {
    const e = env();
    await worker.fetch(req("/auth/webauthn/authenticate/options"), e, ctx());
    expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Run, expect FAIL** (`createWebAuthn` not imported): `npx vitest run tests/indieauth-dispatch.test.ts`

- [ ] **Step 5: Implement.** In `site-entry.js`: add `import { createWebAuthn, WebAuthnObject } from "@dwk/webauthn";` and `import { createIndieAuth } from "@dwk/indieauth";` (replace the `createHandler as createIndieAuth` line). Add a memoized bundle:

```js
const authByEnv = new WeakMap();
function authFor(env) {
  let b = authByEnv.get(env);
  if (!b) {
    const origin = env.SITE_URL;
    const rpId = origin ? new URL(origin).host : undefined;
    b = {
      webauthn: createWebAuthn({ rpId, rpName: rpId ?? "site", origin }),
    };
    authByEnv.set(env, b);
  }
  return b;
}
export { WebAuthnObject };
```

In the IndieWeb dispatch block, before the existing `/auth` route, add:

```js
if (env.AUTH_DB && p.startsWith("/auth/webauthn/"))
  return authFor(env).webauthn(request, env, ctx);
```

- [ ] **Step 6: Run, expect PASS.** Then `wrangler.jsonc`: add after `d1_databases`:

```jsonc
"durable_objects": {
  "bindings": [{ "name": "WEBAUTHN", "class_name": "WebAuthnObject" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["WebAuthnObject"] }],
```

- [ ] **Step 7: Commit** `feat(indieauth): mount @dwk/webauthn ceremonies + WEBAUTHN DO binding`.

---

### Task 2: Owner session cookie (`owner-auth.js`)

**Files:** Create `template/worker/owner-auth.js`; Test `tests/indieauth-session.test.ts`.

**Interfaces:**
- Produces: `issueOwnerSession(signingKeyHex, ttlSeconds?) => Promise<string>` (cookie value `payloadB64.sigHex`); `verifyOwnerSession(cookieValue, signingKeyHex) => Promise<{sub,exp}|null>`; `OWNER_COOKIE = "__anglesite_owner"`; `readCookie(header, name)`.

- [ ] **Step 1: Failing test** `tests/indieauth-session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { issueOwnerSession, verifyOwnerSession } from "../template/worker/owner-auth.js";
const KEY = "00112233445566778899aabbccddeeff";

describe("owner session cookie", () => {
  it("round-trips a valid session", async () => {
    const v = await issueOwnerSession(KEY, 900);
    const p = await verifyOwnerSession(v, KEY);
    expect(p?.sub).toBe("owner");
    expect(p?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
  it("rejects a tampered payload", async () => {
    const v = await issueOwnerSession(KEY, 900);
    const [, sig] = v.split(".");
    expect(await verifyOwnerSession("ZXZpbA." + sig, KEY)).toBeNull();
  });
  it("rejects an expired session", async () => {
    const v = await issueOwnerSession(KEY, -1);
    expect(await verifyOwnerSession(v, KEY)).toBeNull();
  });
  it("rejects under a different key", async () => {
    const v = await issueOwnerSession(KEY, 900);
    expect(await verifyOwnerSession(v, "ffffffffffffffffffffffffffffffff")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/indieauth-session.test.ts`

- [ ] **Step 3: Implement** `template/worker/owner-auth.js`. Mirror the membership HMAC helpers; `now` injectable via param default for the expiry test:

```js
export const OWNER_COOKIE = "__anglesite_owner";

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64urlEncode(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new Uint8Array([...bin].map((c) => c.charCodeAt(0)));
}
async function hmacKey(hex, usages) {
  return crypto.subtle.importKey("raw", hexToBytes(hex), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function issueOwnerSession(signingKeyHex, ttlSeconds = 900) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = new TextEncoder().encode(JSON.stringify({ sub: "owner", exp }));
  const key = await hmacKey(signingKeyHex, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, payload);
  return `${b64urlEncode(payload)}.${bytesToHex(sig)}`;
}

export async function verifyOwnerSession(value, signingKeyHex) {
  if (!value || !signingKeyHex) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = value.slice(0, dot);
  const sigHex = value.slice(dot + 1);
  if (!/^[0-9a-f]+$/i.test(sigHex)) return null;
  let payloadBytes;
  try { payloadBytes = b64urlDecode(payloadB64); } catch { return null; }
  const key = await hmacKey(signingKeyHex, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, hexToBytes(sigHex), payloadBytes);
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(payloadBytes)); } catch { return null; }
  if (payload?.sub !== "owner" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export function readCookie(cookieHeader, name) {
  for (const piece of (cookieHeader ?? "").split(";")) {
    const t = piece.trim();
    const eq = t.indexOf("=");
    if (eq > 0 && t.slice(0, eq) === name) return t.slice(eq + 1);
  }
  return null;
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(indieauth): owner session cookie helpers`.

---

### Task 3: Request-bound consent token

**Files:** Modify `template/worker/owner-auth.js`; Test `tests/indieauth-approve.test.ts` (consent-token block).

**Interfaces:**
- Produces: `mintConsentToken(keyHex, {clientId, redirectUri, scope}, ttlSeconds?) => Promise<string>`; `verifyConsentToken(token, keyHex, {clientId, redirectUri, scope}) => Promise<boolean>` — HMAC over a canonical `clientId|redirectUri|scope|exp` string; mismatch on any field or expiry ⇒ false.

- [ ] **Step 1: Failing test** (new file `tests/indieauth-approve.test.ts`, first describe):

```ts
import { describe, it, expect } from "vitest";
import { mintConsentToken, verifyConsentToken } from "../template/worker/owner-auth.js";
const KEY = "00112233445566778899aabbccddeeff";
const REQ = { clientId: "https://app.example", redirectUri: "https://app.example/cb", scope: "create" };

describe("consent token", () => {
  it("verifies a token bound to the same request", async () => {
    const t = await mintConsentToken(KEY, REQ, 300);
    expect(await verifyConsentToken(t, KEY, REQ)).toBe(true);
  });
  it("rejects when a bound field differs", async () => {
    const t = await mintConsentToken(KEY, REQ, 300);
    expect(await verifyConsentToken(t, KEY, { ...REQ, scope: "create media" })).toBe(false);
    expect(await verifyConsentToken(t, KEY, { ...REQ, redirectUri: "https://evil.example/cb" })).toBe(false);
  });
  it("rejects an expired token", async () => {
    const t = await mintConsentToken(KEY, REQ, -1);
    expect(await verifyConsentToken(t, KEY, REQ)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (append to `owner-auth.js`):

```js
function consentMessage({ clientId, redirectUri, scope }, exp) {
  return new TextEncoder().encode(
    [clientId, redirectUri, scope ?? "", exp].join("|"),
  );
}
export async function mintConsentToken(keyHex, req, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const key = await hmacKey(keyHex, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, consentMessage(req, exp));
  return `${exp}.${bytesToHex(sig)}`;
}
export async function verifyConsentToken(token, keyHex, req) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  const sigHex = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  if (!/^[0-9a-f]+$/i.test(sigHex)) return false;
  const key = await hmacKey(keyHex, ["verify"]);
  return crypto.subtle.verify("HMAC", key, hexToBytes(sigHex), consentMessage(req, exp));
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(indieauth): request-bound consent token`.

---

### Task 4: Backup codes (`OWNER_AUTH_DB`)

**Files:** Modify `template/worker/owner-auth.js`; Test `tests/indieauth-backup-codes.test.ts`.

**Interfaces:**
- Produces: `generateBackupCodes(db, n?) => Promise<string[]>` (returns plaintext once, stores SHA-256 hashes); `redeemBackupCode(db, code) => Promise<boolean>` (single-use; constant-time host compare via hash equality). `db` is a D1 binding; the helper issues `CREATE TABLE IF NOT EXISTS owner_backup_codes (...)`.

- [ ] **Step 1: Failing test** with an in-memory fake D1 (`prepare/bind/run/first/all`):

```ts
import { describe, it, expect } from "vitest";
import { generateBackupCodes, redeemBackupCode } from "../template/worker/owner-auth.js";

function fakeD1() {
  const rows: any[] = [];
  const db = {
    prepare(sql: string) {
      return {
        _sql: sql, _args: [] as any[],
        bind(...a: any[]) { this._args = a; return this; },
        async run() {
          if (/INSERT/.test(sql)) rows.push({ code_hash: this._args[0], used_at: null });
          if (/UPDATE/.test(sql)) { const r = rows.find((x) => x.code_hash === this._args[0] && !x.used_at); if (r) r.used_at = 1; }
          return { success: true };
        },
        async first() {
          if (/SELECT/.test(sql)) return rows.find((x) => x.code_hash === this._args[0] && !x.used_at) ?? null;
          return null;
        },
        async all() { return { results: rows }; },
      };
    },
  };
  return db as any;
}

describe("backup codes", () => {
  it("generates N codes and redeems each once", async () => {
    const db = fakeD1();
    const codes = await generateBackupCodes(db, 10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(await redeemBackupCode(db, codes[0])).toBe(true);
    expect(await redeemBackupCode(db, codes[0])).toBe(false); // single-use
    expect(await redeemBackupCode(db, "not-a-real-code")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (append to `owner-auth.js`):

```js
async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(d);
}
function randomCode() {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  // Crockford-ish base32, grouped: xxxxx-xxxxx
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const s = [...b].map((x) => A[x % 32]).join("");
  return `${s.slice(0, 5)}-${s.slice(5, 10)}`;
}
async function ensureBackupTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS owner_backup_codes (code_hash TEXT PRIMARY KEY, created_at INTEGER, used_at INTEGER)`,
  ).run();
}
export async function generateBackupCodes(db, n = 10) {
  await ensureBackupTable(db);
  const codes = [];
  for (let i = 0; i < n; i++) {
    const code = randomCode();
    codes.push(code);
    await db.prepare(
      `INSERT INTO owner_backup_codes (code_hash, created_at, used_at) VALUES (?1, ?2, NULL)`,
    ).bind(await sha256Hex(code), Math.floor(Date.now() / 1000)).run();
  }
  return codes;
}
export async function redeemBackupCode(db, code) {
  if (!code) return false;
  const hash = await sha256Hex(String(code).trim().toUpperCase());
  const row = await db.prepare(
    `SELECT code_hash FROM owner_backup_codes WHERE code_hash = ?1 AND used_at IS NULL`,
  ).bind(hash).first();
  if (!row) return false;
  await db.prepare(
    `UPDATE owner_backup_codes SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL`,
  ).bind(hash, Math.floor(Date.now() / 1000)).run();
  return true;
}
```

(Note: `generateBackupCodes` must uppercase before hashing to match `redeemBackupCode`; codes are emitted uppercase already.)

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(indieauth): single-use backup codes in OWNER_AUTH_DB`.

---

### Task 5: `approveAuthorization` + consent dispatch

**Files:** Modify `template/worker/site-entry.js`; create `template/worker/auth-pages.js`; Test `tests/indieauth-approve.test.ts` (second describe).

**Interfaces:**
- Consumes: `verifyOwnerSession`, `verifyConsentToken`, `OWNER_COOKIE`, `readCookie` (Task 2/3); `renderConsentPage({request})` (new).
- Produces: `makeApproveAuthorization(env)` returning the `ApproveAuthorization` hook; dispatch for `POST /auth/consent`.

- [ ] **Step 1: Failing test** (`tests/indieauth-approve.test.ts`, append). Drive `worker.fetch` against `/auth` with the indieauth stub configured so the stub *calls* `config.approveAuthorization` and surfaces its result (see Task 7 stub). Assert: no session ⇒ response body is the consent page (status 200, contains `id="passkey-signin"`); valid session cookie + valid `_consent` ⇒ stub reports an `AuthorizationApproval` with `me === env.SITE_URL`.

```ts
// (uses helpers from Task 7's dwk-indieauth stub: it echoes the approval as JSON
// on header x-approval, or returns the Response verbatim)
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `auth-pages.js` → `renderConsentPage({ request, authenticated })` returns an HTML string with: a `<button id="passkey-signin">`, inline JS that POSTs to `/auth/webauthn/authenticate/options`, calls `navigator.credentials.get`, POSTs the assertion to `/auth/consent` along with the original query string, and a "Use a backup code" `<form>` posting to `/auth/consent`. In `site-entry.js`:

```js
import { OWNER_COOKIE, readCookie, verifyOwnerSession, verifyConsentToken } from "./owner-auth.js";
import { renderConsentPage } from "./auth-pages.js";

function makeApproveAuthorization(env) {
  return async (authReq, httpRequest) => {
    const sessionKey = env.INDIEAUTH_SESSION_KEY;
    const cookie = readCookie(httpRequest.headers.get("Cookie") ?? "", OWNER_COOKIE);
    const session = await verifyOwnerSession(cookie, sessionKey);
    const url = new URL(httpRequest.url);
    const consent = url.searchParams.get("_consent");
    const bound = { clientId: authReq.clientId, redirectUri: authReq.redirectUri, scope: authReq.scope };
    if (session && consent && (await verifyConsentToken(consent, sessionKey, bound))) {
      return { me: env.SITE_URL, scopes: authReq.scopes, profile: { url: env.SITE_URL } };
    }
    return new Response(renderConsentPage({ request: httpRequest, authenticated: !!session }), {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}
```

Wire the indieauth handler in `authFor(env)`: `indieauth: createIndieAuth({ baseUrl: env.SITE_URL, approveAuthorization: makeApproveAuthorization(env) })`. (The `/auth/consent` POST handler is Task 6.)

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(indieauth): approveAuthorization consent gate`.

---

### Task 6: `/auth/consent` POST — passkey/backup → session + consent token

**Files:** Modify `template/worker/site-entry.js`; Test `tests/indieauth-approve.test.ts` (consent endpoint block).

**Interfaces:**
- Consumes: `authFor(env).webauthn` (verify assertion), `issueOwnerSession`, `mintConsentToken`, `redeemBackupCode`.
- Produces: dispatch `POST /auth/consent` → on a verified passkey assertion *or* a redeemed backup code, set `Set-Cookie: __anglesite_owner=...` and 302 to `/auth?<original>&_consent=<token>`.

- [ ] **Step 1: Failing test:** POST `/auth/consent` with a body flagged `{ backupCode }` against a fake `OWNER_AUTH_DB` containing that code ⇒ 302, `Location` carries `_consent=`, and a `__anglesite_owner` Set-Cookie. A bad backup code ⇒ 401, no cookie.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `POST /auth/consent` in `site-entry.js`: parse the form/JSON body; if `backupCode` present, `redeemBackupCode(env.OWNER_AUTH_DB, code)`; else forward the assertion to `authFor(env).webauthn` (`/authenticate/verify`) and require a 200. On success: `issueOwnerSession`, `mintConsentToken` over the original `client_id/redirect_uri/scope`, build the `Location` back to `/auth` with the original params plus `_consent`, return 302 with the Set-Cookie. On failure: 401.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(indieauth): /auth/consent passkey + backup-code redemption`.

---

### Task 7: Rewrite `dwk-indieauth` stub + full `/auth` dispatch

**Files:** Rewrite `tests/__stubs__/dwk-indieauth.ts`; Modify `template/worker/site-entry.js` (dispatch order); Test: existing `tests/indieweb-dispatch.test.ts` updates.

**Interfaces:**
- Produces stub `createIndieAuth(config) => handler`. The handler, on `GET /auth`, calls `config.approveAuthorization(parsedReq, request)` and: if it returns a `Response`, returns it; if it returns an approval object, returns `new Response(JSON.stringify(approval), { headers: { "x-handler": "indieauth", "x-approval": "1" } })`. This lets tests observe both arms.

- [ ] **Step 1:** Rewrite the stub to `createIndieAuth` with the approval-surfacing behavior above; parse `client_id`,`redirect_uri`,`state`,`scope`,`code_challenge` from the query into the `AuthorizationRequest` shape (`clientId`,`redirectUri`,`scope`,`scopes`).
- [ ] **Step 2:** Update `tests/indieweb-dispatch.test.ts`: the IndieAuth dispatch test now expects `x-handler: indieauth` for `/auth` only when `AUTH_DB` bound, and `/auth/webauthn/*` / `/auth/consent` are handled before the generic `/auth` route. Run, expect FAIL where the old `createHandler` import is referenced.
- [ ] **Step 3:** In `site-entry.js` ensure dispatch order: `/auth/webauthn/*` → `/auth/consent` → `/auth` (generic). Implement.
- [ ] **Step 4:** Run the full IndieWeb suite, expect PASS.
- [ ] **Step 5: Commit** `feat(indieauth): wire createIndieAuth with real API + dispatch order`.

---

### Task 8: Registration gating + `/auth/register` page

**Files:** Modify `template/worker/site-entry.js`, `template/worker/auth-pages.js`; Test `tests/indieauth-dispatch.test.ts` (registration block).

**Interfaces:**
- Consumes: `verifyOwnerSession`, `env.INDIEWEB_REG_TOKEN`.
- Produces: gate on `/auth/webauthn/register/*` (403 unless `?token=` matches `INDIEWEB_REG_TOKEN` **or** a valid owner session); `GET /auth/register` → `renderRegisterPage()`.

- [ ] **Step 1: Failing tests:** `/auth/webauthn/register/options` with no token and no session ⇒ 403; with `?token=<INDIEWEB_REG_TOKEN>` ⇒ reaches the webauthn handler (`x-handler: webauthn`); with a valid owner session cookie ⇒ reaches it too.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the gate in `site-entry.js` immediately before the `/auth/webauthn/` route: for paths starting `/auth/webauthn/register/`, require token-or-session else `return new Response("Forbidden", { status: 403 })`. Add `GET /auth/register` → `renderRegisterPage()` (HTML driving `/auth/webauthn/register/*`, carrying the `token` param into its fetches).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(indieauth): owner-only passkey registration gating + page`.

---

### Task 9: Skill, wrangler secrets, deploy-scan, docs, ADR

**Files:** Modify `skills/indieweb/SKILL.md`, `template/wrangler.jsonc`, `scripts/pre-deploy-check.sh`, `docs/platforms/dwk-workers.md`; Create `docs/decisions/0022-passkey-indieauth.md`; Test `tests/pre-deploy-scan.test.ts` (new secret-name cases).

- [ ] **Step 1:** SKILL Step 3: provision `OWNER_AUTH_DB` (D1) + the `WEBAUTHN` DO (no resource to create — it's code-defined; just the wrangler binding/migration) + generate `INDIEAUTH_SESSION_KEY` (`openssl rand -hex 32`) and `INDIEWEB_REG_TOKEN` as wrangler secrets; show the owner the one-time `/auth/register?token=…` link and the 10 backup codes once. Document `--reset-auth`.
- [ ] **Step 2:** `wrangler.jsonc`: add the `OWNER_AUTH_DB` D1 binding (empty id, skill-filled). DO binding + migrations already added in Task 1.
- [ ] **Step 3:** `pre-deploy-check.sh`: add `INDIEAUTH_SESSION_KEY` and `INDIEWEB_REG_TOKEN` to the secret-scan patterns (must be secret bindings, never committed). Add a failing test in `tests/pre-deploy-scan.test.ts` (a committed `INDIEAUTH_SESSION_KEY=...` value trips the scan), run FAIL, implement, run PASS.
- [ ] **Step 4:** `docs/platforms/dwk-workers.md`: add the `WEBAUTHN` DO, `OWNER_AUTH_DB`, `INDIEAUTH_SESSION_KEY`, `INDIEWEB_REG_TOKEN` rows + a short "passkey owner-auth flow" subsection. Create `docs/decisions/0022-passkey-indieauth.md` (terse ADR pointing at this spec/plan).
- [ ] **Step 5:** Run the full suite (`npm test`); commit `feat(indieweb): provision passkey IndieAuth (skill, secrets, deploy-scan, docs, ADR-0022)`.

---

## Self-Review

- **Spec coverage:** approveAuthorization (T5), consent token (T3), session (T2),
  registration gating + bootstrap token (T8), backup codes (T4), DO binding +
  migrations (T1), createIndieAuth wiring (T7), skill/secrets/deploy-scan/docs/ADR
  (T9), recovery `--reset-auth` (T9). Backup-code recovery + ≥2 passkeys: T4 + T8
  page copy. All spec sections map to a task.
- **Out of scope (correctly absent):** Micropub realignment (#2c).
- **Type consistency:** `authFor(env)` exposes `{ webauthn, indieauth }`;
  `owner-auth.js` exports `OWNER_COOKIE`, `readCookie`, `issueOwnerSession`,
  `verifyOwnerSession`, `mintConsentToken`, `verifyConsentToken`,
  `generateBackupCodes`, `redeemBackupCode` — names used identically in T5/T6/T8.
- **Note for executor:** `@dwk/*` packages don't load in plain Node until
  `beta.3` is published; tests rely on the vitest stubs, so the suite is green
  regardless. A real deploy bundles via wrangler/esbuild.
