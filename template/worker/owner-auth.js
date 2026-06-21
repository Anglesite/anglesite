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

// --- request-bound consent token -------------------------------------------

// HMAC over a canonical client_id|redirect_uri|scope|exp string. The token is
// delivered to the owner's browser only after it POSTs through /auth/consent, so
// a client can't pre-fabricate `&_consent=…` to skip the visible consent screen.
function consentMessage({ clientId, redirectUri, scope }, exp) {
  return new TextEncoder().encode(
    [clientId, redirectUri, scope ?? "", exp].join("|"),
  );
}

export async function mintConsentToken(keyHex, req, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const key = await hmacKey(keyHex, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, consentMessage(req, exp));
  return `${exp}.${bytesToHex(sig)}`;
}

export async function verifyConsentToken(token, keyHex, req) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  const sigHex = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  if (!/^[0-9a-f]+$/i.test(sigHex)) return false;
  const key = await hmacKey(keyHex, ["verify"]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(sigHex),
    consentMessage(req, exp),
  );
}

// --- single-use backup codes (OWNER_AUTH_DB) -------------------------------

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(d);
}

// Codes are high-entropy (10 bytes → 50 bits over a 32-symbol alphabet), emitted
// uppercase and grouped `XXXXX-XXXXX` for legibility on a printed sheet.
function randomCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (no I L O U)
  const s = [...bytes].map((x) => A[x % 32]).join("");
  return `${s.slice(0, 5)}-${s.slice(5, 10)}`;
}

async function ensureBackupTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS owner_backup_codes (` +
        `code_hash TEXT PRIMARY KEY, created_at INTEGER, used_at INTEGER)`,
    )
    .run();
}

// Generate `n` codes, store only their hashes, and return the plaintext ONCE for
// the owner to print. Callers must never persist the returned plaintext.
export async function generateBackupCodes(db, n = 10) {
  await ensureBackupTable(db);
  const now = Math.floor(Date.now() / 1000);
  const codes = [];
  for (let i = 0; i < n; i++) {
    const code = randomCode();
    codes.push(code);
    await db
      .prepare(
        `INSERT INTO owner_backup_codes (code_hash, created_at, used_at) VALUES (?1, ?2, NULL)`,
      )
      .bind(await sha256Hex(code), now)
      .run();
  }
  return codes;
}

// Redeem a code: true on a first, valid redemption; false for unknown, already
// used, or empty. Normalizes case/whitespace to match the emitted form.
export async function redeemBackupCode(db, code) {
  if (!code) return false;
  const hash = await sha256Hex(String(code).trim().toUpperCase());
  const row = await db
    .prepare(
      `SELECT code_hash FROM owner_backup_codes WHERE code_hash = ?1 AND used_at IS NULL`,
    )
    .bind(hash)
    .first();
  if (!row) return false;
  await db
    .prepare(
      `UPDATE owner_backup_codes SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL`,
    )
    .bind(hash, Math.floor(Date.now() / 1000))
    .run();
  return true;
}
