import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseStripeSignatureHeader,
  verifyStripeWebhook,
  verifyShopifyWebhook,
  verifyPolarWebhook,
  verifyLemonSqueezyWebhook,
  parsePaddleSignatureHeader,
  verifyPaddleWebhook,
  buildSnipcartValidationUrl,
  parseWebhookPayload,
} from "../template/scripts/webhook-signatures.js";

// ---------------------------------------------------------------------------
// Helper: compute HMAC-SHA256 for building test fixtures
// ---------------------------------------------------------------------------

async function hmacHex(secret: string | Uint8Array, message: string): Promise<string> {
  const keyData = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64(secret: string | Uint8Array, message: string): Promise<string> {
  const keyData = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

describe("parseStripeSignatureHeader", () => {
  it("extracts timestamp and v1 signatures", () => {
    const result = parseStripeSignatureHeader("t=1234567890,v1=abc123,v1=def456");
    expect(result.timestamp).toBe(1234567890);
    expect(result.signatures).toEqual(["abc123", "def456"]);
  });

  it("returns 0 timestamp when missing", () => {
    const result = parseStripeSignatureHeader("v1=abc");
    expect(result.timestamp).toBe(0);
  });
});

describe("verifyStripeWebhook", () => {
  const secret = "whsec_test_secret";
  const body = '{"id":"evt_123"}';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a valid signature", async () => {
    const timestamp = 1700000000;
    vi.setSystemTime(timestamp * 1000);
    const sig = await hmacHex(secret, `${timestamp}.${body}`);
    const header = `t=${timestamp},v1=${sig}`;
    expect(await verifyStripeWebhook(body, header, secret)).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    const timestamp = 1700000000;
    vi.setSystemTime(timestamp * 1000);
    const header = `t=${timestamp},v1=invalidsignature`;
    expect(await verifyStripeWebhook(body, header, secret)).toBe(false);
  });

  it("rejects an expired timestamp", async () => {
    const timestamp = 1700000000;
    vi.setSystemTime((timestamp + 600) * 1000); // 10 min later
    const sig = await hmacHex(secret, `${timestamp}.${body}`);
    const header = `t=${timestamp},v1=${sig}`;
    expect(await verifyStripeWebhook(body, header, secret)).toBe(false);
  });

  it("rejects missing timestamp", async () => {
    vi.setSystemTime(1700000000 * 1000);
    expect(await verifyStripeWebhook(body, "v1=abc", secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

describe("verifyShopifyWebhook", () => {
  const secret = "shopify_test_secret";
  const body = '{"id":123,"total_price":"59.99"}';

  it("accepts a valid base64 signature", async () => {
    const sig = await hmacBase64(secret, body);
    expect(await verifyShopifyWebhook(body, sig, secret)).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    expect(await verifyShopifyWebhook(body, "invalidbase64sig==", secret)).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const sig = await hmacBase64("wrong_secret", body);
    expect(await verifyShopifyWebhook(body, sig, secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Polar (Standard Webhooks / svix)
// ---------------------------------------------------------------------------

describe("verifyPolarWebhook", () => {
  const rawSecret = "polar_test_secret_key_1234";
  const secret = btoa(rawSecret); // base64-encode the secret
  const body = '{"type":"order.paid","data":{"id":"ord_1"}}';
  const webhookId = "msg_abc123";
  const webhookTimestamp = "1700000000";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a valid signature", async () => {
    const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    const payload = `${webhookId}.${webhookTimestamp}.${body}`;
    const sig = await hmacBase64(secretBytes, payload);
    const header = `v1,${sig}`;
    expect(await verifyPolarWebhook(body, header, webhookId, webhookTimestamp, secret)).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    const header = "v1,invalidbase64==";
    expect(await verifyPolarWebhook(body, header, webhookId, webhookTimestamp, secret)).toBe(false);
  });

  it("rejects an expired timestamp", async () => {
    vi.setSystemTime(1700001000 * 1000); // 1000s later
    const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    const payload = `${webhookId}.${webhookTimestamp}.${body}`;
    const sig = await hmacBase64(secretBytes, payload);
    const header = `v1,${sig}`;
    expect(await verifyPolarWebhook(body, header, webhookId, webhookTimestamp, secret)).toBe(false);
  });

  it("accepts when one of multiple signatures matches", async () => {
    const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
    const payload = `${webhookId}.${webhookTimestamp}.${body}`;
    const sig = await hmacBase64(secretBytes, payload);
    const header = `v1,badsig== v1,${sig}`;
    expect(await verifyPolarWebhook(body, header, webhookId, webhookTimestamp, secret)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lemon Squeezy
// ---------------------------------------------------------------------------

describe("verifyLemonSqueezyWebhook", () => {
  const secret = "ls_test_secret";
  const body = '{"meta":{"event_name":"order_created"},"data":{"id":"1"}}';

  it("accepts a valid hex signature", async () => {
    const sig = await hmacHex(secret, body);
    expect(await verifyLemonSqueezyWebhook(body, sig, secret)).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    expect(await verifyLemonSqueezyWebhook(body, "deadbeef", secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Paddle
// ---------------------------------------------------------------------------

describe("parsePaddleSignatureHeader", () => {
  it("extracts timestamp and h1 signatures", () => {
    const result = parsePaddleSignatureHeader("ts=1700000000;h1=abc;h1=def");
    expect(result.timestamp).toBe("1700000000");
    expect(result.signatures).toEqual(["abc", "def"]);
  });
});

describe("verifyPaddleWebhook", () => {
  const secret = "pdl_ntfset_test";
  const body = '{"event_type":"transaction.completed"}';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a valid signature", async () => {
    const timestamp = "1700000000";
    vi.setSystemTime(1700000000 * 1000);
    const sig = await hmacHex(secret, `${timestamp}:${body}`);
    const header = `ts=${timestamp};h1=${sig}`;
    expect(await verifyPaddleWebhook(body, header, secret)).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    vi.setSystemTime(1700000000 * 1000);
    const header = "ts=1700000000;h1=invalid";
    expect(await verifyPaddleWebhook(body, header, secret)).toBe(false);
  });

  it("rejects an expired timestamp", async () => {
    const timestamp = "1700000000";
    vi.setSystemTime((1700000000 + 600) * 1000);
    const sig = await hmacHex(secret, `${timestamp}:${body}`);
    const header = `ts=${timestamp};h1=${sig}`;
    expect(await verifyPaddleWebhook(body, header, secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Snipcart validation URL
// ---------------------------------------------------------------------------

describe("buildSnipcartValidationUrl", () => {
  it("builds the correct validation URL", () => {
    const url = buildSnipcartValidationUrl("tok_abc123");
    expect(url).toBe("https://app.snipcart.com/api/requestvalidation/tok_abc123");
  });

  it("encodes special characters in the token", () => {
    const url = buildSnipcartValidationUrl("tok/with spaces");
    expect(url).toContain("tok%2Fwith%20spaces");
  });
});

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

describe("parseWebhookPayload", () => {
  describe("snipcart", () => {
    it("parses an order.completed event", () => {
      const result = parseWebhookPayload("snipcart", {
        eventName: "order.completed",
        content: {
          finalGrandTotal: 45.0,
          currency: "CAD",
          token: "snip_order_1",
        },
      });
      expect(result).toEqual({
        provider: "snipcart",
        amountCents: 4500,
        currency: "CAD",
        orderId: "snip_order_1",
      });
    });

    it("returns null for non-order events", () => {
      expect(parseWebhookPayload("snipcart", { eventName: "shippingrates.fetch" })).toBeNull();
    });

    it("returns null when content is missing", () => {
      expect(parseWebhookPayload("snipcart", { eventName: "order.completed" })).toBeNull();
    });
  });

  describe("stripe", () => {
    it("parses a checkout.session.completed event", () => {
      const result = parseWebhookPayload("stripe", {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_live_abc",
            amount_total: 9900,
            currency: "usd",
          },
        },
      });
      expect(result).toEqual({
        provider: "stripe",
        amountCents: 9900,
        currency: "usd",
        orderId: "cs_live_abc",
      });
    });

    it("returns null for other event types", () => {
      expect(
        parseWebhookPayload("stripe", { type: "payment_intent.created", data: { object: {} } }),
      ).toBeNull();
    });
  });

  describe("shopify", () => {
    it("parses an orders/paid payload", () => {
      const result = parseWebhookPayload("shopify", {
        id: 5678,
        total_price: "59.99",
        currency: "USD",
      });
      expect(result).toEqual({
        provider: "shopify",
        amountCents: 5999,
        currency: "USD",
        orderId: "5678",
      });
    });

    it("returns null when total_price is missing", () => {
      expect(parseWebhookPayload("shopify", { id: 123 })).toBeNull();
    });
  });

  describe("polar", () => {
    it("parses an order.paid event", () => {
      const result = parseWebhookPayload("polar", {
        type: "order.paid",
        data: {
          id: "pol_order_1",
          amount: 2500,
          currency: "usd",
        },
      });
      expect(result).toEqual({
        provider: "polar",
        amountCents: 2500,
        currency: "usd",
        orderId: "pol_order_1",
      });
    });

    it("returns null for other event types", () => {
      expect(parseWebhookPayload("polar", { type: "subscription.created", data: {} })).toBeNull();
    });
  });

  describe("lemonsqueezy", () => {
    it("parses an order_created event", () => {
      const result = parseWebhookPayload("lemonsqueezy", {
        meta: { event_name: "order_created" },
        data: {
          id: "ls_42",
          attributes: {
            total: 999,
            currency: "USD",
          },
        },
      });
      expect(result).toEqual({
        provider: "lemonsqueezy",
        amountCents: 999,
        currency: "USD",
        orderId: "ls_42",
      });
    });

    it("returns null for other events", () => {
      expect(
        parseWebhookPayload("lemonsqueezy", {
          meta: { event_name: "subscription_created" },
          data: { id: "1", attributes: { total: 999, currency: "USD" } },
        }),
      ).toBeNull();
    });
  });

  describe("paddle", () => {
    it("parses a transaction.completed event", () => {
      const result = parseWebhookPayload("paddle", {
        event_type: "transaction.completed",
        data: {
          id: "txn_abc",
          currency_code: "EUR",
          details: {
            totals: {
              grand_total: "1500",
            },
          },
        },
      });
      expect(result).toEqual({
        provider: "paddle",
        amountCents: 1500,
        currency: "EUR",
        orderId: "txn_abc",
      });
    });

    it("returns null for other event types", () => {
      expect(
        parseWebhookPayload("paddle", { event_type: "transaction.created", data: {} }),
      ).toBeNull();
    });
  });

  describe("unknown provider", () => {
    it("returns null", () => {
      expect(parseWebhookPayload("unknown" as any, {})).toBeNull();
    });
  });
});
