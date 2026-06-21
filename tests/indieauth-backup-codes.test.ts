/**
 * Printable single-use backup codes (#363, problem 2 — recovery factor). Hashed
 * in OWNER_AUTH_DB; redeemable exactly once.
 */
import { describe, it, expect } from "vitest";
import {
  generateBackupCodes,
  redeemBackupCode,
} from "../template/worker/owner-auth.js";

// Minimal in-memory D1 fake: prepare(sql).bind(...).run()/first()/all().
function fakeD1() {
  const rows: any[] = [];
  return {
    prepare(sql: string) {
      const stmt: any = {
        _args: [] as any[],
        bind(...a: any[]) {
          stmt._args = a;
          return stmt;
        },
        async run() {
          if (/INSERT/.test(sql)) {
            rows.push({ code_hash: stmt._args[0], used_at: null });
          } else if (/UPDATE/.test(sql)) {
            const r = rows.find((x) => x.code_hash === stmt._args[0] && !x.used_at);
            if (r) r.used_at = stmt._args[1];
          }
          return { success: true };
        },
        async first() {
          if (/SELECT/.test(sql)) {
            return rows.find((x) => x.code_hash === stmt._args[0] && !x.used_at) ?? null;
          }
          return null;
        },
        async all() {
          return { results: rows };
        },
      };
      return stmt;
    },
  } as any;
}

describe("backup codes", () => {
  it("generates N distinct codes and redeems each exactly once", async () => {
    const db = fakeD1();
    const codes = await generateBackupCodes(db, 10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    expect(await redeemBackupCode(db, codes[0])).toBe(true);
    expect(await redeemBackupCode(db, codes[0])).toBe(false); // single-use
    expect(await redeemBackupCode(db, codes[1])).toBe(true);
  });

  it("rejects an unknown code without leaking which", async () => {
    const db = fakeD1();
    await generateBackupCodes(db, 3);
    expect(await redeemBackupCode(db, "ZZZZZ-ZZZZZ")).toBe(false);
    expect(await redeemBackupCode(db, "")).toBe(false);
  });

  it("redeems case-insensitively (codes are emitted uppercase)", async () => {
    const db = fakeD1();
    const [code] = await generateBackupCodes(db, 1);
    expect(await redeemBackupCode(db, code.toLowerCase())).toBe(true);
  });
});
