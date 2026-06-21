/**
 * approveAuthorization + consent (#363, problem 2). The consent token binds an
 * approval to one specific authorization request so a malicious client can't
 * deep-link past the visible consent screen.
 */
import { describe, it, expect } from "vitest";
import {
  mintConsentToken,
  verifyConsentToken,
} from "../template/worker/owner-auth.js";

const KEY = "00112233445566778899aabbccddeeff";
const REQ = {
  clientId: "https://app.example",
  redirectUri: "https://app.example/cb",
  scope: "create",
};

describe("consent token", () => {
  it("verifies a token bound to the same request", async () => {
    const t = await mintConsentToken(KEY, REQ, 300);
    expect(await verifyConsentToken(t, KEY, REQ)).toBe(true);
  });

  it("rejects when a bound field differs", async () => {
    const t = await mintConsentToken(KEY, REQ, 300);
    expect(await verifyConsentToken(t, KEY, { ...REQ, scope: "create media" })).toBe(false);
    expect(
      await verifyConsentToken(t, KEY, { ...REQ, redirectUri: "https://evil.example/cb" }),
    ).toBe(false);
  });

  it("rejects an expired token", async () => {
    const t = await mintConsentToken(KEY, REQ, -1);
    expect(await verifyConsentToken(t, KEY, REQ)).toBe(false);
  });

  it("rejects a malformed token", async () => {
    expect(await verifyConsentToken("", KEY, REQ)).toBe(false);
    expect(await verifyConsentToken("nodot", KEY, REQ)).toBe(false);
  });
});
