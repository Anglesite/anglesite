// ---------------------------------------------------------------------------
// Webhook signature verification and payload parsing for ecommerce platforms
// ---------------------------------------------------------------------------

import type { EcommerceProvider } from "./ecommerce-revenue.js";

// ---------------------------------------------------------------------------
// HMAC helpers (use Web Crypto API, available in Cloudflare Workers)
// ---------------------------------------------------------------------------

/** Compute HMAC-SHA256 and return the raw ArrayBuffer */
async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  message: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

/** Hex-encode an ArrayBuffer */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Base64-encode an ArrayBuffer */
function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/** Timing-safe comparison of two strings */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Stripe — Stripe-Signature: t=<timestamp>,v1=<hex_hmac>
// ---------------------------------------------------------------------------

/** Parse the Stripe-Signature header into timestamp and signatures */
export function parseStripeSignatureHeader(header: string): {
  timestamp: number;
  signatures: string[];
} {
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  return { timestamp, signatures };
}

/**
 * Verify a Stripe webhook signature.
 * @param rawBody - The raw request body string
 * @param header - The Stripe-Signature header value
 * @param secret - The webhook signing secret (whsec_...)
 * @param toleranceSec - Maximum age of the event in seconds (default 300)
 */
export async function verifyStripeWebhook(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const { timestamp, signatures } = parseStripeSignatureHeader(header);
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (age > toleranceSec || age < -toleranceSec) return false;

  const payload = `${timestamp}.${rawBody}`;
  const hmac = await hmacSha256(new TextEncoder().encode(secret), payload);
  const expected = toHex(hmac);

  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

// ---------------------------------------------------------------------------
// Shopify — X-Shopify-Hmac-Sha256: <base64_hmac>
// ---------------------------------------------------------------------------

/**
 * Verify a Shopify webhook signature.
 * @param rawBody - The raw request body string
 * @param header - The X-Shopify-Hmac-Sha256 header value
 * @param secret - The Shopify app secret key
 */
export async function verifyShopifyWebhook(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const hmac = await hmacSha256(new TextEncoder().encode(secret), rawBody);
  const expected = toBase64(hmac);
  return timingSafeEqual(header, expected);
}

// ---------------------------------------------------------------------------
// Polar — Standard Webhooks (svix): webhook-signature: v1,<base64_hmac>
// Signing payload: <webhook-id>.<webhook-timestamp>.<body>
// Secret is base64-encoded; must decode before use as HMAC key
// ---------------------------------------------------------------------------

/**
 * Verify a Polar webhook signature (Standard Webhooks / svix).
 * @param rawBody - The raw request body string
 * @param signatureHeader - The webhook-signature header (v1,<base64>)
 * @param webhookId - The webhook-id header
 * @param webhookTimestamp - The webhook-timestamp header (Unix seconds)
 * @param secret - The webhook secret (base64-encoded)
 * @param toleranceSec - Maximum age in seconds (default 300)
 */
export async function verifyPolarWebhook(
  rawBody: string,
  signatureHeader: string,
  webhookId: string,
  webhookTimestamp: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const ts = Number(webhookTimestamp);
  if (isNaN(ts)) return false;

  const age = Math.floor(Date.now() / 1000) - ts;
  if (age > toleranceSec || age < -toleranceSec) return false;

  // Decode the base64-encoded secret
  const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));

  const payload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const hmac = await hmacSha256(secretBytes, payload);
  const expected = toBase64(hmac);

  // Header may contain multiple signatures separated by spaces
  const signatures = signatureHeader
    .split(" ")
    .filter((s) => s.startsWith("v1,"))
    .map((s) => s.slice(3));

  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

// ---------------------------------------------------------------------------
// Lemon Squeezy — X-Signature: <hex_hmac>
// ---------------------------------------------------------------------------

/**
 * Verify a Lemon Squeezy webhook signature.
 * @param rawBody - The raw request body string
 * @param header - The X-Signature header value (hex-encoded)
 * @param secret - The webhook signing secret
 */
export async function verifyLemonSqueezyWebhook(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const hmac = await hmacSha256(new TextEncoder().encode(secret), rawBody);
  const expected = toHex(hmac);
  return timingSafeEqual(header, expected);
}

// ---------------------------------------------------------------------------
// Paddle (Billing v2) — Paddle-Signature: ts=<timestamp>;h1=<hex_hmac>
// ---------------------------------------------------------------------------

/** Parse the Paddle-Signature header */
export function parsePaddleSignatureHeader(header: string): {
  timestamp: string;
  signatures: string[];
} {
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (key === "ts") timestamp = value;
    else if (key === "h1") signatures.push(value);
  }
  return { timestamp, signatures };
}

/**
 * Verify a Paddle webhook signature.
 * @param rawBody - The raw request body string
 * @param header - The Paddle-Signature header value
 * @param secret - The webhook secret key
 * @param toleranceSec - Maximum age in seconds (default 300)
 */
export async function verifyPaddleWebhook(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const { timestamp, signatures } = parsePaddleSignatureHeader(header);
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (isNaN(ts)) return false;

  const age = Math.floor(Date.now() / 1000) - ts;
  if (age > toleranceSec || age < -toleranceSec) return false;

  const payload = `${timestamp}:${rawBody}`;
  const hmac = await hmacSha256(new TextEncoder().encode(secret), payload);
  const expected = toHex(hmac);

  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

// ---------------------------------------------------------------------------
// Snipcart — callback-based verification (no HMAC)
// ---------------------------------------------------------------------------

/**
 * Build the Snipcart token validation URL.
 * Snipcart webhooks are verified by calling back to their API.
 * The caller must make a GET request to this URL with Basic Auth
 * (API key as username, empty password).
 *
 * @param requestToken - The X-Snipcart-RequestToken header value
 * @returns The validation URL
 */
export function buildSnipcartValidationUrl(requestToken: string): string {
  return `https://app.snipcart.com/api/requestvalidation/${encodeURIComponent(requestToken)}`;
}

// ---------------------------------------------------------------------------
// Payload parsing — extract revenue data from each platform's webhook body
// ---------------------------------------------------------------------------

/** Normalized order data extracted from any platform's webhook payload */
export interface OrderData {
  provider: EcommerceProvider;
  amountCents: number;
  currency: string;
  orderId: string;
}

/**
 * Parse the webhook payload for a given provider and extract order data.
 * Returns null if the event type is not a completed payment or the payload
 * is missing required fields.
 */
export function parseWebhookPayload(
  provider: EcommerceProvider,
  body: Record<string, unknown>,
): OrderData | null {
  switch (provider) {
    case "snipcart":
      return parseSnipcartPayload(body);
    case "stripe":
      return parseStripePayload(body);
    case "shopify":
      return parseShopifyPayload(body);
    case "polar":
      return parsePolarPayload(body);
    case "lemonsqueezy":
      return parseLemonSqueezyPayload(body);
    case "paddle":
      return parsePaddlePayload(body);
    default:
      return null;
  }
}

function parseSnipcartPayload(body: Record<string, unknown>): OrderData | null {
  if (body.eventName !== "order.completed") return null;
  const content = body.content as Record<string, unknown> | undefined;
  if (!content) return null;
  const total = content.finalGrandTotal;
  if (typeof total !== "number") return null;
  return {
    provider: "snipcart",
    amountCents: Math.round(total * 100),
    currency: String(content.currency ?? "USD"),
    orderId: String(content.token ?? ""),
  };
}

function parseStripePayload(body: Record<string, unknown>): OrderData | null {
  if (body.type !== "checkout.session.completed") return null;
  const data = body.data as Record<string, unknown> | undefined;
  const obj = data?.object as Record<string, unknown> | undefined;
  if (!obj) return null;
  const amount = obj.amount_total;
  if (typeof amount !== "number") return null;
  return {
    provider: "stripe",
    amountCents: amount,
    currency: String(obj.currency ?? "usd"),
    orderId: String(obj.id ?? ""),
  };
}

function parseShopifyPayload(body: Record<string, unknown>): OrderData | null {
  // Shopify sends the order object directly (no event wrapper)
  const totalPrice = body.total_price;
  if (totalPrice === undefined) return null;
  return {
    provider: "shopify",
    amountCents: Math.round(Number(totalPrice) * 100),
    currency: String(body.currency ?? "USD"),
    orderId: String(body.id ?? ""),
  };
}

function parsePolarPayload(body: Record<string, unknown>): OrderData | null {
  if (body.type !== "order.paid") return null;
  const data = body.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const amount = data.amount;
  if (typeof amount !== "number") return null;
  return {
    provider: "polar",
    amountCents: amount,
    currency: String(data.currency ?? "usd"),
    orderId: String(data.id ?? ""),
  };
}

function parseLemonSqueezyPayload(
  body: Record<string, unknown>,
): OrderData | null {
  const meta = body.meta as Record<string, unknown> | undefined;
  if (meta?.event_name !== "order_created") return null;
  const data = body.data as Record<string, unknown> | undefined;
  const attrs = data?.attributes as Record<string, unknown> | undefined;
  if (!attrs) return null;
  const total = attrs.total;
  if (typeof total !== "number") return null;
  return {
    provider: "lemonsqueezy",
    amountCents: total,
    currency: String(attrs.currency ?? "USD"),
    orderId: String(data?.id ?? ""),
  };
}

function parsePaddlePayload(body: Record<string, unknown>): OrderData | null {
  if (body.event_type !== "transaction.completed") return null;
  const data = body.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const details = data.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  if (!totals) return null;
  const grandTotal = totals.grand_total;
  if (grandTotal === undefined) return null;
  return {
    provider: "paddle",
    amountCents: Number(grandTotal),
    currency: String(data.currency_code ?? "USD"),
    orderId: String(data.id ?? ""),
  };
}
