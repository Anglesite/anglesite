/**
 * Cloudflare Worker entry — wraps env.ASSETS.fetch() with the runtime
 * middleware that used to live in functions/_middleware.ts under the old
 * Cloudflare Pages model. Three responsibilities, in order:
 *
 *   1. Membership gate — if the requested path is in the premium route
 *      manifest (worker/_premium-routes.json), verify the signed
 *      __anglesite_member cookie before allowing the request through.
 *      Configured by /anglesite:membership.
 *   2. A/B test variant routing — assigns a variant via cookie and serves
 *      the pre-rendered variant HTML alongside the control. Zero layout
 *      flicker. Configured by /anglesite:experiment.
 *   3. Consent geo injection — when CONSENT_GEO=true, injects
 *      <meta name="cf-country"> into HTML responses so the consent banner
 *      runtime can apply EU/UK default-deny on first paint. Configured by
 *      /anglesite:consent.
 *   4. IndieWeb endpoints — IndieAuth (/auth), Micropub (/micropub, /media),
 *      and Webmention (/webmention) handlers, each gated on its D1 binding.
 *      Configured by /anglesite:indieweb.
 *   5. Webmention edge-render — on note/post HTML responses, injects any
 *      stored mentions of that page into a <div id="webmentions"> container
 *      via HTMLRewriter. Gated to note/post target paths that actually have
 *      mentions: a per-isolate cache of known target URLs (refreshed at most
 *      once per minute) means mention-free pages pay no per-request D1 query
 *      and no rewrite.
 *
 * Every feature is gated on its binding/var being present, so a site that
 * hasn't run any of these skills serves identically to a bare ASSETS-only
 * worker (one extra hop, no behavior change).
 *
 * Bindings (configured in wrangler.jsonc):
 *   ASSETS                       — Static assets fetcher (always present)
 *   EXPERIMENTS (KV, optional)   — Active A/B experiment config
 *   ANALYTICS   (AED, optional)  — Impression event stream
 *   AUTH_DB     (D1, optional)   — IndieAuth codes + tokens
 *   MICROPUB_DB (D1, optional)   — Micropub post records + DPoP jti replay
 *   WEBMENTION_INBOX (D1, optional) — Verified webmention inbox (@dwk/webmention)
 *   MEDIA       (R2, optional)   — Micropub media-endpoint blob storage
 *   WEBMENTION_QUEUE (Queue, optional) — Async webmention verification
 *
 *   SITE_URL    (var, optional)  — Site origin; @dwk/webmention baseUrl
 *
 * Vars / secrets:
 *   MEMBERSHIP_SIGNING_KEY (optional) — hex HMAC key, set as a wrangler
 *                                       secret on this worker to enable the
 *                                       premium gate. Must match the helper
 *                                       Worker that issues the cookie.
 *   MEMBERSHIP_PREVIEW_TOKEN (optional) — query param value that bypasses
 *                                         the gate, for owner preview.
 *   CONSENT_GEO (optional)            — "true" to enable cf-country meta
 *                                       injection.
 *   INDIEAUTH_SIGNING_KEY (secret, optional) — Token signing material.
 *   GITHUB_TOKEN (secret, optional)   — Fine-grained PAT for Micropub bridge.
 */

import premiumRoutes from "./_premium-routes.json";
import { createIndieAuth } from "@dwk/indieauth";
import { createHandler as createMicropub } from "@dwk/micropub";
import {
  createWebmention,
  createWebmentionQueueConsumer,
  createD1Inbox,
} from "@dwk/webmention";
import { createWebAuthn, WebAuthnObject } from "@dwk/webauthn";
import { sync as syncMicropubBridge } from "./indieweb-bridge.js";
import {
  OWNER_COOKIE,
  readCookie,
  verifyOwnerSession,
  verifyConsentToken,
} from "./owner-auth.js";
import { renderConsentPage } from "./auth-pages.js";

// @dwk/webauthn is bound as a Durable Object namespace (WEBAUTHN); the Worker
// must re-export the class so wrangler can instantiate it.
export { WebAuthnObject };

const COOKIE_NAME = "__anglesite_member";

const micropub = createMicropub({
  generatePostUrl: (slug) => `/notes/${slug}/`,
});

// The IndieAuth authentication + consent hook. @dwk/indieauth owns the protocol;
// proving the owner's identity (passkey/backup code) and obtaining consent is
// ours. Returns an AuthorizationApproval only when the request carries a valid
// owner-session cookie AND a consent token bound to this exact request;
// otherwise returns the consent page (the library forwards it verbatim).
function makeApproveAuthorization(env) {
  return async (authReq, httpRequest) => {
    const sessionKey = env.INDIEAUTH_SESSION_KEY;
    const cookie = readCookie(
      httpRequest.headers.get("Cookie") ?? "",
      OWNER_COOKIE,
    );
    const session = await verifyOwnerSession(cookie, sessionKey);
    const consent = new URL(httpRequest.url).searchParams.get("_consent");
    const bound = {
      clientId: authReq.clientId,
      redirectUri: authReq.redirectUri,
      scope: authReq.scope,
    };
    if (session && consent && (await verifyConsentToken(consent, sessionKey, bound))) {
      return {
        me: env.SITE_URL,
        scopes: authReq.scopes,
        profile: { url: env.SITE_URL },
      };
    }
    return new Response(
      renderConsentPage({ request: httpRequest, authenticated: !!session }),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };
}

// @dwk/webmention's factories take config (baseUrl) at construction, but the
// Worker only has `env` at request/queue time — and the queue consumer has no
// request URL to derive an origin from. Build the receiver, the (separate) queue
// consumer, and the inbox reader once per `env` and memoize them. `baseUrl` comes
// from the SITE_URL var the indieweb skill writes into wrangler.jsonc.
const webmentionByEnv = new WeakMap();
function webmentionFor(env) {
  let bundle = webmentionByEnv.get(env);
  if (!bundle) {
    const baseUrl = env.SITE_URL;
    // @dwk/webmention validates inbound `target`s against baseUrl. An empty
    // baseUrl would make the receiver reject every mention silently — surface it
    // once (memoization means this block runs once per isolate).
    if (env.WEBMENTION_INBOX && !baseUrl) {
      console.error(
        "SITE_URL is not set — @dwk/webmention cannot validate webmention " +
          "targets and will reject all inbound mentions. Run /anglesite:indieweb " +
          "to configure it.",
      );
    }
    bundle = {
      handler: createWebmention({ baseUrl }),
      consumer: createWebmentionQueueConsumer({ baseUrl }),
      inbox: env.WEBMENTION_INBOX ? createD1Inbox(env.WEBMENTION_INBOX) : null,
    };
    webmentionByEnv.set(env, bundle);
  }
  return bundle;
}

// IndieAuth + WebAuthn factories also need config (origin/rpId) derived from
// env.SITE_URL, available only at request time. Build once per env and memoize.
const authByEnv = new WeakMap();
function authFor(env) {
  let bundle = authByEnv.get(env);
  if (!bundle) {
    const origin = env.SITE_URL;
    const rpId = origin ? new URL(origin).host : undefined;
    bundle = {
      indieauth: createIndieAuth({
        baseUrl: origin,
        approveAuthorization: makeApproveAuthorization(env),
      }),
      webauthn: createWebAuthn({ rpId, rpName: rpId ?? "site", origin }),
    };
    authByEnv.set(env, bundle);
  }
  return bundle;
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const accept = request.headers.get("Accept") ?? "";
    const isHtmlRequest = accept.includes("text/html");

    // 1. Membership gate — runs before A/B assignment so non-members never
    //    see (or get counted in the impressions for) gated variants.
    if (
      isHtmlRequest &&
      env.MEMBERSHIP_SIGNING_KEY &&
      isPremiumRoute(url.pathname, premiumRoutes)
    ) {
      const previewToken = url.searchParams.get("preview");
      const allowedPreview =
        env.MEMBERSHIP_PREVIEW_TOKEN &&
        previewToken &&
        previewToken === env.MEMBERSHIP_PREVIEW_TOKEN;

      if (!allowedPreview) {
        const cookieHeader = request.headers.get("Cookie") ?? "";
        const cookieValue = readCookie(cookieHeader, COOKIE_NAME);
        const payload = await verifyMembershipCookie(
          cookieValue,
          env.MEMBERSHIP_SIGNING_KEY,
        );
        if (!payload) {
          return unlockRedirect(url.pathname, url.search);
        }
      }
    }

    // 2. A/B test variant routing
    let response;
    let setCookieHeader = null;
    if (isHtmlRequest && env.EXPERIMENTS) {
      const experiment = await loadActiveExperiment(env.EXPERIMENTS, url.pathname);
      if (experiment) {
        const cookieHeader = request.headers.get("Cookie") ?? "";
        const existingVariant = parseVariantCookie(cookieHeader, experiment.id);
        const validVariant =
          existingVariant && experiment.variants.includes(existingVariant)
            ? existingVariant
            : null;
        const variant =
          validVariant ?? assignVariant(experiment.variants, experiment.weights);

        const variantPath = resolveVariantPath(url.pathname, variant);
        const variantUrl = new URL(variantPath, url.origin);
        const variantRequest = new Request(variantUrl.toString(), request);
        response = await env.ASSETS.fetch(variantRequest);

        if (!existingVariant) {
          setCookieHeader = serializeVariantCookie(experiment.id, variant);
        }

        if (env.ANALYTICS) {
          try {
            env.ANALYTICS.writeDataPoint(
              buildImpressionDataPoint(experiment.id, variant, hashSession(request)),
            );
          } catch {
            // Non-blocking
          }
        }
      }
    }

    // 4. IndieWeb endpoints — each gated on its D1 binding being present.
    const p = url.pathname;
    if (env.AUTH_DB && p.startsWith("/auth/webauthn/"))
      return authFor(env).webauthn(request, env, ctx);
    if (env.AUTH_DB && p.startsWith("/auth"))
      return authFor(env).indieauth(request, env, ctx);
    if (env.MICROPUB_DB && (p === "/micropub" || p === "/media"))
      return micropub(request, env, ctx);
    if (env.WEBMENTION_INBOX && p === "/webmention")
      return webmentionFor(env).handler(request, env, ctx);

    if (!response) {
      response = await env.ASSETS.fetch(request);
    }

    // 3. Consent geo injection
    if (isHtmlRequest && env.CONSENT_GEO === "true") {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        const cf = request.cf;
        const rawCountry = cf?.country ?? "XX";
        const country =
          rawCountry.replace(/[^A-Z0-9]/gi, "").slice(0, 4).toUpperCase() || "XX";
        response = new HTMLRewriter()
          .on("head", new CountryInjector(country))
          .transform(response);
      }
    }

    // 5. Webmention edge-render — inject stored mentions into note/post pages.
    //    Gating order keeps the cost off pages that can't have mentions:
    //    HTML request → WEBMENTION_INBOX bound → note/post path → HTML response
    //    → page is a known mention target (cached set, refreshed at most once
    //    a minute per isolate) → only then read the inbox for that page's
    //    mentions and rewrite. Pages with no stored mentions pay no per-request
    //    read and no rewrite.
    if (
      isHtmlRequest &&
      env.WEBMENTION_INBOX &&
      isWebmentionTarget(url.pathname)
    ) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        const target = `${url.origin}${url.pathname}`;
        const inbox = webmentionFor(env).inbox;
        const targets = await loadWebmentionTargets(env.WEBMENTION_INBOX, inbox);
        if (targets.has(target)) {
          const mentions = await loadWebmentions(inbox, target);
          if (mentions.length > 0) {
            response = new HTMLRewriter()
              .on("#webmentions", new WebmentionInjector(mentions))
              .transform(response);
          }
        }
      }
    }

    if (setCookieHeader) {
      const headers = new Headers(response.headers);
      headers.append("Set-Cookie", setCookieHeader);
      headers.set("Cache-Control", "no-store");
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  },

  async queue(batch, env, ctx) {
    if (env.WEBMENTION_INBOX) {
      await webmentionFor(env).consumer(batch, env, ctx);
    }
    ctx.waitUntil(syncMicropubBridge(env));
  },

  async scheduled(_event, env, ctx) {
    // @dwk/webmention has no scheduled arm — verification runs off the queue.
    // The cron exists for the Micropub bridge's retry sync.
    ctx.waitUntil(syncMicropubBridge(env));
  },
};

export default worker;

class CountryInjector {
  constructor(country) {
    this.country = country;
  }
  element(el) {
    el.append(`<meta name="cf-country" content="${this.country}">`, { html: true });
  }
}

// ---------------------------------------------------------------------------
// Webmention edge-render helpers (§3.5 of the active-IndieWeb design)
// ---------------------------------------------------------------------------

// Only note and blog-post permalinks can be webmention targets. The collection
// index pages (`/notes`, `/blog`) are excluded — the trailing-slash strip means
// a bare `/notes` never matches `"/notes/"`.
function isWebmentionTarget(pathname) {
  const p = pathname.replace(/\/+$/, "");
  return p.startsWith("/notes/") || p.startsWith("/blog/");
}

// The set of target URLs that have at least one verified mention, cached per
// WEBMENTION_INBOX binding so each isolate runs the list() scan at
// most once per TTL — every other note/post request is an in-memory set
// lookup. New mentions therefore appear within a minute, which is fine for
// content that's already verified asynchronously. A query failure serves the
// stale set (or an empty one) rather than breaking the page render.
const WEBMENTION_TARGETS_TTL_MS = 60_000;
const webmentionTargetsCache = new WeakMap();

// `dbKey` is the WEBMENTION_INBOX binding (the stable cache key); `inbox` is the
// createD1Inbox reader over it. Each isolate runs the full list() scan at most
// once per TTL — every other note/post request is an in-memory set lookup. A
// failure serves the stale (or empty) set rather than breaking the render.
async function loadWebmentionTargets(dbKey, inbox) {
  const cached = webmentionTargetsCache.get(dbKey);
  if (cached && cached.expires > Date.now()) return cached.targets;
  try {
    const mentions = await inbox.list();
    const targets = new Set(mentions.map((m) => m.target));
    webmentionTargetsCache.set(dbKey, {
      targets,
      expires: Date.now() + WEBMENTION_TARGETS_TTL_MS,
    });
    return targets;
  } catch (err) {
    console.error("Webmention target-set query failed:", err?.message);
    return cached?.targets ?? new Set();
  }
}

// Verified mentions of a target URL via the @dwk/webmention inbox. A failure
// degrades to "no mentions" so a transient inbox error never breaks the render.
async function loadWebmentions(inbox, target) {
  try {
    return await inbox.list(target);
  } catch (err) {
    console.error("Webmention edge-render query failed:", err?.message);
    return [];
  }
}

class WebmentionInjector {
  constructor(mentions) {
    this.mentions = mentions;
  }
  element(el) {
    const items = this.mentions.map(renderMention).join("");
    el.setInnerContent(
      `<h2 class="webmentions-title">Mentions</h2>` +
        `<ol class="webmentions-list">${items}</ol>`,
      { html: true },
    );
  }
}

// Render one verified mention. @dwk/webmention stores only { source, target,
// verifiedAt } — no author or content — so a mention is a link to the mentioning
// page, shown by its host. `source` comes from an arbitrary external site, so it
// must pass the http(s) scheme allow-list before reaching an href, and the
// anchor is `nofollow ugc noopener` (untrusted, user-generated). A source that
// isn't a safe http(s) URL is dropped entirely.
export function renderMention(m) {
  const href = safeUrl(m.source);
  if (!href) return "";
  // safeUrl already returned a normalized, valid URL string, so re-parsing for
  // the display host cannot throw.
  const host = new URL(href).host;
  return (
    `<li class="h-cite">` +
    `<a class="u-url" rel="nofollow ugc noopener noreferrer" href="${escapeHtml(href)}">${escapeHtml(host)}</a>` +
    `</li>`
  );
}

// Return the URL only if it parses to an http(s) URL, else null. Blocks
// javascript:/data:/vbscript:/mailto: and any other scheme from reaching an
// href/src attribute. Relative URLs are rejected (no base to resolve against
// here); webmention source URLs are absolute in practice.
export function safeUrl(value) {
  if (!value) return null;
  try {
    const u = new URL(String(value).trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// ---------------------------------------------------------------------------
// Membership helpers (mirrors template/scripts/membership.ts)
// ---------------------------------------------------------------------------

function readCookie(cookieHeader, name) {
  for (const piece of cookieHeader.split(";")) {
    const trimmed = piece.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function isPremiumRoute(pathname, routes) {
  if (!routes || routes.length === 0) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  for (const entry of routes) {
    if (entry.endsWith("/*")) {
      const prefix = entry.slice(0, -2);
      if (normalized === prefix || normalized.startsWith(prefix + "/")) return true;
    } else {
      const e = entry.replace(/\/+$/, "") || "/";
      if (normalized === e) return true;
    }
  }
  return false;
}

function unlockRedirect(originalPath, search) {
  const target = `/unlock?return=${encodeURIComponent(originalPath + search)}`;
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function verifyMembershipCookie(value, signingKeyHex) {
  if (!value || !signingKeyHex) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;

  const payloadB64 = value.slice(0, dot);
  const sigHex = value.slice(dot + 1);
  if (!/^[0-9a-f]+$/i.test(sigHex)) return null;

  let payloadBytes;
  try {
    payloadBytes = base64urlDecode(payloadB64);
  } catch {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(signingKeyHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(sigHex),
    payloadBytes,
  );
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== "number") return null;
  if (payload.exp * 1000 < Date.now()) return null;
  if (payload.tier !== "free" && payload.tier !== "paid") return null;
  return payload;
}

// ---------------------------------------------------------------------------
// A/B experiment helpers (mirrors template/scripts/experiments.ts)
// ---------------------------------------------------------------------------

async function loadActiveExperiment(kv, pathname) {
  const configJson = await kv.get("active-experiments");
  if (!configJson) return null;
  let experiments;
  try {
    experiments = JSON.parse(configJson);
  } catch {
    return null;
  }
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    experiments.find((exp) => exp.active && exp.page === normalized) ?? null
  );
}

function parseVariantCookie(cookieHeader, experimentId) {
  const name = `exp_${experimentId}`;
  for (const pair of cookieHeader.split(/;\s*/)) {
    const [key, ...rest] = pair.split("=");
    if (key.trim() === name) return rest.join("=").trim();
  }
  return undefined;
}

function serializeVariantCookie(experimentId, variant) {
  return `exp_${experimentId}=${variant}; Path=/; SameSite=Lax; HttpOnly; Secure`;
}

function assignVariant(variants, weights) {
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative) return variants[i];
  }
  return variants[variants.length - 1];
}

function resolveVariantPath(pathname, variant) {
  if (variant === "control") return pathname;
  const normalized = pathname.replace(/\/+$/, "") || "";
  const base = normalized === "" ? "/" : normalized + "/";
  return `${base}index.${variant}.html`;
}

function buildImpressionDataPoint(experimentId, variant, sessionId) {
  return {
    indexes: [experimentId],
    blobs: [variant, "impression", sessionId],
    doubles: [1],
  };
}

function hashSession(request) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ua = request.headers.get("User-Agent") ?? "unknown";
  const date = new Date().toISOString().slice(0, 10);
  let hash = 0;
  const str = `${ip}:${ua}:${date}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
