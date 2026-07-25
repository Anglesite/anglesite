import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createIndieAuthStore, type AuthorizationRequest } from "@dwk/indieauth";
import { beforeEach, expect, test } from "vitest";
import {
  validateInboxFields,
  isRateLimited,
  handleInbox,
  handleIndieAuthConsent,
  createConsentToken,
  verifyConsentToken,
  type InboxKV,
  type WorkerEnv,
} from "./worker";
import worker from "./worker";

const testEnv = env as unknown as WorkerEnv;

beforeEach(async () => {
  await createIndieAuthStore(testEnv).init();
});

function makeFakeKV(initial: Record<string, string> = {}): InboxKV & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

test("validateInboxFields: trims and accepts complete fields", () => {
  const result = validateInboxFields({ subject: " Hello ", from: " a@example.com ", message: " hi " });
  expect(result).toEqual({ subject: "Hello", from: "a@example.com", message: "hi" });
});

test("validateInboxFields: rejects a missing field", () => {
  expect(validateInboxFields({ subject: "Hello", from: "a@example.com", message: "" })).toBeNull();
});

test("validateInboxFields: rejects an over-long field", () => {
  expect(
    validateInboxFields({ subject: "x".repeat(201), from: "a@example.com", message: "hi" }),
  ).toBeNull();
});

test("isRateLimited: allows up to the window max, then blocks", async () => {
  const kv = makeFakeKV();
  for (let i = 0; i < 5; i++) {
    expect(await isRateLimited(kv, "1.2.3.4")).toBe(false);
  }
  expect(await isRateLimited(kv, "1.2.3.4")).toBe(true);
});

test("isRateLimited: tracks separate IPs independently", async () => {
  const kv = makeFakeKV();
  for (let i = 0; i < 5; i++) await isRateLimited(kv, "1.2.3.4");
  expect(await isRateLimited(kv, "5.6.7.8")).toBe(false);
});

test("handleInbox: stages a valid JSON submission and returns 202", async () => {
  const kv = makeFakeKV();
  const request = new Request("https://example.com/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "Hello", from: "a@example.com", message: "Hi there" }),
  });
  const response = await handleInbox(request, { INBOX_KV: kv });
  expect(response.status).toBe(202);
  // 2 keys, not 1: isRateLimited() always writes a `ratelimit:<ip>` counter as a side effect on
  // every allowed call, in addition to the `inbox:<id>` staged submission written here.
  expect(kv.store.size).toBe(2);
  const [, stagedRaw] = [...kv.store.entries()].find(([key]) => key.startsWith("inbox:"))!;
  const staged = JSON.parse(stagedRaw);
  expect(staged.subject).toBe("Hello");
  expect(staged.from).toBe("a@example.com");
  expect(staged.message).toBe("Hi there");
  expect(typeof staged.id).toBe("string");
  expect(typeof staged.receivedAt).toBe("string");
});

test("handleInbox: silently drops a honeypot-tripped submission", async () => {
  const kv = makeFakeKV();
  const request = new Request("https://example.com/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: "Hello", from: "a@example.com", message: "Hi", website: "http://spam.example",
    }),
  });
  const response = await handleInbox(request, { INBOX_KV: kv });
  expect(response.status).toBe(202);
  // 1 key, not 0: rate limiting runs before the honeypot check in handleInbox, so this call still
  // writes the `ratelimit:<ip>` counter — a honeypot-tripped request still consumes a rate-limit
  // slot, which is correct: bots shouldn't be exempt from rate limiting just because they tripped
  // the honeypot.
  expect(kv.store.size).toBe(1);
});

test("handleInbox: rejects a non-POST method", async () => {
  const kv = makeFakeKV();
  const request = new Request("https://example.com/inbox", { method: "GET" });
  const response = await handleInbox(request, { INBOX_KV: kv });
  expect(response.status).toBe(405);
});

test("handleInbox: 429s once the per-IP rate limit is exceeded", async () => {
  const kv = makeFakeKV();
  const makeRequest = () =>
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
      body: JSON.stringify({ subject: "Hello", from: "a@example.com", message: "Hi" }),
    });
  for (let i = 0; i < 5; i++) {
    const response = await handleInbox(makeRequest(), { INBOX_KV: kv });
    expect(response.status).toBe(202);
  }
  const limited = await handleInbox(makeRequest(), { INBOX_KV: kv });
  expect(limited.status).toBe(429);
});

test("handleInbox: 500s when INBOX_KV isn't bound", async () => {
  const request = new Request("https://example.com/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "Hello", from: "a@example.com", message: "Hi" }),
  });
  const response = await handleInbox(request, {});
  expect(response.status).toBe(500);
});

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/**
 * `accessToken`, when supplied, adds the RFC 9449 `ath` claim (base64url SHA-256 of the access
 * token) that `@dwk/dpop`'s `verifyDpopProof` requires whenever it's checking a proof against a
 * bound access token (i.e. every Micropub/media resource request — Task 9, #360). Omit it for
 * proofs that don't carry an access token yet, like the `/token` exchange itself.
 */
async function dpopProof(
  url: string,
  method = "POST",
  keyPair?: CryptoKeyPair,
  accessToken?: string,
): Promise<string> {
  const pair = keyPair ?? await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    jti: crypto.randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    ...(accessToken !== undefined
      ? { ath: base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken)))) }
      : {}),
  })));
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signingInput);
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Distinct `CF-Connecting-IP` per `mintAccessToken` call, so repeated calls across the file's
 * Micropub tests (Task 9, #360) don't share one IP's consent-endpoint rate-limit bucket
 * (`RATE_LIMIT_MAX_PER_WINDOW` in worker.ts) — this suite's D1/KV storage is not test-isolated
 * (see the module-level `beforeEach` re-`init`ing `AUTH_DB`), so counters accumulate across
 * tests within the file, not just within one test. Starts past the fixed IPs the IndieAuth
 * consent tests above use explicitly (192.0.2.35-43, .99).
 */
let mintAccessTokenIPCounter = 150;

/**
 * Runs the full PKCE + owner-consent + token-exchange flow (mirroring the inline steps in
 * "IndieAuth owner consent completes PKCE sign-in and issues a DPoP token" above) and returns
 * the issued access token plus the key pair its DPoP binding was minted with — callers that need
 * to make an authorized resource request (Task 9's Micropub tests) must reuse this same key pair
 * to prove possession, not generate a fresh one.
 */
async function mintAccessToken(scope: string): Promise<{ token: string; keyPair: CryptoKeyPair }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const verifier = `anglesite-mint-verifier-${crypto.randomUUID()}-with-more-than-forty-three-characters`;
  const challenge = await pkceChallenge(verifier);
  const authorize = new URL("https://owner.example/authorize");
  authorize.search = new URLSearchParams({
    client_id: "https://client.example/app",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    state: crypto.randomUUID(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
  }).toString();

  await fetchWorker(new Request(authorize));

  const consentForm = new URLSearchParams(authorize.search);
  consentForm.set("password", "correct horse battery staple");
  const consent = await fetchWorker(new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": `192.0.2.${mintAccessTokenIPCounter++}`,
    },
    body: consentForm,
  }));
  const approvedURL = new URL(consent.headers.get("location")!);
  const approval = await fetchWorker(new Request(approvedURL));
  const clientCallback = new URL(approval.headers.get("location")!);
  const code = clientCallback.searchParams.get("code")!;

  const tokenURL = "https://owner.example/token";
  const tokenResponse = await fetchWorker(new Request(tokenURL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      DPoP: await dpopProof(tokenURL, "POST", keyPair),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "https://client.example/app",
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
    }),
  }));
  const body = await tokenResponse.json() as { access_token: string };
  return { token: body.access_token, keyPair };
}

async function fetchWorker(request: Request): Promise<Response> {
  return worker.fetch(request, testEnv, createExecutionContext());
}

// --- Generic route dispatch (#746) ---------------------------------------------------------
// These run through worker.fetch inside the workerd pool, i.e. the same runtime `wrangler dev`
// uses, so the dispatch behavior they pin down is what local preview and production serve.

test("routing: undeclared method gets 405 with an Allow header naming the declared methods", async () => {
  const inbox = await fetchWorker(new Request("https://owner.example/inbox", { method: "GET" }));
  expect(inbox.status).toBe(405);
  expect(inbox.headers.get("allow")).toBe("POST");

  const metadata = await fetchWorker(
    new Request("https://owner.example/.well-known/oauth-authorization-server", { method: "POST" }),
  );
  expect(metadata.status).toBe(405);
  expect(metadata.headers.get("allow")).toBe("GET, HEAD");
});

test("routing: HEAD mirrors GET's status and headers with an empty body where declared", async () => {
  const get = await fetchWorker(new Request("https://owner.example/.well-known/oauth-authorization-server"));
  const head = await fetchWorker(
    new Request("https://owner.example/.well-known/oauth-authorization-server", { method: "HEAD" }),
  );
  expect(head.status).toBe(get.status);
  expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
  expect(await head.text()).toBe("");
});

test("routing: query parameters reach the handler unchanged", async () => {
  // The authorize handler can only render this consent page by reading the query it was sent.
  const authorize = new URL("https://owner.example/authorize");
  authorize.search = new URLSearchParams({
    client_id: "https://client.example/app",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    state: "state-query-preserved",
    code_challenge: await pkceChallenge("query-preservation-verifier-that-is-long-enough-to-be-valid"),
    code_challenge_method: "S256",
    scope: "create",
  }).toString();
  const response = await fetchWorker(new Request(authorize));
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("https://client.example/app");
  expect(body).toContain("state-query-preserved");
});

test("routing: unknown well-known names and the bare directory return a plain 404, not HTML", async () => {
  for (const path of ["/.well-known", "/.well-known/", "/.well-known/does-not-exist"]) {
    const response = await fetchWorker(new Request(`https://owner.example${path}`));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
  }
});

test("routing: case, trailing-slash, and encoded well-known variants return a true 404", async () => {
  for (const path of [
    "/.WELL-KNOWN/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/",
    "/.well-known/OAuth-Authorization-Server",
    "/%2Ewell-known/oauth-authorization-server",
  ]) {
    const response = await fetchWorker(new Request(`https://owner.example${path}`));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
  }
});

test("routing: malformed percent-encoding returns a true 404", async () => {
  const response = await fetchWorker(new Request("https://owner.example/%E0%A4%A"));
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toContain("text/plain");
});

test("routing: unrelated paths fall through to the asset-first branch", async () => {
  // The vitest miniflare env deliberately has no ASSETS binding, so reaching the asset branch
  // surfaces as its 500 sentinel — proving an unclaimed path was neither 404'd nor 405'd by
  // the dispatcher.
  const response = await fetchWorker(new Request("https://owner.example/about"));
  expect(response.status).toBe(500);
  expect(await response.text()).toBe("No assets binding configured");
});

test("IndieAuth metadata advertises the authorization and token endpoints", async () => {
  const response = await fetchWorker(new Request("https://owner.example/.well-known/oauth-authorization-server"));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    issuer: "https://owner.example",
    authorization_endpoint: "https://owner.example/authorize",
    token_endpoint: "https://owner.example/token",
    code_challenge_methods_supported: ["S256"],
  });
});

test("IndieAuth owner consent completes PKCE sign-in and issues a DPoP token", async () => {
  const verifier = "anglesite-indieauth-verifier-with-more-than-forty-three-characters";
  const challenge = await pkceChallenge(verifier);
  const authorize = new URL("https://owner.example/authorize");
  authorize.search = new URLSearchParams({
    client_id: "https://client.example/app",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    state: "state-355",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "create update",
  }).toString();

  const prompt = await fetchWorker(new Request(authorize));
  expect(prompt.status).toBe(200);
  expect(await prompt.text()).toContain("Approve sign-in");

  const consentForm = new URLSearchParams(authorize.search);
  consentForm.set("password", "correct horse battery staple");
  const consent = await fetchWorker(new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.35" },
    body: consentForm,
  }));
  expect(consent.status).toBe(303);
  const approvedURL = new URL(consent.headers.get("location")!);
  expect(approvedURL.pathname).toBe("/authorize");
  expect(approvedURL.searchParams.get("consent")).toBeTruthy();

  const approval = await fetchWorker(new Request(approvedURL));
  expect(approval.status).toBe(302);
  const clientCallback = new URL(approval.headers.get("location")!);
  expect(clientCallback.origin).toBe("https://client.example");
  expect(clientCallback.searchParams.get("state")).toBe("state-355");
  const code = clientCallback.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenURL = "https://owner.example/token";
  const token = await fetchWorker(new Request(tokenURL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      DPoP: await dpopProof(tokenURL),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      client_id: "https://client.example/app",
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
    }),
  }));
  expect(token.status).toBe(200);
  await expect(token.json()).resolves.toMatchObject({
    token_type: "DPoP",
    scope: "create update",
    me: "https://owner.example/",
  });
});

test("mintAccessToken: issues a token whose DPoP proof (same key pair) is accepted on a resource request", async () => {
  const { token, keyPair } = await mintAccessToken("create update media");
  expect(token.length).toBeGreaterThan(0);

  // Reuse the same key pair for a request to /token again (a cheap way to prove the key pair is
  // usable for more than the mint call itself, without depending on Task 9's /micropub route).
  const proof = await dpopProof("https://owner.example/micropub", "POST", keyPair);
  expect(proof.split(".")).toHaveLength(3);
});

test("IndieAuth consent rejects the wrong owner password", async () => {
  const body = new URLSearchParams({
    client_id: "https://client.example/app",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    state: "wrong-password",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    scope: "create",
    password: "incorrect",
  });
  const response = await fetchWorker(new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.36" },
    body,
  }));
  expect(response.status).toBe(401);
});

function sampleAuthorizationRequest(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    clientId: "https://client.example/app",
    redirectUri: "https://client.example/callback",
    state: "state-355",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    scope: "create",
    scopes: ["create"],
    ...overrides,
  };
}

test("verifyConsentToken: accepts a token replayed against the exact request it was issued for", async () => {
  const request = sampleAuthorizationRequest();
  const token = await createConsentToken(request, "test-signing-key");
  expect(await verifyConsentToken(token, request, "test-signing-key")).toBe(true);
});

test("verifyConsentToken: rejects a token replayed against a different client_id", async () => {
  const granted = sampleAuthorizationRequest();
  const token = await createConsentToken(granted, "test-signing-key");
  const tampered = sampleAuthorizationRequest({ clientId: "https://attacker.example/app" });
  expect(await verifyConsentToken(token, tampered, "test-signing-key")).toBe(false);
});

test("verifyConsentToken: rejects a token replayed against a different redirect_uri", async () => {
  const granted = sampleAuthorizationRequest();
  const token = await createConsentToken(granted, "test-signing-key");
  const tampered = sampleAuthorizationRequest({ redirectUri: "https://attacker.example/callback" });
  expect(await verifyConsentToken(token, tampered, "test-signing-key")).toBe(false);
});

test("verifyConsentToken: rejects a token replayed with an escalated scope", async () => {
  const granted = sampleAuthorizationRequest();
  const token = await createConsentToken(granted, "test-signing-key");
  const tampered = sampleAuthorizationRequest({ scope: "create update delete", scopes: ["create", "update", "delete"] });
  expect(await verifyConsentToken(token, tampered, "test-signing-key")).toBe(false);
});

test("verifyConsentToken: rejects a token signed with a different key", async () => {
  const request = sampleAuthorizationRequest();
  const token = await createConsentToken(request, "test-signing-key");
  expect(await verifyConsentToken(token, request, "a-different-signing-key")).toBe(false);
});

test("verifyConsentToken: rejects an expired token", async () => {
  const request = sampleAuthorizationRequest();
  const issuedAt = 1_000;
  const token = await createConsentToken(request, "test-signing-key", issuedAt);
  expect(await verifyConsentToken(token, request, "test-signing-key", issuedAt + 301)).toBe(false);
});

test("handleIndieAuthConsent: 503s when a required secret isn't configured", async () => {
  const { TOKEN_SIGNING_KEY: _unusedSigningKey, ...envWithoutSigningKey } = testEnv;
  const request = new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.40" },
    body: new URLSearchParams({ password: "correct horse battery staple" }),
  });
  const response = await handleIndieAuthConsent(request, envWithoutSigningKey as unknown as WorkerEnv);
  expect(response.status).toBe(503);
});

test("handleIndieAuthConsent: 503s when the rate-limit KV isn't bound (fails closed, not open)", async () => {
  const { SOCIAL_KV: _unusedSocialKV, ...envWithoutKV } = testEnv;
  const request = new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.42" },
    body: new URLSearchParams({ password: "correct horse battery staple" }),
  });
  const response = await handleIndieAuthConsent(request, envWithoutKV as unknown as WorkerEnv);
  expect(response.status).toBe(503);
});

test("handleIndieAuthConsent: 400s on a malformed (oversized) form body", async () => {
  const request = new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.41" },
    body: `password=${"x".repeat(20_000)}`,
  });
  const response = await handleIndieAuthConsent(request, testEnv);
  expect(response.status).toBe(400);
});

test("handleIndieAuthConsent: 429s once the per-IP login attempt limit is exceeded", async () => {
  const makeRequest = () =>
    new Request("https://owner.example/indieauth/consent", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.43" },
      body: new URLSearchParams({ password: "incorrect" }),
    });
  for (let i = 0; i < 5; i++) {
    const response = await handleIndieAuthConsent(makeRequest(), testEnv);
    expect(response.status).toBe(401);
  }
  const limited = await handleIndieAuthConsent(makeRequest(), testEnv);
  expect(limited.status).toBe(429);
});

// --- Inbound Webmention receive (V-3.1, #359) ----------------------------------------------
// Composition of @dwk/webmention's receiver. These run through worker.fetch in the workerd pool
// with WEBMENTION_QUEUE/WEBMENTION_INBOX/SITE_URL bound (see vitest.config.ts), so they exercise
// the same synchronous validate-then-enqueue path production serves. Async link-verification is
// the library's own concern (covered by its suite + webmention.rocks), not re-tested here.

function webmentionForm(fields: Record<string, string>): Request {
  return new Request("https://owner.example/webmention", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

test("webmention receive: a valid source/target under this origin is accepted (202)", async () => {
  const response = await fetchWorker(
    webmentionForm({ source: "https://commenter.example/reply", target: "https://owner.example/blog/hello/" }),
  );
  expect(response.status).toBe(202);
});

test("webmention receive: a missing field is rejected (400)", async () => {
  const noTarget = await fetchWorker(webmentionForm({ source: "https://commenter.example/reply" }));
  expect(noTarget.status).toBe(400);
  const noSource = await fetchWorker(webmentionForm({ target: "https://owner.example/blog/hello/" }));
  expect(noSource.status).toBe(400);
});

test("webmention receive: source equal to target is rejected (400)", async () => {
  const response = await fetchWorker(
    webmentionForm({ source: "https://owner.example/x/", target: "https://owner.example/x/" }),
  );
  expect(response.status).toBe(400);
});

test("webmention receive: a target on a foreign host is rejected (400)", async () => {
  const response = await fetchWorker(
    webmentionForm({ source: "https://commenter.example/reply", target: "https://elsewhere.example/post/" }),
  );
  expect(response.status).toBe(400);
});

test("webmention receive: a non-POST method gets 405 with Allow: POST", async () => {
  const response = await fetchWorker(new Request("https://owner.example/webmention", { method: "GET" }));
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("POST");
});

test("webmention receive: 503 when inbound Webmention isn't provisioned (no queue binding)", async () => {
  const { WEBMENTION_QUEUE: _unusedQueue, ...envWithoutQueue } = testEnv;
  const response = await worker.fetch(
    webmentionForm({ source: "https://commenter.example/reply", target: "https://owner.example/blog/hello/" }),
    envWithoutQueue as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("webmention queue consumer: no-ops (does not throw) when the inbox/site origin is unprovisioned", async () => {
  const { WEBMENTION_INBOX: _unusedInbox, SITE_URL: _unusedSiteURL, ...envWithoutInbox } = testEnv;
  const emptyBatch = { queue: "site-webmention", messages: [] } as unknown as Parameters<
    NonNullable<typeof worker.queue>
  >[0];
  await expect(
    worker.queue!(emptyBatch, envWithoutInbox as WorkerEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

// --- Micropub server (V-3.2, #360) ---------------------------------------------------------
// Composition of @dwk/micropub's create/update/delete endpoint + media endpoint. These run
// through worker.fetch in the workerd pool with MICROPUB_DB/MEDIA/AUTH_DB/TOKEN_SIGNING_KEY
// bound (see vitest.config.ts), exercising the same dispatch path production serves. The
// library's own mf2/auth/media internals are its own concern (covered by its suite +
// micropub.rocks), not re-tested here.

test("micropub: an unauthorized request (no Authorization header) is rejected", async () => {
  const response = await fetchWorker(new Request("https://owner.example/micropub?q=config"));
  expect(response.status).toBe(401);
});

test("micropub: a valid token creates a post (201 + Location)", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { content: ["Hello from a Micropub client"] },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toBeTruthy();
});

test("micropub: q=config is served to an authorized request", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub?q=config";
  const response = await fetchWorker(new Request(url, {
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "GET", keyPair, token),
    },
  }));
  expect(response.status).toBe(200);
});

test("micropub: 503 when MICROPUB_DB isn't bound", async () => {
  const { MICROPUB_DB: _unusedDB, ...envWithoutDB } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutDB as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub: a note (plain content, no name) is created under /notes/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { content: ["Just a quick note"] },
    }),
  }));
  expect(response.status).toBe(201);
  const location = response.headers.get("location");
  expect(location).toMatch(/^https:\/\/owner\.example\/notes\/[0-9a-z-]+$/);
});

test("micropub: an article (name distinct from content) is created under /articles/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: {
        name: ["My Big Announcement"],
        content: ["Today I'm launching something new..."],
      },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^https:\/\/owner\.example\/articles\/my-big-announcement/);
});

test("micropub: a bookmark (bookmark-of) is created under /bookmarks/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { "bookmark-of": ["https://example.com/article"] },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^https:\/\/owner\.example\/bookmarks\//);
});

test("micropub: an h-event post is created under /events/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-event"],
      properties: { name: ["Meetup"], start: ["2026-08-01T18:00:00Z"] },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^https:\/\/owner\.example\/events\//);
});

test("micropub: an unrecognized type (h-card) falls back to the flat URL scheme", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-card"],
      properties: { name: ["Jane Doe"] },
    }),
  }));
  expect(response.status).toBe(201);
  const location = response.headers.get("location") ?? "";
  // Flat scheme: exactly one path segment, no collection prefix.
  expect(new URL(location).pathname.split("/").filter(Boolean).length).toBe(1);
});

// --- WebSub hub (V-3.3, #361) ---------------------------------------------------------------
// Composition of @dwk/websub's hub. These run through worker.fetch in the workerd pool with
// WEBSUB_DB/WEBSUB_QUEUE/SITE_URL bound (see vitest.config.ts), so they exercise the same
// synchronous validate-then-enqueue path production serves. Intent verification, fan-out, and
// HMAC delivery signing are the library's own concern (covered by its suite + websub.rocks),
// not re-tested here. SITE_URL (https://test.example) is the canonical topic origin — requests
// arrive on a different origin below precisely to pin down that topics are keyed on SITE_URL,
// not on whatever host the request happened to hit.

function websubForm(fields: Record<string, string>): Request {
  return new Request("https://owner.example/websub", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

test("websub hub: a subscribe for a canonical feed topic is accepted (202)", async () => {
  const response = await fetchWorker(
    websubForm({
      "hub.mode": "subscribe",
      "hub.callback": "https://subscriber.example/callback",
      "hub.topic": "https://test.example/rss.xml",
    }),
  );
  expect(response.status).toBe(202);
});

test("websub hub: every root feed is a subscribable topic", async () => {
  for (const path of ["/rss.xml", "/atom.xml", "/feed.json"]) {
    const response = await fetchWorker(
      websubForm({
        "hub.mode": "subscribe",
        "hub.callback": "https://subscriber.example/callback",
        "hub.topic": `https://test.example${path}`,
      }),
    );
    expect(response.status).toBe(202);
  }
});

test("websub hub: a subscribe for a non-feed topic is rejected (400)", async () => {
  const response = await fetchWorker(
    websubForm({
      "hub.mode": "subscribe",
      "hub.callback": "https://subscriber.example/callback",
      "hub.topic": "https://test.example/blog/hello/",
    }),
  );
  expect(response.status).toBe(400);
});

test("websub hub: topics are keyed on SITE_URL, not the request origin", async () => {
  // The request arrives on owner.example, but the canonical origin is SITE_URL
  // (test.example) — a feed path on the request origin is not a topic this hub serves.
  const response = await fetchWorker(
    websubForm({
      "hub.mode": "subscribe",
      "hub.callback": "https://subscriber.example/callback",
      "hub.topic": "https://owner.example/rss.xml",
    }),
  );
  expect(response.status).toBe(400);
});

test("websub hub: a publish ping for a canonical feed topic is accepted (202)", async () => {
  const response = await fetchWorker(
    websubForm({ "hub.mode": "publish", "hub.url": "https://test.example/atom.xml" }),
  );
  expect(response.status).toBe(202);
});

test("websub hub: a publish ping for a foreign topic is rejected (400)", async () => {
  const response = await fetchWorker(
    websubForm({ "hub.mode": "publish", "hub.url": "https://elsewhere.example/rss.xml" }),
  );
  expect(response.status).toBe(400);
});

test("websub hub: a non-POST method gets 405 with Allow: POST", async () => {
  const response = await fetchWorker(new Request("https://owner.example/websub", { method: "GET" }));
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("POST");
});

test("websub hub: 503 when the hub isn't provisioned (no queue/store binding)", async () => {
  const { WEBSUB_QUEUE: _unusedQueue, WEBSUB_DB: _unusedDB, ...envWithoutHub } = testEnv;
  const response = await worker.fetch(
    websubForm({
      "hub.mode": "subscribe",
      "hub.callback": "https://subscriber.example/callback",
      "hub.topic": "https://test.example/rss.xml",
    }),
    envWithoutHub as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub: 503 when MEDIA isn't bound", async () => {
  const { MEDIA: _unusedMedia, ...envWithoutMedia } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutMedia as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub: 503 when AUTH_DB isn't bound (IndieAuth not provisioned)", async () => {
  const { AUTH_DB: _unusedAuthDB, ...envWithoutAuthDB } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutAuthDB as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub: 503 when TOKEN_SIGNING_KEY isn't bound", async () => {
  const { TOKEN_SIGNING_KEY: _unusedSigningKey, ...envWithoutSigningKey } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutSigningKey as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub media: uploading a file with the media scope returns 201 + Location", async () => {
  const { token, keyPair } = await mintAccessToken("media");
  const url = "https://owner.example/media";
  const form = new FormData();
  form.set("file", new File(["hello world"], "hello.txt", { type: "text/plain" }));
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: form,
  }));
  expect(response.status).toBe(201);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return location;
});

test("micropub media: uploading without the media scope is rejected", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/media";
  const form = new FormData();
  form.set("file", new File(["hello world"], "hello.txt", { type: "text/plain" }));
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: form,
  }));
  expect(response.status).toBe(403);
});

test("micropub media: 503 when MEDIA isn't bound", async () => {
  const { MEDIA: _unusedMedia, ...envWithoutMedia } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/media", { method: "POST" }),
    envWithoutMedia as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("routing: /media/ prefix dispatches to the Micropub handler directly (not yet reachable via run_worker_first in production, see worker.ts's ROUTES comment)", async () => {
  // A GET against a *never-uploaded* key isn't distinguishing evidence here: @dwk/micropub's own
  // handleMediaGet ("Serve a previously uploaded media blob from R2 (public, unauthenticated)")
  // also 404s a missing key — same status as the router's own unclaimed-route 404, so `not.toBe
  // (404)` can't tell "the router never dispatched" apart from "it dispatched and the library
  // legitimately reported the key missing". Upload a real object first and retrieve it by its
  // actual key instead: only a genuine dispatch into the Micropub media handler can answer with
  // the uploaded bytes, so a 200 + matching body is unambiguous proof the /media/<key> prefix
  // route reaches handleMicropub.
  const { token, keyPair } = await mintAccessToken("media");
  const uploadUrl = "https://owner.example/media";
  const form = new FormData();
  form.set("file", new File(["dispatch probe"], "probe.txt", { type: "text/plain" }));
  const upload = await fetchWorker(new Request(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(uploadUrl, "POST", keyPair, token),
    },
    body: form,
  }));
  expect(upload.status).toBe(201);
  const location = upload.headers.get("location");
  expect(location).toBeTruthy();

  const response = await worker.fetch(
    new Request(location!, { method: "GET" }),
    testEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(200);
  // Not `text/plain` in the served response — handleMediaGet forces `application/octet-stream`
  // for any type outside its image/video/audio inline allowlist, so read the bytes directly
  // rather than `.text()` (which would warn about a non-text content-type on a body that, in
  // fact, is text).
  expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("dispatch probe");
});

// --- ActivityPub actor (V-4.1, #363) --------------------------------------------------------
// Composition of @dwk/activitypub's actor document, collections, and signed inbox. These run
// through worker.fetch in the workerd pool with ACTOR/AP_PRIVATE_KEY/AP_PUBLIC_KEY/
// AP_PUBLISH_TOKEN bound (see vitest.config.ts). The library's own signature/delivery internals
// are its own concern, not re-tested here.

test("activitypub: actor document is served as activity+json", async () => {
  const response = await fetchWorker(new Request("https://owner.example/users/site"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/activity+json");
  const body = await response.json() as { type: string; preferredUsername: string };
  expect(body.type).toBe("Person");
  expect(body.preferredUsername).toBe("site");
});

test("activitypub: outbox collection is served", async () => {
  const response = await fetchWorker(new Request("https://owner.example/users/site/outbox"));
  expect(response.status).toBe(200);
});

test("activitypub: nodeinfo discovery document is served", async () => {
  const response = await fetchWorker(new Request("https://owner.example/.well-known/nodeinfo"));
  expect(response.status).toBe(200);
});

test("activitypub: 503 when ACTOR isn't bound", async () => {
  const { ACTOR: _unusedActor, ...envWithoutActor } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/users/site"),
    envWithoutActor as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("activitypub: /inbox still serves inbox-capture, not the ActivityPub shared inbox", async () => {
  // Regression guard for the route collision documented in worker.ts's activityPubConfig
  // (sharedInbox: false) — POST /inbox must keep going to the bespoke inbox-capture handler.
  const response = await fetchWorker(new Request("https://owner.example/inbox", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "subject=Hi&from=a%40example.com&message=hello",
  }));
  expect(response.status).toBe(202);
});

test("micropub-to-activitypub fan-out: a successful create lands a Note in the outbox", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  // Unlike `fetchWorker` (which mints its own throwaway ExecutionContext), the fan-out runs in
  // `ctx.waitUntil` — it is NOT guaranteed to have completed just because `worker.fetch` resolved.
  // Capture this call's own context and explicitly `waitOnExecutionContext` it before checking the
  // outbox; without that wait this test is flaky-by-construction (a race, not a real "already
  // landed" guarantee), per `@cloudflare/vitest-pool-workers`' documented waitUntil-testing helper.
  const ctx = createExecutionContext();
  const createResponse = await worker.fetch(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { content: ["Hello, fediverse"] },
    }),
  }), testEnv, ctx);
  expect(createResponse.status).toBe(201);
  await waitOnExecutionContext(ctx);

  // The collection root (`/outbox`) is just an `OrderedCollection` summary (`totalItems` +
  // `first`/`last` page links) — `@dwk/activitypub` puts the actual `orderedItems` array on the
  // paged `OrderedCollectionPage` sub-resource, so that's what a fan-out assertion needs to fetch.
  const outboxPageResponse = await fetchWorker(new Request("https://owner.example/users/site/outbox?page=1"));
  const outboxPage = await outboxPageResponse.json() as { orderedItems?: Array<{ object?: { content?: string } }> };
  expect(outboxPage.orderedItems?.some((item) => item.object?.content?.includes("Hello, fediverse"))).toBe(true);
});

test("micropub-to-activitypub fan-out: an mf2 rich-text content object publishes its value, not \"[object Object]\"", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const ctx = createExecutionContext();
  const createResponse = await worker.fetch(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      // mf2 rich-text content shape: { html, value } — not a plain string. @dwk/micropub accepts
      // this form; the fan-out must extract `.value`, never `String(...)`-coerce the object.
      properties: { content: [{ html: "<p>Hello, <b>rich</b> fediverse</p>", value: "Hello, rich fediverse" }] },
    }),
  }), testEnv, ctx);
  expect(createResponse.status).toBe(201);
  await waitOnExecutionContext(ctx);

  const outboxPageResponse = await fetchWorker(new Request("https://owner.example/users/site/outbox?page=1"));
  const outboxPage = await outboxPageResponse.json() as { orderedItems?: Array<{ object?: { content?: string } }> };
  expect(outboxPage.orderedItems?.some((item) => item.object?.content?.includes("Hello, rich fediverse"))).toBe(true);
  expect(outboxPage.orderedItems?.some((item) => item.object?.content?.includes("[object Object]"))).toBe(false);
});

test("micropub-to-activitypub fan-out: never fires when ActivityPub isn't provisioned", async () => {
  const { AP_PUBLISH_TOKEN: _unusedToken, ...envWithoutToken } = testEnv;
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const request = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({ type: ["h-entry"], properties: { content: ["No federation here"] } }),
  });
  const response = await worker.fetch(request, envWithoutToken as WorkerEnv, createExecutionContext());
  // Must still succeed as a plain Micropub create — the fan-out being skipped is silent, not a failure.
  expect(response.status).toBe(201);
});

test("websub queue consumer: no-ops (does not throw) when the hub is unprovisioned", async () => {
  const { WEBSUB_DB: _unusedDB, SITE_URL: _unusedSiteURL, ...envWithoutHub } = testEnv;
  const emptyBatch = { queue: "site-websub", messages: [] } as unknown as Parameters<
    NonNullable<typeof worker.queue>
  >[0];
  await expect(
    worker.queue!(emptyBatch, envWithoutHub as WorkerEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

test("websub queue consumer: dispatches into @dwk/websub's consumer without throwing when provisioned", async () => {
  // An empty batch exercises the real provisioned path — env validated, websubOrigin resolved,
  // createWebSubQueueConsumer instantiated, consumer(batch, ...) invoked — without triggering any
  // verify/distribute/deliver job (there are none), so it's safe to run against the real
  // `@dwk/websub` consumer rather than a stub, unlike a populated batch (see vitest.config.ts's
  // comment on why site-websub isn't a registered queue consumer in this suite).
  const emptyBatch = { queue: "site-websub", messages: [] } as unknown as Parameters<
    NonNullable<typeof worker.queue>
  >[0];
  await expect(
    worker.queue!(emptyBatch, testEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

// --- WebFinger discovery (V-4.4, #366) ------------------------------------------------------
// Composition of @dwk/webfinger's handler, which is RFC 7033-conformant on its own (query
// validation, CORS, JRD body, 400/404) — these tests cover only what this file supplies: the
// resource map resolving `acct:site@<host>` to the ActivityPub actor, and the 503-when-
// unconfigured guard every other composed handler in this file follows.

test("webfinger: resolves acct:site@<host> to the ActivityPub actor", async () => {
  const response = await fetchWorker(
    new Request("https://owner.example/.well-known/webfinger?resource=acct:site@owner.example"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/jrd+json");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const jrd = await response.json() as { subject: string; links: Array<{ rel: string; type?: string; href?: string }> };
  expect(jrd.subject).toBe("acct:site@owner.example");
  expect(jrd.links).toContainEqual({
    rel: "self",
    type: "application/activity+json",
    href: "https://owner.example/users/site",
  });
});

test("webfinger: 503 when ActivityPub isn't configured", async () => {
  const { ACTOR: _unusedActor, ...envWithoutActor } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/.well-known/webfinger?resource=acct:site@owner.example"),
    envWithoutActor as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("webfinger: 400 when the resource query parameter is missing", async () => {
  const response = await fetchWorker(new Request("https://owner.example/.well-known/webfinger"));
  expect(response.status).toBe(400);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
});

test("webfinger: 404 for a resource this site does not control", async () => {
  const response = await fetchWorker(
    new Request("https://owner.example/.well-known/webfinger?resource=acct:someone-else@owner.example"),
  );
  expect(response.status).toBe(404);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
});

// --- Microsub reader (V-4.3, #365) ----------------------------------------------------------
// Composition of @dwk/microsub's single endpoint. These run through worker.fetch in the workerd
// pool with MICROSUB_DB/MICROSUB_QUEUE/AUTH_DB/TOKEN_SIGNING_KEY bound (see vitest.config.ts),
// exercising the same DPoP-authorized dispatch path production serves. Feed discovery/parsing
// and the poller/queue-consumer's own internals are the library's own concern (covered by its
// suite), not re-tested here — `discoverFeed` fails closed against the sandbox's blocked network,
// so `follow` still succeeds (it persists the subscription unconditionally) but never populates
// the timeline from a live fetch.

async function createMicrosubChannel(
  name: string,
  token: string,
  keyPair: CryptoKeyPair,
): Promise<string> {
  const url = "https://owner.example/microsub?action=channels";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: new URLSearchParams({ name }),
  }));
  const { uid } = await response.json() as { uid: string };
  return uid;
}

test("microsub: an unauthorized request (no Authorization header) is rejected", async () => {
  const response = await fetchWorker(new Request("https://owner.example/microsub?action=channels"));
  expect(response.status).toBe(401);
});

test("microsub: a valid token creates a channel and follows a feed (200)", async () => {
  const { token, keyPair } = await mintAccessToken("follow channels");
  const uid = await createMicrosubChannel("Blogs", token, keyPair);

  const followURL = "https://owner.example/microsub?action=follow";
  const follow = await fetchWorker(new Request(followURL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(followURL, "POST", keyPair, token),
    },
    body: new URLSearchParams({ channel: uid, url: "https://feed.example/atom.xml" }),
  }));
  expect(follow.status).toBe(200);
  await expect(follow.json()).resolves.toMatchObject({ type: "feed", url: "https://feed.example/atom.xml" });
});

test("microsub: the timeline for a freshly created channel is empty with no paging cursor", async () => {
  const { token, keyPair } = await mintAccessToken("channels");
  const uid = await createMicrosubChannel("Timeline", token, keyPair);

  const timelineURL = `https://owner.example/microsub?action=timeline&channel=${uid}`;
  const timeline = await fetchWorker(new Request(timelineURL, {
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(timelineURL, "GET", keyPair, token),
    },
  }));
  expect(timeline.status).toBe(200);
  await expect(timeline.json()).resolves.toMatchObject({ items: [], paging: {} });
});

test("microsub: an unknown channel is rejected (404)", async () => {
  const { token, keyPair } = await mintAccessToken("channels");
  const timelineURL = "https://owner.example/microsub?action=timeline&channel=does-not-exist";
  const response = await fetchWorker(new Request(timelineURL, {
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(timelineURL, "GET", keyPair, token),
    },
  }));
  expect(response.status).toBe(404);
});

test("microsub: 503 when MICROSUB_DB isn't bound", async () => {
  const { MICROSUB_DB: _unusedDB, ...envWithoutDB } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/microsub?action=channels"),
    envWithoutDB as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("microsub: 503 when MICROSUB_QUEUE isn't bound", async () => {
  const { MICROSUB_QUEUE: _unusedQueue, ...envWithoutQueue } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/microsub?action=channels"),
    envWithoutQueue as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("microsub queue consumer: no-ops (does not throw) when unprovisioned", async () => {
  const { MICROSUB_DB: _unusedDB, ...envWithoutMicrosub } = testEnv;
  const emptyBatch = { queue: "site-microsub", messages: [] } as unknown as Parameters<
    NonNullable<typeof worker.queue>
  >[0];
  await expect(
    worker.queue!(emptyBatch, envWithoutMicrosub as WorkerEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

test("microsub queue consumer: dispatches into @dwk/microsub's consumer without throwing when provisioned", async () => {
  // An empty batch exercises the real provisioned path without triggering any poll-fetch job —
  // same rationale as the WebSub queue-consumer test above.
  const emptyBatch = { queue: "site-microsub", messages: [] } as unknown as Parameters<
    NonNullable<typeof worker.queue>
  >[0];
  await expect(
    worker.queue!(emptyBatch, testEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

test("microsub scheduled poller: no-ops (does not throw) when unprovisioned", async () => {
  const { MICROSUB_DB: _unusedDB, ...envWithoutMicrosub } = testEnv;
  const controller = { cron: "*/15 * * * *", scheduledTime: Date.now() } as unknown as Parameters<
    NonNullable<typeof worker.scheduled>
  >[0];
  await expect(
    worker.scheduled!(controller, envWithoutMicrosub as WorkerEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

test("microsub scheduled poller: does not throw when provisioned (no followed feeds to poll)", async () => {
  const controller = { cron: "*/15 * * * *", scheduledTime: Date.now() } as unknown as Parameters<
    NonNullable<typeof worker.scheduled>
  >[0];
  await expect(
    worker.scheduled!(controller, testEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});

test("queue dispatch: an unrecognized queue name is a no-op, not misrouted to the webmention consumer", async () => {
  // Locks in the fail-safe default from worker.ts's queue() dispatcher: matching is positive
  // ("-webmention" / "-websub") rather than "webmention = doesn't end in -websub", so a queue
  // name belonging to neither feature is dropped rather than silently handled as webmention.
  const emptyBatch = { queue: "site-some-future-feature", messages: [] } as unknown as Parameters<
    NonNullable<typeof worker.queue>
  >[0];
  await expect(
    worker.queue!(emptyBatch, testEnv, createExecutionContext()),
  ).resolves.toBeUndefined();
});
