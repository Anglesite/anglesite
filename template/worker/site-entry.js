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
 *
 * Every feature is gated on its binding/var being present, so a site that
 * hasn't run any of these skills serves identically to a bare ASSETS-only
 * worker (one extra hop, no behavior change).
 *
 * Bindings (configured in wrangler.jsonc):
 *   ASSETS                       — Static assets fetcher (always present)
 *   EXPERIMENTS (KV, optional)   — Active A/B experiment config
 *   ANALYTICS   (AED, optional)  — Impression event stream
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
 */

import premiumRoutes from "./_premium-routes.json";

const COOKIE_NAME = "__anglesite_member";

export default {
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
};

class CountryInjector {
  constructor(country) {
    this.country = country;
  }
  element(el) {
    el.append(`<meta name="cf-country" content="${this.country}">`, { html: true });
  }
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
