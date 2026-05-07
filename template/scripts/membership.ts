/**
 * Membership cookie verification for the edge middleware.
 *
 * Mirrors the signing logic in `worker/membership-worker.js`. The Pages
 * middleware verifies the same cookie that the Worker issues, using the
 * same `MEMBERSHIP_SIGNING_KEY`. Both sides use HMAC-SHA256 over the
 * JSON payload, base64url(payload).hex(sig).
 *
 * Set up by `/anglesite:membership` — the owner sets the same signing
 * key as a Cloudflare Pages environment variable so the middleware can
 * verify cookies without an extra round trip to the Worker.
 */

export interface MembershipPayload {
  tier: "free" | "paid";
  sub: string;
  exp: number;
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function importHmacKey(hexKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    hexToBytes(hexKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * Verify a `__anglesite_member` cookie value. Returns the decoded
 * payload when the HMAC and `exp` are valid, or null otherwise.
 */
export async function verifyMembershipCookie(
  value: string | null | undefined,
  signingKeyHex: string | undefined,
): Promise<MembershipPayload | null> {
  if (!value || !signingKeyHex) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;

  const payloadB64 = value.slice(0, dot);
  const sigHex = value.slice(dot + 1);
  if (!/^[0-9a-f]+$/i.test(sigHex)) return null;

  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64urlDecode(payloadB64);
  } catch {
    return null;
  }

  const key = await importHmacKey(signingKeyHex);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(sigHex),
    payloadBytes,
  );
  if (!ok) return null;

  let payload: MembershipPayload;
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

/**
 * Read a single cookie value out of a Cookie header.
 */
export function readCookie(
  cookieHeader: string,
  name: string,
): string | null {
  for (const piece of cookieHeader.split(";")) {
    const trimmed = piece.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

/**
 * Decide whether `pathname` is gated by membership.
 *
 * `routes` is the build-time route list emitted by
 * `scripts/build-premium-routes.ts`. Each entry is either a literal
 * pathname (`/posts/premium-post`) or a glob-style prefix ending in
 * `/*` (`/members/*`).
 */
export function isPremiumRoute(
  pathname: string,
  routes: readonly string[],
): boolean {
  if (!routes || routes.length === 0) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  for (const entry of routes) {
    if (entry.endsWith("/*")) {
      const prefix = entry.slice(0, -2);
      if (normalized === prefix || normalized.startsWith(prefix + "/")) {
        return true;
      }
    } else {
      const e = entry.replace(/\/+$/, "") || "/";
      if (normalized === e) return true;
    }
  }
  return false;
}

/**
 * Serialize the redirect to /unlock with the original path preserved.
 */
export function unlockRedirect(originalPath: string, search: string): Response {
  const target = `/unlock?return=${encodeURIComponent(originalPath + search)}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
    },
  });
}
