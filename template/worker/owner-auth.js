/**
 * Owner-side authentication helpers for the passkey-backed IndieAuth flow
 * (configured by /anglesite:indieweb). These are the state @dwk/indieauth
 * deliberately leaves to the deployer:
 *
 *   - the signed owner-session cookie (proof the owner authenticated), and
 *   - the request-bound consent token (proof the owner approved THIS request),
 *   - single-use printable backup codes (a recovery factor).
 *
 * All crypto is WebCrypto HMAC-SHA-256 / SHA-256 — no package dependencies. The
 * session cookie mirrors the membership-cookie pattern in site-entry.js.
 */

export const OWNER_COOKIE = "__anglesite_owner";

// --- byte/encoding helpers -------------------------------------------------

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64urlEncode(bytes) {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new Uint8Array([...bin].map((c) => c.charCodeAt(0)));
}

async function hmacKey(hex, usages) {
  return crypto.subtle.importKey(
    "raw",
    hexToBytes(hex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

// --- owner session cookie --------------------------------------------------

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
  try {
    payloadBytes = b64urlDecode(payloadB64);
  } catch {
    return null;
  }
  const key = await hmacKey(signingKeyHex, ["verify"]);
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
