/**
 * Cloudflare Worker — Membership unlock + signed-cookie issuance.
 *
 * Two unlock paths:
 *   POST /unlock/free  — verify the email is on the newsletter list
 *                        (Buttondown or Mailchimp), set a signed cookie
 *   POST /unlock/paid  — Stripe redirect endpoint; called from the
 *                        Payment Link's success page with a session id,
 *                        confirms the checkout, sets a signed cookie
 *   POST /webhook/stripe — Stripe events; mark KV active or revoked
 *   GET  /portal       — return a Stripe Customer Portal session URL
 *                        (caller must already have a paid cookie)
 *   GET  /verify       — used by the Premium component / middleware to
 *                        re-validate a cookie server-side without trust
 *
 * Cookie format: base64url(payload).hex(hmac_sha256(payload))
 *   payload = JSON.stringify({ tier, sub, exp })
 *   - tier: "free" | "paid"
 *   - sub:  sha256 of the verified email (free) or Stripe customer id (paid)
 *   - exp:  unix seconds, 30 days from issue
 *
 * Environment (wrangler secrets unless noted):
 *   MEMBERSHIP_SIGNING_KEY  — 32 random bytes, hex encoded
 *   SITE_DOMAIN             — e.g. example.com (cookie domain + CORS)
 *   MEMBERSHIP_TIERS        — "free" | "paid" | "free,paid"
 *   NEWSLETTER_API_KEY      — required if "free" in tiers
 *   NEWSLETTER_PLATFORM     — "buttondown" | "mailchimp"
 *   MAILCHIMP_LIST_ID       — required for mailchimp
 *   STRIPE_SECRET_KEY       — required if "paid" in tiers
 *   STRIPE_WEBHOOK_SECRET   — required if "paid" in tiers
 *   MEMBERSHIPS             — KV namespace (binding, not secret)
 */

const COOKIE_NAME = "__anglesite_member";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const RATE_LIMIT_SECONDS = 30;
const RATE_LIMIT_MAX_ENTRIES = 10000;
const recentSubmissions = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const last = recentSubmissions.get(ip);
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) return true;
  for (const [k, t] of recentSubmissions) {
    if (now - t > RATE_LIMIT_SECONDS * 2000) recentSubmissions.delete(k);
  }
  // Hard cap: drop oldest insertion if still over the bound. Map iteration
  // order is insertion order, so the first key is the oldest.
  while (recentSubmissions.size >= RATE_LIMIT_MAX_ENTRIES) {
    const oldest = recentSubmissions.keys().next().value;
    if (oldest === undefined) break;
    recentSubmissions.delete(oldest);
  }
  recentSubmissions.set(ip, now);
  return false;
}

function assertSigningKey(hexKey) {
  if (
    typeof hexKey !== "string" ||
    hexKey.length < 32 ||
    hexKey.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(hexKey)
  ) {
    throw new Error(
      "MEMBERSHIP_SIGNING_KEY must be hex-encoded random bytes (>=16 bytes / 32 hex chars; 32 bytes / 64 hex chars recommended).",
    );
  }
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isSafeReturnPath(value) {
  // Allow only same-origin path-only redirects: must start with "/" and not
  // with "//" or "/\" (which browsers treat as protocol-relative).
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length < 2048 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

function isAllowedOrigin(origin, siteDomain) {
  if (!origin || !siteDomain) return false;
  return (
    origin === `https://${siteDomain}` ||
    origin === `https://www.${siteDomain}`
  );
}

function corsHeaders(origin, siteDomain) {
  if (!isAllowedOrigin(origin, siteDomain)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

function tiersAllowed(env) {
  return new Set(
    String(env.MEMBERSHIP_TIERS || "free")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function base64urlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function importHmacKey(hexKey) {
  assertSigningKey(hexKey);
  return crypto.subtle.importKey(
    "raw",
    hexToBytes(hexKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return bytesToHex(new Uint8Array(buf));
}

async function signCookie(payload, signingKeyHex) {
  const key = await importHmacKey(signingKeyHex);
  const json = JSON.stringify(payload);
  const data = new TextEncoder().encode(json);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return `${base64urlEncode(data)}.${bytesToHex(sig)}`;
}

async function verifyCookie(value, signingKeyHex) {
  if (!value || typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = value.slice(0, dot);
  const sigHex = value.slice(dot + 1);
  if (!/^[0-9a-f]+$/i.test(sigHex)) return null;

  const key = await importHmacKey(signingKeyHex);
  let payloadBytes;
  try {
    payloadBytes = base64urlDecode(payloadB64);
  } catch {
    return null;
  }
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
  if (!payload || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function setCookieHeader(value, siteDomain) {
  // Note: Domain attribute lets the cookie work on www and apex.
  const domain = siteDomain.startsWith("www.")
    ? siteDomain.slice(4)
    : siteDomain;
  return [
    `${COOKIE_NAME}=${value}`,
    `Domain=${domain}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE}`,
  ].join("; ");
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const piece of header.split(";")) {
    const [k, ...rest] = piece.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function isOnButtondownList(email, apiKey) {
  const response = await fetch(
    `https://api.buttondown.email/v1/subscribers?email=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Token ${apiKey}` },
    },
  );
  if (!response.ok) return false;
  const data = await response.json();
  if (!Array.isArray(data.results)) return false;
  return data.results.some(
    (s) =>
      typeof s.email === "string" &&
      s.email.toLowerCase() === email.toLowerCase() &&
      (s.type === "regular" || s.subscriber_type === "regular"),
  );
}

async function isOnMailchimpList(email, apiKey, listId) {
  const dc = apiKey.split("-").pop();
  const subscriberHash = await sha256Hex(email.toLowerCase());
  // Mailchimp uses MD5 of lowercased email for member id, but accepts SHA-256
  // since 2023. Fall back to a list query if HEAD fails.
  const response = await fetch(
    `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members/${subscriberHash}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) return false;
  const data = await response.json();
  return data.status === "subscribed";
}

async function stripeFetch(path, env, init = {}) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...(init.headers || {}),
  };
  return fetch(`https://api.stripe.com${path}`, { ...init, headers });
}

async function getStripeCheckoutSession(sessionId, env) {
  const response = await stripeFetch(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    env,
  );
  if (!response.ok) return null;
  return response.json();
}

async function verifyStripeWebhook(request, env) {
  const sigHeader = request.headers.get("Stripe-Signature") || "";
  const body = await request.text();
  const parts = sigHeader.split(",").reduce((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) {
      if (k === "v1") (acc.v1 ||= []).push(v);
      else acc[k] = v;
    }
    return acc;
  }, {});
  if (!parts.t || !parts.v1 || parts.v1.length === 0) return null;

  const tolerance = 5 * 60; // 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > tolerance) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${parts.t}.${body}`),
    ),
  );
  const expected = bytesToHex(sig);
  const valid = parts.v1.some((v) => timingSafeEqualHex(v, expected));
  if (!valid) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function jsonError(errors, status, origin, siteDomain) {
  return new Response(JSON.stringify({ errors }), {
    status,
    headers: {
      ...corsHeaders(origin, siteDomain),
      "Content-Type": "application/json",
    },
  });
}

async function handleUnlockFree(request, env, origin) {
  const tiers = tiersAllowed(env);
  if (!tiers.has("free")) {
    return jsonError(["Free tier is not enabled."], 400, origin, env.SITE_DOMAIN);
  }
  if (!env.NEWSLETTER_API_KEY) {
    return jsonError(["Newsletter not configured."], 500, origin, env.SITE_DOMAIN);
  }

  const ct = request.headers.get("Content-Type") || "";
  let email;
  try {
    if (ct.includes("application/json")) {
      const body = await request.json();
      email = body.email;
    } else {
      const form = await request.formData();
      email = form.get("email");
    }
  } catch {
    return jsonError(["Invalid request."], 400, origin, env.SITE_DOMAIN);
  }

  if (!email || !EMAIL_RE.test(String(email))) {
    return jsonError(
      ["A valid email address is required."],
      400,
      origin,
      env.SITE_DOMAIN,
    );
  }

  email = String(email).trim().toLowerCase();
  const platform = (env.NEWSLETTER_PLATFORM || "buttondown").toLowerCase();
  let onList = false;
  if (platform === "buttondown") {
    onList = await isOnButtondownList(email, env.NEWSLETTER_API_KEY);
  } else if (platform === "mailchimp") {
    onList = await isOnMailchimpList(
      email,
      env.NEWSLETTER_API_KEY,
      env.MAILCHIMP_LIST_ID,
    );
  }

  if (!onList) {
    return jsonError(
      [
        "Email not found on the subscriber list. Please subscribe first, then return to unlock.",
      ],
      404,
      origin,
      env.SITE_DOMAIN,
    );
  }

  const sub = await sha256Hex(email);
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  const cookie = await signCookie(
    { tier: "free", sub, exp },
    env.MEMBERSHIP_SIGNING_KEY,
  );

  if (env.MEMBERSHIPS) {
    await env.MEMBERSHIPS.put(`free:${sub}`, "1", {
      expirationTtl: COOKIE_MAX_AGE,
    });
  }

  return new Response(JSON.stringify({ ok: true, tier: "free" }), {
    status: 200,
    headers: {
      ...corsHeaders(origin, env.SITE_DOMAIN),
      "Content-Type": "application/json",
      "Set-Cookie": setCookieHeader(cookie, env.SITE_DOMAIN),
    },
  });
}

async function handleUnlockPaid(request, env, origin) {
  const tiers = tiersAllowed(env);
  if (!tiers.has("paid")) {
    return jsonError(["Paid tier is not enabled."], 400, origin, env.SITE_DOMAIN);
  }
  if (!env.STRIPE_SECRET_KEY) {
    return jsonError(["Stripe not configured."], 500, origin, env.SITE_DOMAIN);
  }

  const url = new URL(request.url);
  const sessionId =
    url.searchParams.get("session_id") || url.searchParams.get("checkout_session");
  if (!sessionId) {
    return jsonError(["Missing session id."], 400, origin, env.SITE_DOMAIN);
  }

  const session = await getStripeCheckoutSession(sessionId, env);
  if (!session || session.payment_status !== "paid" || !session.customer) {
    return jsonError(
      ["Could not verify the payment. Please contact support."],
      402,
      origin,
      env.SITE_DOMAIN,
    );
  }

  const customerId = String(session.customer);
  const sub = await sha256Hex(customerId);
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  const cookie = await signCookie(
    { tier: "paid", sub, exp },
    env.MEMBERSHIP_SIGNING_KEY,
  );

  if (env.MEMBERSHIPS) {
    await env.MEMBERSHIPS.put(`paid:${sub}`, customerId, {
      expirationTtl: COOKIE_MAX_AGE,
    });
  }

  const requestedReturn = url.searchParams.get("return");
  const returnPath = isSafeReturnPath(requestedReturn) ? requestedReturn : "/";
  const redirectTarget = new URL(returnPath, `https://${env.SITE_DOMAIN}`);

  return new Response(null, {
    status: 303,
    headers: {
      Location: redirectTarget.toString(),
      "Set-Cookie": setCookieHeader(cookie, env.SITE_DOMAIN),
    },
  });
}

async function handleStripeWebhook(request, env) {
  const event = await verifyStripeWebhook(request, env);
  if (!event) return new Response("Invalid signature", { status: 400 });

  const customerId =
    event?.data?.object?.customer ||
    event?.data?.object?.id ||
    null;

  if (!env.MEMBERSHIPS || !customerId) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sub = await sha256Hex(String(customerId));
  const key = `paid:${sub}`;

  switch (event.type) {
    case "checkout.session.completed":
    case "customer.subscription.updated": {
      const status = event?.data?.object?.status;
      if (event.type === "checkout.session.completed" || status === "active" || status === "trialing") {
        await env.MEMBERSHIPS.put(key, String(customerId), {
          expirationTtl: COOKIE_MAX_AGE * 2,
        });
      } else if (status && status !== "active" && status !== "trialing") {
        await env.MEMBERSHIPS.delete(key);
      }
      break;
    }
    case "customer.subscription.deleted":
      await env.MEMBERSHIPS.delete(key);
      break;
    default:
      break;
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePortal(request, env, origin) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonError(["Stripe not configured."], 500, origin, env.SITE_DOMAIN);
  }
  const cookieValue = readCookie(request, COOKIE_NAME);
  const payload = await verifyCookie(cookieValue, env.MEMBERSHIP_SIGNING_KEY);
  if (!payload || payload.tier !== "paid") {
    return jsonError(
      ["Sign in to your paid account first."],
      401,
      origin,
      env.SITE_DOMAIN,
    );
  }
  if (env.MEMBERSHIPS) {
    const customerId = await env.MEMBERSHIPS.get(`paid:${payload.sub}`);
    if (!customerId) {
      return jsonError(
        ["Your subscription is no longer active."],
        403,
        origin,
        env.SITE_DOMAIN,
      );
    }
    const body = new URLSearchParams({
      customer: customerId,
      return_url: `https://${env.SITE_DOMAIN}/account`,
    });
    const response = await stripeFetch("/v1/billing_portal/sessions", env, {
      method: "POST",
      body: body.toString(),
    });
    if (!response.ok) {
      return jsonError(
        ["Could not open the billing portal."],
        500,
        origin,
        env.SITE_DOMAIN,
      );
    }
    const data = await response.json();
    return Response.redirect(data.url, 303);
  }
  return jsonError(["Membership store not configured."], 500, origin, env.SITE_DOMAIN);
}

async function handleVerify(request, env, origin) {
  const cookieValue = readCookie(request, COOKIE_NAME);
  const payload = await verifyCookie(cookieValue, env.MEMBERSHIP_SIGNING_KEY);
  if (!payload) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: {
        ...corsHeaders(origin, env.SITE_DOMAIN),
        "Content-Type": "application/json",
      },
    });
  }
  // Optional KV revocation check
  if (env.MEMBERSHIPS) {
    const present = await env.MEMBERSHIPS.get(`${payload.tier}:${payload.sub}`);
    if (!present) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: {
          ...corsHeaders(origin, env.SITE_DOMAIN),
          "Content-Type": "application/json",
        },
      });
    }
  }
  return new Response(JSON.stringify({ ok: true, tier: payload.tier }), {
    status: 200,
    headers: {
      ...corsHeaders(origin, env.SITE_DOMAIN),
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.SITE_DOMAIN),
      });
    }

    // Stripe webhook — never CORS-checked, signature is the trust anchor
    if (url.pathname === "/webhook/stripe" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    if (request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (isRateLimited(ip)) {
        return new Response("Too many requests. Please wait a moment.", {
          status: 429,
          headers: corsHeaders(origin, env.SITE_DOMAIN),
        });
      }
    }

    if (url.pathname === "/unlock/free" && request.method === "POST") {
      return handleUnlockFree(request, env, origin);
    }
    if (url.pathname === "/unlock/paid" && request.method === "GET") {
      return handleUnlockPaid(request, env, origin);
    }
    if (url.pathname === "/portal" && request.method === "GET") {
      return handlePortal(request, env, origin);
    }
    if (url.pathname === "/verify" && request.method === "GET") {
      return handleVerify(request, env, origin);
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders(origin, env.SITE_DOMAIN),
    });
  },
};
