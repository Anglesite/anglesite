/**
 * Owner session cookie (#363, problem 2). A signed cookie proving the owner
 * authenticated via passkey/backup-code, mirroring the membership HMAC pattern.
 */
import { describe, it, expect } from "vitest";
import {
  issueOwnerSession,
  verifyOwnerSession,
} from "../template/worker/owner-auth.js";

const KEY = "00112233445566778899aabbccddeeff";

describe("owner session cookie", () => {
  it("round-trips a valid session", async () => {
    const v = await issueOwnerSession(KEY, 900);
    const p = await verifyOwnerSession(v, KEY);
    expect(p?.sub).toBe("owner");
    expect(p?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a tampered payload", async () => {
    const v = await issueOwnerSession(KEY, 900);
    const [, sig] = v.split(".");
    expect(await verifyOwnerSession("ZXZpbA." + sig, KEY)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const v = await issueOwnerSession(KEY, -1);
    expect(await verifyOwnerSession(v, KEY)).toBeNull();
  });

  it("rejects under a different key", async () => {
    const v = await issueOwnerSession(KEY, 900);
    expect(
      await verifyOwnerSession(v, "ffffffffffffffffffffffffffffffff"),
    ).toBeNull();
  });

  it("rejects empty / malformed input", async () => {
    expect(await verifyOwnerSession("", KEY)).toBeNull();
    expect(await verifyOwnerSession("nodothere", KEY)).toBeNull();
  });
});
