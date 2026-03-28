/**
 * Cloudflare Worker — Ecommerce webhook receiver.
 *
 * Receives order completion webhooks from ecommerce platforms,
 * verifies their authenticity, and logs revenue data to
 * Cloudflare Analytics Engine for upgrade path assessment.
 *
 * Routes:
 *   POST /webhook/snipcart     — Snipcart order.completed
 *   POST /webhook/stripe       — Stripe checkout.session.completed
 *   POST /webhook/shopify      — Shopify orders/paid
 *   POST /webhook/polar        — Polar order.paid
 *   POST /webhook/lemonsqueezy — Lemon Squeezy order_created
 *   POST /webhook/paddle       — Paddle transaction.completed
 *
 * Environment variables (set via wrangler secret):
 *   SNIPCART_SECRET_KEY     — Snipcart secret API key (for callback validation)
 *   STRIPE_WEBHOOK_SECRET   — Stripe webhook signing secret (whsec_...)
 *   SHOPIFY_WEBHOOK_SECRET  — Shopify app secret
 *   POLAR_WEBHOOK_SECRET    — Polar webhook secret (base64-encoded)
 *   LS_WEBHOOK_SECRET       — Lemon Squeezy webhook signing secret
 *   PADDLE_WEBHOOK_SECRET   — Paddle webhook secret (pdl_ntfset_...)
 *
 * Bindings:
 *   ANALYTICS — Analytics Engine dataset binding
 */

// ---------------------------------------------------------------------------
// HMAC helpers (Web Crypto API)
// ---------------------------------------------------------------------------

async function hmacSha256(key, message) {
  const keyData =
    typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Signature verification per platform
// ---------------------------------------------------------------------------

async function verifySnipcart(request, env) {
  const token = request.headers.get("X-Snipcart-RequestToken");
  if (!token || !env.SNIPCART_SECRET_KEY) return false;

  const url = `https://app.snipcart.com/api/requestvalidation/${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization:
        "Basic " + btoa(env.SNIPCART_SECRET_KEY + ":"),
      Accept: "application/json",
    },
  });
  return resp.ok;
}

async function verifyStripe(rawBody, request, env) {
  const header = request.headers.get("Stripe-Signature");
  if (!header || !env.STRIPE_WEBHOOK_SECRET) return false;

  let timestamp = 0;
  const signatures = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (Math.abs(age) > 300) return false;

  const hmac = await hmacSha256(env.STRIPE_WEBHOOK_SECRET, `${timestamp}.${rawBody}`);
  const expected = toHex(hmac);
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

async function verifyShopify(rawBody, request, env) {
  const header = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!header || !env.SHOPIFY_WEBHOOK_SECRET) return false;

  const hmac = await hmacSha256(env.SHOPIFY_WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(header, toBase64(hmac));
}

async function verifyPolar(rawBody, request, env) {
  const sigHeader = request.headers.get("webhook-signature");
  const webhookId = request.headers.get("webhook-id");
  const webhookTs = request.headers.get("webhook-timestamp");
  if (!sigHeader || !webhookId || !webhookTs || !env.POLAR_WEBHOOK_SECRET) return false;

  const ts = Number(webhookTs);
  if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const secretBytes = Uint8Array.from(atob(env.POLAR_WEBHOOK_SECRET), (c) =>
    c.charCodeAt(0),
  );
  const hmac = await hmacSha256(secretBytes, `${webhookId}.${webhookTs}.${rawBody}`);
  const expected = toBase64(hmac);

  return sigHeader
    .split(" ")
    .filter((s) => s.startsWith("v1,"))
    .map((s) => s.slice(3))
    .some((sig) => timingSafeEqual(sig, expected));
}

async function verifyLemonSqueezy(rawBody, request, env) {
  const header = request.headers.get("X-Signature");
  if (!header || !env.LS_WEBHOOK_SECRET) return false;

  const hmac = await hmacSha256(env.LS_WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(header, toHex(hmac));
}

async function verifyPaddle(rawBody, request, env) {
  const header = request.headers.get("Paddle-Signature");
  if (!header || !env.PADDLE_WEBHOOK_SECRET) return false;

  let timestamp = "";
  const signatures = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (key === "ts") timestamp = value;
    else if (key === "h1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const hmac = await hmacSha256(env.PADDLE_WEBHOOK_SECRET, `${timestamp}:${rawBody}`);
  const expected = toHex(hmac);
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

// ---------------------------------------------------------------------------
// Payload parsing — extract order data
// ---------------------------------------------------------------------------

function parseSnipcartOrder(body) {
  if (body.eventName !== "order.completed") return null;
  const c = body.content;
  if (!c || typeof c.finalGrandTotal !== "number") return null;
  return {
    provider: "snipcart",
    amountCents: Math.round(c.finalGrandTotal * 100),
    currency: String(c.currency ?? "USD"),
    orderId: String(c.token ?? ""),
  };
}

function parseStripeOrder(body) {
  if (body.type !== "checkout.session.completed") return null;
  const obj = body.data?.object;
  if (!obj || typeof obj.amount_total !== "number") return null;
  return {
    provider: "stripe",
    amountCents: obj.amount_total,
    currency: String(obj.currency ?? "usd"),
    orderId: String(obj.id ?? ""),
  };
}

function parseShopifyOrder(body) {
  if (body.total_price === undefined) return null;
  return {
    provider: "shopify",
    amountCents: Math.round(Number(body.total_price) * 100),
    currency: String(body.currency ?? "USD"),
    orderId: String(body.id ?? ""),
  };
}

function parsePolarOrder(body) {
  if (body.type !== "order.paid") return null;
  const d = body.data;
  if (!d || typeof d.amount !== "number") return null;
  return {
    provider: "polar",
    amountCents: d.amount,
    currency: String(d.currency ?? "usd"),
    orderId: String(d.id ?? ""),
  };
}

function parseLemonSqueezyOrder(body) {
  if (body.meta?.event_name !== "order_created") return null;
  const attrs = body.data?.attributes;
  if (!attrs || typeof attrs.total !== "number") return null;
  return {
    provider: "lemonsqueezy",
    amountCents: attrs.total,
    currency: String(attrs.currency ?? "USD"),
    orderId: String(body.data?.id ?? ""),
  };
}

function parsePaddleOrder(body) {
  if (body.event_type !== "transaction.completed") return null;
  const grandTotal = body.data?.details?.totals?.grand_total;
  if (grandTotal === undefined) return null;
  return {
    provider: "paddle",
    amountCents: Number(grandTotal),
    currency: String(body.data?.currency_code ?? "USD"),
    orderId: String(body.data?.id ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const ROUTES = {
  "/webhook/snipcart": {
    verify: verifySnipcart,
    parse: parseSnipcartOrder,
    needsRawForVerify: false,
  },
  "/webhook/stripe": {
    verify: verifyStripe,
    parse: parseStripeOrder,
    needsRawForVerify: true,
  },
  "/webhook/shopify": {
    verify: verifyShopify,
    parse: parseShopifyOrder,
    needsRawForVerify: true,
  },
  "/webhook/polar": {
    verify: verifyPolar,
    parse: parsePolarOrder,
    needsRawForVerify: true,
  },
  "/webhook/lemonsqueezy": {
    verify: verifyLemonSqueezy,
    parse: parseLemonSqueezyOrder,
    needsRawForVerify: true,
  },
  "/webhook/paddle": {
    verify: verifyPaddle,
    parse: parsePaddleOrder,
    needsRawForVerify: true,
  },
};

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (!route) {
      return new Response("Not found", { status: 404 });
    }

    // Read raw body once
    const rawBody = await request.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Verify signature
    let valid;
    if (route.needsRawForVerify) {
      valid = await route.verify(rawBody, request, env);
    } else {
      valid = await route.verify(request, env);
    }

    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse order data
    const order = route.parse(body);
    if (!order) {
      // Valid webhook but not a payment event we track — acknowledge it
      return new Response(JSON.stringify({ ok: true, tracked: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Write to Analytics Engine
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        indexes: ["ecommerce-revenue"],
        blobs: [order.provider, order.currency.toUpperCase(), order.orderId],
        doubles: [order.amountCents],
      });
    }

    return new Response(JSON.stringify({ ok: true, tracked: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};
