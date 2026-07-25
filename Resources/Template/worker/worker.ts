import {
  createIndieAuth,
  type AuthorizationRequest,
  type IndieAuthEnv,
} from "@dwk/indieauth";
import {
  createWebmention,
  createWebmentionQueueConsumer,
  createD1Inbox,
  type WebmentionEnv,
  type WebmentionJob,
} from "@dwk/webmention";
import {
  createMicropub,
  type MicropubEnv,
} from "@dwk/micropub";
import { discoverCollection, generateSlug } from "./post-type-discovery.ts";
import {
  createActivityPub,
  ActivityPubObject,
  type ActivityPubConfig,
  type ActivityPubEnv,
} from "@dwk/activitypub";
import {
  createWebSub,
  createWebSubQueueConsumer,
  type WebSubConfig,
  type WebSubEnv,
  type WebSubJob,
} from "@dwk/websub";
import {
  createMicrosub,
  createMicrosubPoller,
  createMicrosubQueueConsumer,
  type MicrosubEnv,
  type MicrosubJob,
} from "@dwk/microsub";
import { createWebfinger } from "@dwk/webfinger";

/**
 * Per-site Cloudflare Worker entry point.
 *
 * Composes @dwk/* social endpoints (IndieAuth, inbound Webmention, Micropub) behind the site's
 * static assets, plus a runtime inbox-capture
 * endpoint (#587) that does NOT depend on any @dwk/* package — Webmention's link-verification
 * shape and Micropub's IndieAuth-gated shape don't fit a public "visitor sends us a message"
 * form, so this route is bespoke. It stages submissions into the `INBOX_KV` namespace for the
 * app to pull and commit into the site's git working copy the next time it opens
 * (Sources/AnglesiteCore/InboxSubmissionSync.swift).
 *
 * Static assets are served by the [assets] binding in wrangler.toml; this Worker handles only
 * the social + inbox endpoint paths. When neither is enabled, this file is not referenced
 * (wrangler.toml has no `main` entry and deploys static-only).
 *
 * Routing (#746): `ROUTES` below is a declarative table mirroring the generic HTTP route claims
 * the app's Worker catalog declares for the active workers; Anglesite generates matching
 * selective `[assets].run_worker_first` entries so only these routes bypass asset-first serving.
 * The dispatcher is generic: exact/prefix matching, `405` + `Allow` for undeclared methods, HEAD
 * mirroring GET where declared, queries passed through untouched, and a true (plain-text) 404 —
 * never an HTML page — for unclaimed `/.well-known/` names, the bare directory, malformed
 * encodings, and case/trailing-slash variants (RFC 8615: the namespace has no index and no
 * fallback representation). Every other unmatched path falls through to static assets.
 */

/** Minimal Workers KV surface shared by inbox capture and consent throttling. */
export interface InboxKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface WorkerEnv extends IndieAuthEnv {
  ASSETS?: Fetcher;
  INBOX_KV?: InboxKV;
  SOCIAL_KV?: InboxKV;
  INDIEAUTH_OWNER_PASSWORD: string;
  /**
   * Inbound-Webmention bindings (V-3.1, #359). All optional: a site that hasn't provisioned
   * inbound Webmention has none of them bound, and the `/webmention` route + `queue` consumer
   * degrade gracefully (503 / ack-without-work) rather than throwing. Provisioning wires them —
   * a Cloudflare Queue for async verification, a D1 database for the verified-mention inbox, and
   * the site's canonical origin (the `queue` consumer has no request to derive it from).
   * See `WorkerComposition.generateWranglerToml` (Swift) for the binding generation.
   */
  WEBMENTION_QUEUE?: Queue<WebmentionJob>;
  WEBMENTION_INBOX?: D1Database;
  SITE_URL?: string;
  /**
   * Micropub bindings (V-3.2, #360). Both optional: a site that hasn't provisioned Micropub has
   * neither bound, and `/micropub`/`/media` degrade gracefully (503) rather than throwing.
   * `AUTH_DB`/`TOKEN_SIGNING_KEY` are already required by `IndieAuthEnv` above — Micropub's
   * catalog entry `requires: ["indieauth"]` (resolved by `WorkerActivation`) guarantees both are
   * provisioned together, so this handler still explicitly checks all four before dispatching,
   * matching `handleWebmentionReceive`'s defense-in-depth pattern rather than trusting reachability
   * alone. See `WorkerComposition.generateWranglerToml` (Swift) for the binding generation.
   */
  MICROPUB_DB?: D1Database;
  MEDIA?: R2Bucket;
  /**
   * ActivityPub actor bindings (V-4.1, #363). All optional: a site that hasn't provisioned
   * ActivityPub has none of them bound, and every actor route degrades to 503 rather than
   * letting @dwk/activitypub throw its own loud startup error. `ACTOR` is the per-actor Durable
   * Object namespace the package ships (`ActivityPubObject`, re-exported below so wrangler can
   * bind it). `AP_PRIVATE_KEY`/`AP_PUBLIC_KEY` are the actor's signing keypair (PKCS#8/SPKI PEM,
   * app-generated — see `ActivityPubKeyProvisioning.swift`). `AP_PUBLISH_TOKEN` gates the
   * owner-only publish endpoint the Micropub fan-out below calls internally.
   * `AP_DISPLAY_NAME` is the actor's `Person.name`, threaded from `SiteSettings.displayName`;
   * falls back to a generic name when unset. See `WorkerComposition.generateWranglerToml`
   * (Swift) for the binding generation.
   */
  ACTOR?: DurableObjectNamespace<ActivityPubObject>;
  AP_PRIVATE_KEY?: string;
  AP_PUBLIC_KEY?: string;
  AP_PUBLISH_TOKEN?: string;
  AP_DISPLAY_NAME?: string;
  /**
   * WebSub hub bindings (V-3.3, #361). Optional like the Webmention set above: a site that
   * hasn't provisioned the hub has none of them bound, and the `/websub` route + queue
   * consumer degrade gracefully (503 / ack-without-work). Provisioning wires a D1 database
   * for the strongly-consistent subscription store and a dedicated Cloudflare Queue for
   * intent verification + per-subscriber delivery fan-out. `WEBSUB_CONTENT` (R2 staging for
   * snapshots too large to inline in a queue message) is deliberately not provisioned yet —
   * a feed that outgrows the ~64 KB inline limit fails the fan-out loudly rather than
   * truncating, and wiring the staging bucket (with its lifecycle expiration rule) is the
   * documented follow-up.
   */
  WEBSUB_DB?: D1Database;
  WEBSUB_QUEUE?: Queue<WebSubJob>;
  /**
   * Microsub reader bindings (V-4.3, #365). Both optional: a site that hasn't provisioned
   * Microsub has neither bound, and `/microsub` plus its scheduled poller/queue consumer degrade
   * gracefully (503 / no-op) rather than throwing. `AUTH_DB`/`TOKEN_SIGNING_KEY` are already
   * required by `IndieAuthEnv` above — Microsub's catalog entry `requires: ["indieauth"]`
   * (resolved by `WorkerActivation`) guarantees both are provisioned together, so this handler
   * still explicitly checks all four before dispatching, matching `handleMicropub`'s
   * defense-in-depth pattern rather than trusting reachability alone. See
   * `WorkerComposition.generateWranglerToml` (Swift) for the binding generation.
   */
  MICROSUB_DB?: D1Database;
  MICROSUB_QUEUE?: Queue<MicrosubJob>;
}

export { ActivityPubObject };

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX_PER_WINDOW = 5;
const MAX_SUBJECT_LENGTH = 200;
const MAX_FROM_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_CONSENT_BODY_BYTES = 16_384;
const CONSENT_TTL_SECONDS = 300;
const CONSENT_VERSION = 1;

interface ConsentGrant {
  v: 1;
  exp: number;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  resources: string[];
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Derives a purpose-specific HMAC key from `secret` via HKDF, so that `TOKEN_SIGNING_KEY` — the
 * one secret provisioned for both consent-token signing and owner-password comparison — yields
 * independent subkeys per purpose. A weakness or misuse in one purpose's key can't cross over
 * into the other's.
 */
async function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(purpose) },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

function grantFor(request: AuthorizationRequest, expiresAt: number): ConsentGrant {
  return {
    v: CONSENT_VERSION,
    exp: expiresAt,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    state: request.state,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
    resources: [...(request.resources ?? [])],
  };
}

function isConsentGrant(value: unknown): value is ConsentGrant {
  if (typeof value !== "object" || value === null) return false;
  const grant = value as Record<string, unknown>;
  return grant.v === CONSENT_VERSION
    && typeof grant.exp === "number"
    && typeof grant.clientId === "string"
    && typeof grant.redirectUri === "string"
    && typeof grant.state === "string"
    && typeof grant.codeChallenge === "string"
    && typeof grant.scope === "string"
    && Array.isArray(grant.resources)
    && grant.resources.every((resource) => typeof resource === "string");
}

export async function createConsentToken(
  request: AuthorizationRequest,
  signingKey: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(grantFor(request, now + CONSENT_TTL_SECONDS)));
  const signature = await crypto.subtle.sign("HMAC", await deriveKey(signingKey, "consent-token"), payload);
  return `${base64url(payload)}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyConsentToken(
  token: string,
  request: AuthorizationRequest,
  signingKey: string,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (token.length > 8_192) return false;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra !== undefined) return false;
  const payload = decodeBase64url(payloadPart);
  const signature = decodeBase64url(signaturePart);
  if (!payload || !signature) return false;
  if (!(await crypto.subtle.verify("HMAC", await deriveKey(signingKey, "consent-token"), signature, payload))) return false;

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return false;
  }
  if (!isConsentGrant(decoded) || decoded.exp <= now) return false;
  const expected = grantFor(request, decoded.exp);
  return JSON.stringify(decoded) === JSON.stringify(expected);
}

async function secretsMatch(provided: string, expected: string, comparisonSecret: string): Promise<boolean> {
  const key = await deriveKey(comparisonSecret, "owner-password-compare");
  const encoder = new TextEncoder();
  const expectedMAC = await crypto.subtle.sign("HMAC", key, encoder.encode(expected));
  // Keep both passwords as message data under one server-controlled key and delegate the MAC
  // comparison to WebCrypto instead of comparing attacker-influenced bytes in JavaScript.
  return crypto.subtle.verify("HMAC", key, expectedMAC, encoder.encode(provided));
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function consentPage(request: AuthorizationRequest): Response {
  const hidden = [
    ["client_id", request.clientId],
    ["redirect_uri", request.redirectUri],
    ["state", request.state],
    ["response_type", "code"],
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", request.codeChallengeMethod],
    ["scope", request.scope],
    ...(request.me ? [["me", request.me]] : []),
    ...(request.resources ?? []).map((resource) => ["resource", resource]),
  ].map(([name, value]) => `<input type="hidden" name="${escapeHTML(name)}" value="${escapeHTML(value)}">`).join("\n");
  const scopes = request.scopes.length > 0 ? request.scopes.map(escapeHTML).join(", ") : "identity only";
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Approve sign-in</title></head><body><main>
<h1>Approve sign-in</h1>
<p><strong>${escapeHTML(request.clientId)}</strong> wants to sign in as this site.</p>
<p>Requested access: ${scopes}</p>
<form method="post" action="/indieauth/consent">
${hidden}
<label>Site owner password <input name="password" type="password" required autocomplete="current-password" maxlength="512"></label>
<button type="submit">Approve</button>
</form></main></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readBoundedForm(request: Request): Promise<URLSearchParams | null> {
  if (!(request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) return null;
  if (!request.body) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CONSENT_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(body));
}

async function consentRateLimitKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return `indieauth-login:${base64url(new Uint8Array(digest)).slice(0, 32)}`;
}

async function isConsentRateLimited(request: Request, env: WorkerEnv): Promise<boolean> {
  if (!env.SOCIAL_KV) {
    // Fail closed: an unbound KV must never silently disable the limiter.
    console.warn(JSON.stringify({ event: "indieauth.consent_rate_limit_unavailable" }));
    return true;
  }
  const key = await consentRateLimitKey(request);
  const raw = await env.SOCIAL_KV.get(key);
  const count = raw ? Number.parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_MAX_PER_WINDOW) return true;
  await env.SOCIAL_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return false;
}

export async function handleIndieAuthConsent(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  if (!env.INDIEAUTH_OWNER_PASSWORD || !env.TOKEN_SIGNING_KEY || !env.SOCIAL_KV) {
    return new Response("IndieAuth secrets are not configured", { status: 503 });
  }
  if (await isConsentRateLimited(request, env)) return new Response("Too Many Requests", { status: 429 });
  const form = await readBoundedForm(request);
  if (!form) return new Response("Invalid consent form", { status: 400 });
  if (!(await secretsMatch(
    form.get("password") ?? "",
    env.INDIEAUTH_OWNER_PASSWORD,
    env.TOKEN_SIGNING_KEY,
  ))) {
    console.warn(JSON.stringify({ event: "indieauth.consent_rejected", reason: "password_invalid" }));
    return new Response("Invalid site owner password", { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const authorize = new URL("/authorize", origin);
  for (const name of ["client_id", "redirect_uri", "state", "response_type", "code_challenge", "code_challenge_method", "scope", "me"]) {
    const value = form.get(name);
    if (value !== null) authorize.searchParams.set(name, value);
  }
  for (const resource of form.getAll("resource")) authorize.searchParams.append("resource", resource);
  const grant: AuthorizationRequest = {
    clientId: form.get("client_id") ?? "",
    redirectUri: form.get("redirect_uri") ?? "",
    state: form.get("state") ?? "",
    codeChallenge: form.get("code_challenge") ?? "",
    codeChallengeMethod: form.get("code_challenge_method") ?? "",
    scope: form.get("scope") ?? "",
    scopes: (form.get("scope") ?? "").split(/\s+/).filter(Boolean),
    ...(form.get("me") ? { me: form.get("me") as string } : {}),
    ...(form.getAll("resource").length > 0 ? { resources: form.getAll("resource") } : {}),
  };
  authorize.searchParams.set("consent", await createConsentToken(grant, env.TOKEN_SIGNING_KEY));
  return Response.redirect(authorize.toString(), 303);
}

function indieAuthHandler(request: Request, env: WorkerEnv) {
  const baseUrl = new URL(request.url).origin;
  return createIndieAuth({
    baseUrl,
    // Micropub's scopes ("create"/"update"/"delete"/"media") plus Microsub's ("follow"/
    // "channels"/"read", V-4.3 #365) — @dwk/indieauth's constrainScopes drops any requested
    // scope absent from this list, so a client authorizing for Microsub without "follow"/
    // "channels" listed here would silently be granted an empty scope and then fail every
    // Microsub action with `insufficient_scope`.
    scopesSupported: ["create", "update", "delete", "media", "follow", "channels", "read"],
    resourceIndicatorPolicy(resource) {
      try {
        return new URL(resource).origin === baseUrl;
      } catch {
        return false;
      }
    },
    async approveAuthorization(authorization) {
      const consent = new URL(request.url).searchParams.get("consent");
      if (consent && await verifyConsentToken(consent, authorization, env.TOKEN_SIGNING_KEY)) {
        return {
          me: `${baseUrl}/`,
          scopes: authorization.scopes,
          profile: { url: `${baseUrl}/` },
        };
      }
      return consentPage(authorization);
    },
  });
}

/**
 * Inbound-Webmention receive endpoint (V-3.1, #359).
 *
 * Composes `@dwk/webmention`'s receiver: a form-encoded `POST` of `source` + `target` is
 * validated synchronously (both `http(s)` URLs, distinct, `target` under this origin) and, on
 * success, enqueued to `WEBMENTION_QUEUE` for asynchronous link-verification before a `202`.
 * The heavy work — fetching the source through an SSRF-safe wrapper and confirming it links to
 * the target — happens in the `queue` consumer, keeping the request path cheap and spam-resistant.
 *
 * Returns `503` when inbound Webmention isn't provisioned for this site (no `WEBMENTION_QUEUE`),
 * so a stray request to an un-provisioned site gets a clean "not configured" rather than the
 * library's loud throw. The `/webmention` route is only advertised (`<link rel="webmention">`)
 * once provisioning is on — that discovery wiring is the paired template/Swift follow-up.
 */
function handleWebmentionReceive(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.WEBMENTION_QUEUE) {
    return Promise.resolve(new Response("Webmention receiving is not configured", { status: 503 }));
  }
  const baseUrl = new URL(request.url).origin;
  const receiver = createWebmention({ baseUrl });
  const webmentionEnv: WebmentionEnv = {
    WEBMENTION_QUEUE: env.WEBMENTION_QUEUE,
    WEBMENTION_INBOX: env.WEBMENTION_INBOX,
  };
  return receiver(request, webmentionEnv, ctx);
}

/**
 * Queue consumer for asynchronous Webmention verification (V-3.1, #359).
 *
 * For each queued `(source, target)` job, `@dwk/webmention` fetches the source through its
 * SSRF-safe wrapper and upserts a verified mention into the D1 inbox — or removes it when the
 * source no longer links. Acks-without-work (rather than throwing) when the inbox or the site
 * origin isn't provisioned, so an un-provisioned site's stray queue delivery can't wedge the
 * consumer. `SITE_URL` scopes which targets verification accepts; the consumer has no request to
 * derive the origin from, so provisioning supplies it as a plain var.
 */
function handleWebmentionQueue(
  batch: MessageBatch<WebmentionJob>,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.WEBMENTION_QUEUE || !env.WEBMENTION_INBOX || !env.SITE_URL) {
    return Promise.resolve();
  }
  const consumer = createWebmentionQueueConsumer({
    baseUrl: env.SITE_URL,
    inbox: createD1Inbox(env.WEBMENTION_INBOX),
  });
  const webmentionEnv: WebmentionEnv = {
    WEBMENTION_QUEUE: env.WEBMENTION_QUEUE,
    WEBMENTION_INBOX: env.WEBMENTION_INBOX,
  };
  return consumer(batch, webmentionEnv, ctx);
}

/**
 * Extracts a plain-text value from an mf2 `content` property entry (V-4.1, #363 review fix).
 * Microformats2-JSON — and `@dwk/micropub`'s own accepted input shape — allows `content` to be
 * either a plain string or a rich-text object (`{ html, value }`); naively coercing the object
 * form with `String(...)` produces the literal `"[object Object]"`, which would silently publish
 * garbage to followers instead of skipping the fan-out. `undefined` (missing/unrecognized shape)
 * is treated the same as an empty string by the caller, which already skips the fan-out rather
 * than publish an empty Note.
 */
function extractMf2ContentString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as { value?: unknown; html?: unknown };
    if (typeof obj.value === "string") return obj.value;
    // Standard Micropub JSON *create* shape for HTML content: { html } with no `value` key at
    // all — `value` only appears in mf2 read back off a rendered page, not in what a client
    // posts — so `html` is checked as a fallback, not just `value`.
    if (typeof obj.html === "string") return obj.html;
  }
  return "";
}

/**
 * Micropub server (V-3.2, #360).
 *
 * Composes `@dwk/micropub`'s create/update/delete endpoint and its R2-backed media endpoint.
 * Requires `@dwk/indieauth` to be active on the same site (catalog `requires`, resolved by
 * `WorkerActivation`) — Micropub authorizes every request against `AUTH_DB`'s issued-token store
 * using the same `TOKEN_SIGNING_KEY` IndieAuth signs tokens with.
 *
 * Returns `503` when Micropub isn't fully provisioned (`MICROPUB_DB`/`MEDIA` unbound, or
 * IndieAuth's `AUTH_DB`/`TOKEN_SIGNING_KEY` unbound) rather than letting `@dwk/micropub` throw
 * its own loud startup error.
 */
function handleMicropub(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.MICROPUB_DB || !env.MEDIA || !env.AUTH_DB || !env.TOKEN_SIGNING_KEY) {
    return Promise.resolve(new Response("Micropub is not configured", { status: 503 }));
  }
  const baseUrl = new URL(request.url).origin;
  const micropub = createMicropub({
    baseUrl,
    me: `${baseUrl}/`,
    // #912: assign a type-aware URL at create time so a synced git file (written under
    // src/content/{collection}/, per MicropubContentSync) renders at the same URL this
    // response's Location header already promised — see post-type-discovery.ts and
    // docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §1.
    generatePostUrl: (post, commands) => {
      const slug = generateSlug(post, commands);
      const collection = discoverCollection(post);
      return collection ? `${baseUrl}/${collection}/${slug}` : `${baseUrl}/${slug}`;
    },
  });
  const micropubEnv: MicropubEnv = {
    MEDIA: env.MEDIA,
    MICROPUB_DB: env.MICROPUB_DB,
    AUTH_DB: env.AUTH_DB,
    TOKEN_SIGNING_KEY: env.TOKEN_SIGNING_KEY,
  };
  // Extract the post content from a *clone taken before* `micropub()` ever reads the original
  // request's body (V-4.1, #363). Cloning an unconsumed Request is always spec-safe; cloning
  // one whose body a library has already read is not a documented-safe operation (workerd
  // happens to tolerate it today, but a future `@dwk/micropub` release that reads the body via
  // a locked stream reader could silently break the fan-out with no visible failure). Doing the
  // extraction up front — before `micropub(request, ...)` is called — sidesteps that hazard
  // entirely rather than relying on it.
  const contentPromise: Promise<string> = (async () => {
    if (!env.AP_PUBLISH_TOKEN || request.method !== "POST") return "";
    const cloned = request.clone();
    try {
      const contentType = cloned.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = (await cloned.json()) as { properties?: { content?: unknown[] } };
        return extractMf2ContentString(body.properties?.content?.[0]);
      }
      const form = await cloned.formData();
      return String(form.get("content") ?? form.get("properties[content]") ?? "");
    } catch {
      return ""; // Can't recover the post content — skip the fan-out rather than publish an empty Note.
    }
  })();
  return micropub(request, micropubEnv, ctx).then(async (response) => {
    if (request.method === "POST" && response.status === 201) {
      const content = await contentPromise;
      ctx.waitUntil(fanOutMicropubCreateToActivityPub(content, baseUrl, response, env, ctx));
    }
    return response;
  });
}

/**
 * Micropub-to-ActivityPub fan-out (V-4.1, #363): a successful Micropub create becomes a `Note`
 * activity, published through `@dwk/activitypub`'s owner-only publish endpoint
 * (`POST <actor>/outbox`) so it lands in the outbox and fans out to followers. In-process —
 * same Worker script, same invocation this request is already inside, no real network
 * round-trip. Only runs when ActivityPub is provisioned (`AP_PUBLISH_TOKEN` set); activating
 * Micropub alone never attempts to federate. Failure here must never fail the Micropub create
 * response (the post is already saved) — logged and swallowed.
 */
async function fanOutMicropubCreateToActivityPub(
  content: string,
  baseUrl: string,
  micropubResponse: Response,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.AP_PUBLISH_TOKEN) return;
  if (!content) return;
  const location = micropubResponse.headers.get("location");
  if (!location) return;

  const actorIRI = `${baseUrl}/users/${ACTIVITYPUB_USERNAME}`;
  const note = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    attributedTo: actorIRI,
    content,
    url: location,
    // No `cc` naming the followers collection: unlike the convention some AP implementations
    // use for "public post, also cc followers" addressing, @dwk/activitypub's owner-publish
    // outbox handler (`#publish` in its Durable Object) fans out to every current follower's
    // inbox unconditionally — it never inspects `to`/`cc` to decide who receives delivery, only
    // to shape what's displayed. Public-only addressing is sufficient here.
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };
  const publishRequest = new Request(`${actorIRI}/outbox`, {
    method: "POST",
    headers: {
      "content-type": "application/activity+json",
      authorization: `Bearer ${env.AP_PUBLISH_TOKEN}`,
    },
    body: JSON.stringify(note),
  });
  try {
    await handleActivityPub(publishRequest, env, ctx);
  } catch {
    // Swallow: the Micropub post is already saved; a federation hiccup must not surface as a
    // failure to the Micropub client.
  }
}

/**
 * Fixed identity for this app's single-actor-per-site model (V-4.1, #363) — no per-site
 * Settings field for a custom handle; see the design doc §"Actor identity source". WebFinger
 * (`.well-known/webfinger`, so `@site@domain` search resolves) is composed by
 * `handleWebFinger` below (V-4.4, #366); Mastodon can still follow this actor by pasting its
 * URL directly into search even where WebFinger isn't active.
 */
const ACTIVITYPUB_USERNAME = "site";

function activityPubConfig(request: Request, env: WorkerEnv): ActivityPubConfig | null {
  if (!env.ACTOR || !env.AP_PRIVATE_KEY || !env.AP_PUBLIC_KEY) return null;
  const baseUrl = new URL(request.url).origin;
  return {
    baseUrl,
    actor: {
      username: ACTIVITYPUB_USERNAME,
      name: env.AP_DISPLAY_NAME ?? new URL(baseUrl).hostname,
      summary: `Posts from ${new URL(baseUrl).hostname}`,
    },
    publicKeyPem: env.AP_PUBLIC_KEY,
    privateKeyPem: env.AP_PRIVATE_KEY,
    publishToken: env.AP_PUBLISH_TOKEN,
    // The package's shared-inbox route (POST /inbox at the origin root) collides with this
    // app's existing inbox-capture feature (#587, a public "visitor sends a message" form —
    // an unrelated concept already serving that exact path). Disabling it means inbound
    // federated deliveries go to the actor-specific /users/site/inbox instead, which is
    // equally valid ActivityPub — just without an optional batching optimization for
    // high-volume peers, irrelevant for a single-actor personal site.
    sharedInbox: false,
  };
}

/**
 * ActivityPub actor (V-4.1, #363).
 *
 * Composes `@dwk/activitypub`'s actor document, follower/following/outbox collections, and
 * signed server-to-server inbox — the Fediverse-facing half of this site. Returns 503 when
 * ActivityPub isn't fully provisioned (`ACTOR`/`AP_PRIVATE_KEY`/`AP_PUBLIC_KEY` unbound) rather
 * than letting `@dwk/activitypub` throw its own loud startup error, matching every other
 * composed handler in this file.
 */
function handleActivityPub(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = activityPubConfig(request, env);
  if (!config) {
    return Promise.resolve(new Response("ActivityPub is not configured", { status: 503 }));
  }
  const activitypub = createActivityPub(config);
  return activitypub(request, env as unknown as ActivityPubEnv, ctx);
}

/**
 * WebFinger discovery (V-4.4, #366): resolves `acct:<username>@<host>` to this site's
 * ActivityPub actor, so `@site@domain` search works in Mastodon and other fediverse clients.
 * `@dwk/webfinger`'s handler is RFC 7033-conformant on its own (query validation, CORS, JRD
 * body, 400/404); this function only supplies the resource map. The actor is WebFinger's only
 * controlled resource today, so — like every other composed handler in this file — this
 * returns 503 when ActivityPub isn't provisioned rather than constructing an always-empty
 * endpoint.
 */
function handleWebFinger(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = activityPubConfig(request, env);
  if (!config) {
    return Promise.resolve(new Response("WebFinger is not configured", { status: 503 }));
  }
  const baseUrl = new URL(request.url).origin;
  const host = new URL(baseUrl).hostname;
  const webfinger = createWebfinger({
    resources: {
      [`acct:${config.actor.username}@${host}`]: {
        links: [
          {
            rel: "self",
            type: "application/activity+json",
            href: `${baseUrl}/users/${config.actor.username}`,
          },
        ],
      },
    },
  });
  return webfinger(request, {}, ctx);
}

/**
 * Microsub reader (V-4.3, #365).
 *
 * Composes `@dwk/microsub`'s single endpoint: channel/feed subscriptions, following (with
 * immediate timeline population from the discovery fetch), and the normalised JF2 timeline
 * (mark read/unread, remove, per-channel unread counts). Requires `@dwk/indieauth` to be active
 * on the same site (catalog `requires`, resolved by `WorkerActivation`) — Microsub authorizes
 * every request against `AUTH_DB`'s issued-token store with a DPoP-bound access token, the same
 * as `@dwk/micropub`.
 *
 * Returns `503` when Microsub isn't fully provisioned (`MICROSUB_DB`/`MICROSUB_QUEUE` unbound,
 * or IndieAuth's `AUTH_DB`/`TOKEN_SIGNING_KEY` unbound) rather than letting `@dwk/microsub` throw
 * its own loud startup error.
 */
function handleMicrosub(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.MICROSUB_DB || !env.MICROSUB_QUEUE || !env.AUTH_DB || !env.TOKEN_SIGNING_KEY) {
    return Promise.resolve(new Response("Microsub is not configured", { status: 503 }));
  }
  const baseUrl = new URL(request.url).origin;
  const microsub = createMicrosub({ baseUrl, me: `${baseUrl}/` });
  const microsubEnv: MicrosubEnv = {
    MICROSUB_DB: env.MICROSUB_DB,
    MICROSUB_QUEUE: env.MICROSUB_QUEUE,
    AUTH_DB: env.AUTH_DB,
    TOKEN_SIGNING_KEY: env.TOKEN_SIGNING_KEY,
  };
  return microsub(request, microsubEnv, ctx);
}

/**
 * Cron-triggered feed poller for Microsub (V-4.3, #365): enqueues one poll job per followed
 * feed onto `MICROSUB_QUEUE`. Runs off the read path — `handleMicrosub`'s timeline action only
 * ever serves stored entries. No-ops when Microsub isn't provisioned.
 */
function handleMicrosubScheduled(
  controller: ScheduledController,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.MICROSUB_DB || !env.MICROSUB_QUEUE || !env.AUTH_DB || !env.TOKEN_SIGNING_KEY) {
    return Promise.resolve();
  }
  const baseUrl = env.SITE_URL ?? "";
  if (!baseUrl) return Promise.resolve();
  const poll = createMicrosubPoller({ baseUrl, me: `${baseUrl}/` });
  const microsubEnv: MicrosubEnv = {
    MICROSUB_DB: env.MICROSUB_DB,
    MICROSUB_QUEUE: env.MICROSUB_QUEUE,
    AUTH_DB: env.AUTH_DB,
    TOKEN_SIGNING_KEY: env.TOKEN_SIGNING_KEY,
  };
  return poll(controller, microsubEnv, ctx);
}

/**
 * Queue consumer for Microsub's feed-poll fan-out (V-4.3, #365): fetches + parses each polled
 * feed and appends new entries to the following channel's timeline. Acks-without-work when
 * Microsub isn't provisioned — same contract as `handleWebmentionQueue`/`handleWebSubQueue`.
 */
function handleMicrosubQueue(
  batch: MessageBatch<MicrosubJob>,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.MICROSUB_DB || !env.MICROSUB_QUEUE || !env.AUTH_DB || !env.TOKEN_SIGNING_KEY || !env.SITE_URL) {
    return Promise.resolve();
  }
  const consume = createMicrosubQueueConsumer({ baseUrl: env.SITE_URL, me: `${env.SITE_URL}/` });
  const microsubEnv: MicrosubEnv = {
    MICROSUB_DB: env.MICROSUB_DB,
    MICROSUB_QUEUE: env.MICROSUB_QUEUE,
    AUTH_DB: env.AUTH_DB,
    TOKEN_SIGNING_KEY: env.TOKEN_SIGNING_KEY,
  };
  return consume(batch, microsubEnv, ctx);
}

/**
 * The site's feed paths — the only topics the WebSub hub serves. These are the template's
 * static root feeds (src/pages/{rss.xml,atom.xml,feed.json}.ts); they cover everything the
 * site publishes, so a subscriber to any of them sees every update. The same list drives the
 * `rel="hub"` advertisement in the generated feeds (src/lib/feeds.ts) and Anglesite's
 * publish ping after a deploy — all three must agree or a discoverable topic would 400 on
 * subscribe or never receive a push.
 */
export const WEBSUB_TOPIC_PATHS = ["/rss.xml", "/atom.xml", "/feed.json"] as const;

/**
 * WebSub hub configuration for a given canonical site origin. Topics are the root feeds on
 * that origin; the hub endpoint itself is `/websub` on the same origin.
 */
function websubConfig(origin: string): WebSubConfig {
  return {
    baseUrl: origin,
    hubUrl: `${origin}/websub`,
    allowedTopics: WEBSUB_TOPIC_PATHS.map((path) => `${origin}${path}`),
  };
}

/**
 * The canonical origin WebSub topics are keyed on, or `null` when `SITE_URL` isn't provisioned
 * or isn't a valid URL. Both the hub route and the queue consumer require this — subscriptions
 * are keyed on exact topic URLs, and a hub that fell back to the request's origin could accept
 * a subscription the queue consumer (which has no request to derive an origin from, and always
 * requires `SITE_URL`) would then silently never fan out to. Failing the hub route closed here
 * keeps both sides of the same feature agreeing on what "provisioned" means.
 */
function websubOrigin(env: WorkerEnv): string | null {
  if (!env.SITE_URL) return null;
  try {
    return new URL(env.SITE_URL).origin;
  } catch {
    return null;
  }
}

/**
 * WebSub hub endpoint (V-3.3, #361).
 *
 * Composes `@dwk/websub`'s hub: a form-encoded `POST` of `hub.mode=subscribe|unsubscribe`
 * is validated synchronously and a verification-of-intent job enqueued (202);
 * `hub.mode=publish` for one of this site's feeds enqueues a distribution job (202) — the
 * consumer fetches the feed once and POSTs it to every verified subscriber, HMAC-signing
 * the body (`X-Hub-Signature`) for subscribers that registered a secret. Returns 503 when
 * the hub isn't provisioned for this site (no queue/store binding, or no canonical `SITE_URL`
 * — see `websubOrigin`), mirroring `handleWebmentionReceive`'s degrade-gracefully contract.
 */
function handleWebSubHub(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
  const origin = websubOrigin(env);
  if (!env.WEBSUB_QUEUE || !env.WEBSUB_DB || !origin) {
    return Promise.resolve(new Response("WebSub hub is not configured", { status: 503 }));
  }
  const hub = createWebSub(websubConfig(origin));
  const websubEnv: WebSubEnv = {
    WEBSUB_DB: env.WEBSUB_DB,
    WEBSUB_QUEUE: env.WEBSUB_QUEUE,
  };
  return hub(request, websubEnv, ctx);
}

/**
 * Queue consumer for WebSub verification + distribution + per-subscriber delivery (V-3.3,
 * #361). Acks-without-work when the hub or the canonical site origin isn't provisioned —
 * same contract as `handleWebmentionQueue`.
 */
function handleWebSubQueue(
  batch: MessageBatch<WebSubJob>,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  const origin = websubOrigin(env);
  if (!env.WEBSUB_QUEUE || !env.WEBSUB_DB || !origin) {
    return Promise.resolve();
  }
  const consumer = createWebSubQueueConsumer(websubConfig(origin));
  const websubEnv: WebSubEnv = {
    WEBSUB_DB: env.WEBSUB_DB,
    WEBSUB_QUEUE: env.WEBSUB_QUEUE,
  };
  return consumer(batch, websubEnv, ctx);
}

export interface InboxFields {
  subject: string;
  from: string;
  message: string;
}

/** Validates and trims the three required fields; null if any is missing or too long. */
export function validateInboxFields(fields: Record<string, string>): InboxFields | null {
  const subject = (fields.subject ?? "").trim();
  const from = (fields.from ?? "").trim();
  const message = (fields.message ?? "").trim();
  if (!subject || !from || !message) return null;
  if (
    subject.length > MAX_SUBJECT_LENGTH ||
    from.length > MAX_FROM_LENGTH ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return null;
  }
  return { subject, from, message };
}

/** True (and records the hit) once `ip` has submitted `RATE_LIMIT_MAX_PER_WINDOW` times within
 *  the current hour-long window. A simple KV counter, not a sliding window — good enough for a
 *  single-owner-site abuse gate; Cloudflare's own Rate Limiting Rules remain the escalation path
 *  for anything more sophisticated.
 *
 *  The get-then-put below is NOT atomic: two concurrent requests from the same IP can both read
 *  the same stale count before either write lands, so both get admitted, and Workers KV's
 *  eventual consistency (writes can take up to ~60s to propagate globally) makes this worse under
 *  a distributed burst. This makes the cap soft/best-effort — enough to deter casual abuse — not
 *  a hard guarantee; a true hard limit would need an atomic counter (e.g. a Durable Object). */
export async function isRateLimited(kv: InboxKV, ip: string): Promise<boolean> {
  const key = `ratelimit:${ip}`;
  const raw = await kv.get(key);
  const count = raw ? Number.parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_MAX_PER_WINDOW) return true;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return false;
}

async function parseRequestFields(request: Request): Promise<Record<string, string> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  }
  return null;
}

export async function handleInbox(
  request: Request,
  env: Pick<WorkerEnv, "INBOX_KV">,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!env.INBOX_KV) return new Response("Inbox capture not configured", { status: 500 });

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (await isRateLimited(env.INBOX_KV, ip)) {
    return new Response(null, { status: 429 });
  }

  const fields = await parseRequestFields(request);
  if (!fields) return new Response("Unsupported Content-Type", { status: 400 });

  // Honeypot: a hidden form field real visitors never fill in. Silently accept-and-drop so bots
  // get no signal they were caught, rather than a 4xx they could learn from.
  if ((fields.website ?? "").trim() !== "") {
    return new Response(null, { status: 202 });
  }

  const validated = validateInboxFields(fields);
  if (!validated) {
    return new Response("Missing or invalid field: subject, from, message", { status: 400 });
  }

  const id = crypto.randomUUID();
  const submission = { id, ...validated, receivedAt: new Date().toISOString() };
  await env.INBOX_KV.put(`inbox:${id}`, JSON.stringify(submission));

  return new Response(null, { status: 202 });
}

/** One dynamic route this Worker serves — the handler-side mirror of a catalog route claim. */
export interface WorkerRoute {
  /** Absolute claimed path, e.g. `"/.well-known/oauth-authorization-server"`. */
  path: string;
  /** `exact` matches only `path`; `prefix` additionally matches `path` + `/…` descendants. */
  match: "exact" | "prefix";
  /** Declared methods. HEAD is served only when listed alongside GET — the dispatcher mirrors
   *  GET's status/headers without a body and never hands handlers a raw HEAD request (catalog
   *  claims enforce the same GET pairing app-side). */
  methods: readonly string[];
  handler: (request: Request, env: WorkerEnv, ctx: ExecutionContext) => Promise<Response> | Response;
}

export const ROUTES: readonly WorkerRoute[] = [
  {
    // RFC 8414 authorization-server metadata (linked via rel=indieauth-metadata in BaseLayout).
    path: "/.well-known/oauth-authorization-server",
    match: "exact",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => indieAuthHandler(request, env)(request, env, ctx),
  },
  {
    // GET renders/redirects the authorization request; POST redeems an authorization code for
    // profile information (IndieAuth authorization-endpoint code exchange).
    path: "/authorize",
    match: "exact",
    methods: ["GET", "POST"],
    handler: (request, env, ctx) => indieAuthHandler(request, env)(request, env, ctx),
  },
  {
    // POST is the token grant; GET is IndieAuth token-endpoint access-token verification.
    path: "/token",
    match: "exact",
    methods: ["GET", "POST"],
    handler: (request, env, ctx) => indieAuthHandler(request, env)(request, env, ctx),
  },
  {
    path: "/revocation",
    match: "exact",
    methods: ["POST"],
    handler: (request, env, ctx) => indieAuthHandler(request, env)(request, env, ctx),
  },
  {
    path: "/indieauth/consent",
    match: "exact",
    methods: ["POST"],
    handler: (request, env) => handleIndieAuthConsent(request, env),
  },
  {
    path: "/inbox",
    match: "exact",
    methods: ["POST"],
    handler: (request, env) => handleInbox(request, env),
  },
  {
    // Inbound Webmention receiver (V-3.1, #359): POST source+target, validate, enqueue, 202.
    path: "/webmention",
    match: "exact",
    methods: ["POST"],
    handler: (request, env, ctx) => handleWebmentionReceive(request, env, ctx),
  },
  {
    // Micropub create/update/delete + q=config/q=source/q=syndicate-to queries (V-3.2, #360).
    path: "/micropub",
    match: "exact",
    methods: ["GET", "POST"],
    handler: (request, env, ctx) => handleMicropub(request, env, ctx),
  },
  {
    // Media endpoint upload (V-3.2, #360). GET-on-bare-/media is not served (matches
    // @dwk/micropub's default extensions.proposed: false — GET is only the media *retrieval*
    // path below, under /media/<key>, not the collection root).
    path: "/media",
    match: "exact",
    methods: ["POST"],
    handler: (request, env, ctx) => handleMicropub(request, env, ctx),
  },
  {
    // Media retrieval by key (V-3.2, #360). NOTE: the catalog.json claim for this prefix route
    // currently has no specificationURL, which WorkerRouteClaims.validate (Swift) requires for
    // any prefix claim — until that's patched upstream, this route is unreachable in production
    // (no run_worker_first entry gets generated for it), though it's still exercised directly by
    // the miniflare test suite below.
    path: "/media",
    match: "prefix",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleMicropub(request, env, ctx),
  },
  {
    // Actor document + outbox/followers/following collections (V-4.1, #363). No trailing slash:
    // `matchRoute`'s prefix check appends its own `/` to `path` before comparing, so a `path` that
    // already ends in `/` would build a double-slash prefix ("/users//") that never matches
    // "/users/site" — see the other prefix entries above (e.g. "/media") for the same convention.
    path: "/users",
    match: "prefix",
    methods: ["GET", "POST", "HEAD"],
    handler: (request, env, ctx) => handleActivityPub(request, env, ctx),
  },
  {
    path: "/.well-known/nodeinfo",
    match: "exact",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleActivityPub(request, env, ctx),
  },
  {
    // No trailing slash — see the "/users" comment above for why.
    path: "/nodeinfo",
    match: "prefix",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleActivityPub(request, env, ctx),
  },
  {
    // WebSub hub (V-3.3, #361): POST hub.mode=subscribe|unsubscribe|publish, validate, enqueue, 202.
    path: "/websub",
    match: "exact",
    methods: ["POST"],
    handler: (request, env, ctx) => handleWebSubHub(request, env, ctx),
  },
  {
    // Microsub reader (V-4.3, #365): action=channels|follow|unfollow|timeline|search|preview.
    path: "/microsub",
    match: "exact",
    methods: ["GET", "POST"],
    handler: (request, env, ctx) => handleMicrosub(request, env, ctx),
  },
  {
    // WebFinger discovery (V-4.4, #366): resolve acct:site@<host> to the ActivityPub actor.
    path: "/.well-known/webfinger",
    match: "exact",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleWebFinger(request, env, ctx),
  },
];

export function matchRoute(pathname: string, routes: readonly WorkerRoute[] = ROUTES): WorkerRoute | null {
  for (const route of routes) {
    if (pathname === route.path) return route;
    if (route.match === "prefix" && pathname.startsWith(`${route.path}/`)) return route;
  }
  return null;
}

/** A protocol-grade 404: correct status, no HTML error page, nothing for a client to mis-parse. */
function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
  });
}

/** True for the bare `/.well-known` directory and anything under it, case-insensitively — the
 *  case fold exists so `/.Well-Known/...` variants get the namespace's true-404 policy instead
 *  of leaking to an HTML asset 404 (claimed routes themselves match case-sensitively). */
function isWellKnownNamespace(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === "/.well-known" || lower === "/.well-known/" || lower.startsWith("/.well-known/");
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Malformed percent-encoding can't name any claimed route or asset; answer plainly instead
    // of handing it to an HTML 404 page.
    let decoded: string | null;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = null;
    }
    if (decoded === null) {
      return notFound();
    }

    const route = matchRoute(pathname);
    if (route) {
      const mirrorsGet = request.method === "HEAD" && route.methods.includes("HEAD") && route.methods.includes("GET");
      if (mirrorsGet) {
        // Query string rides along in `request.url`; only the method changes.
        const getResponse = await route.handler(
          new Request(request.url, { method: "GET", headers: request.headers }),
          env,
          ctx,
        );
        return new Response(null, {
          status: getResponse.status,
          statusText: getResponse.statusText,
          headers: getResponse.headers,
        });
      }
      if (!route.methods.includes(request.method)) {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { allow: route.methods.join(", "), "content-type": "text/plain; charset=utf-8" },
        });
      }
      return route.handler(request, env, ctx);
    }

    // Unclaimed well-known names, the bare directory, and case/trailing-slash or encoded
    // variants (checked post-decode so `/%2Ewell-known/...` can't slip past) return a true 404
    // rather than falling through to an HTML asset 404. Genuinely static well-known files (e.g.
    // security.txt) are served asset-first and never reach this Worker.
    if (isWellKnownNamespace(pathname) || isWellKnownNamespace(decoded)) {
      return notFound();
    }

    const assets = env.ASSETS;
    if (!assets) {
      return new Response("No assets binding configured", { status: 500 });
    }
    return assets.fetch(request);
  },

  // Async queue work, present unconditionally; no-ops for sites without the matching feature
  // provisioned. Three queues deliver here — Webmention verification (V-3.1, #359), WebSub
  // verification/distribution/delivery (V-3.3, #361), and Microsub feed-poll fan-out (V-4.3,
  // #365) — dispatched on the queue's name: Anglesite provisions deterministic names
  // (`<site>-webmention`, `<site>-websub`, `<site>-microsub`). All matches are positive (rather
  // than "webmention = anything that isn't -websub") so a future queue-backed feature can't get
  // silently misrouted into another's consumer.
  async queue(
    batch: MessageBatch<WebmentionJob | WebSubJob | MicrosubJob>,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (batch.queue.endsWith("-websub")) {
      return handleWebSubQueue(batch as MessageBatch<WebSubJob>, env, ctx);
    }
    if (batch.queue.endsWith("-webmention")) {
      return handleWebmentionQueue(batch as MessageBatch<WebmentionJob>, env, ctx);
    }
    if (batch.queue.endsWith("-microsub")) {
      return handleMicrosubQueue(batch as MessageBatch<MicrosubJob>, env, ctx);
    }
    return Promise.resolve();
  },

  // Cron Trigger, present unconditionally; no-ops for a site without Microsub provisioned
  // (V-4.3, #365) — the only feature that schedules work today.
  async scheduled(
    controller: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    return handleMicrosubScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<WorkerEnv, WebmentionJob | WebSubJob | MicrosubJob>;
