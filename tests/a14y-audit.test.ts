import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  buildA14yArgs,
  parseCliArgs,
  resolveTargetUrl,
  runA14y,
  translateExitCode,
} from "../template/scripts/a14y-audit.js";

// ---------------------------------------------------------------------------
// buildA14yArgs
// ---------------------------------------------------------------------------

describe("buildA14yArgs", () => {
  it("includes the URL as the first argument", () => {
    expect(buildA14yArgs({ url: "https://example.com" })).toEqual(["https://example.com"]);
  });

  it("forwards --fail-under when provided", () => {
    expect(
      buildA14yArgs({ url: "https://example.com", failUnder: "80" }),
    ).toEqual(["https://example.com", "--fail-under", "80"]);
  });

  it("omits --fail-under when the value is empty", () => {
    expect(buildA14yArgs({ url: "https://example.com", failUnder: "" })).toEqual([
      "https://example.com",
    ]);
  });

  it("appends --json when requested", () => {
    expect(buildA14yArgs({ url: "https://example.com", json: true })).toEqual([
      "https://example.com",
      "--json",
    ]);
  });

  it("appends passthrough args last so they override defaults", () => {
    expect(
      buildA14yArgs({
        url: "https://example.com",
        failUnder: "80",
        passthrough: ["--format", "markdown"],
      }),
    ).toEqual(["https://example.com", "--fail-under", "80", "--format", "markdown"]);
  });
});

// ---------------------------------------------------------------------------
// resolveTargetUrl
// ---------------------------------------------------------------------------

describe("resolveTargetUrl", () => {
  it("prefers an explicit CLI URL", () => {
    expect(resolveTargetUrl("https://staging.example.com", "example.com.local")).toBe(
      "https://staging.example.com",
    );
  });

  it("falls back to DEV_HOSTNAME with https scheme", () => {
    expect(resolveTargetUrl(undefined, "example.com.local")).toBe(
      "https://example.com.local",
    );
  });

  it("falls back to localhost when nothing is configured", () => {
    expect(resolveTargetUrl(undefined, undefined)).toBe("http://localhost:4321");
  });

  it("ignores empty CLI URLs", () => {
    expect(resolveTargetUrl("", "example.com.local")).toBe("https://example.com.local");
  });
});

// ---------------------------------------------------------------------------
// translateExitCode
// ---------------------------------------------------------------------------

describe("translateExitCode", () => {
  it("passes through exit codes by default", () => {
    expect(translateExitCode(0, false)).toBe(0);
    expect(translateExitCode(1, false)).toBe(1);
    expect(translateExitCode(127, false)).toBe(127);
  });

  it("forces 0 when warn-only is set", () => {
    expect(translateExitCode(0, true)).toBe(0);
    expect(translateExitCode(1, true)).toBe(0);
    expect(translateExitCode(127, true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  it("returns defaults for an empty argv", () => {
    expect(parseCliArgs([])).toEqual({ json: false, warnOnly: false, passthrough: [] });
  });

  it("captures --url, --fail-under, --json, --warn-only", () => {
    const result = parseCliArgs([
      "--url",
      "https://example.com",
      "--fail-under",
      "75",
      "--json",
      "--warn-only",
    ]);
    expect(result.url).toBe("https://example.com");
    expect(result.failUnder).toBe("75");
    expect(result.json).toBe(true);
    expect(result.warnOnly).toBe(true);
    expect(result.passthrough).toEqual([]);
  });

  it("collects unknown flags as passthrough", () => {
    expect(parseCliArgs(["--format", "markdown"])).toEqual({
      json: false,
      warnOnly: false,
      passthrough: ["--format", "markdown"],
    });
  });

  it("treats everything after -- as passthrough", () => {
    expect(parseCliArgs(["--json", "--", "--fail-under", "10"])).toEqual({
      json: true,
      warnOnly: false,
      passthrough: ["--fail-under", "10"],
    });
  });
});

// ---------------------------------------------------------------------------
// runA14y — mock spawn so we don't depend on the real CLI being installed
// ---------------------------------------------------------------------------

interface FakeChild extends EventEmitter {
  stdio?: unknown;
}

function makeFakeSpawn(opts: { exitCode?: number; errorCode?: string }) {
  return ((..._args: unknown[]) => {
    const child: FakeChild = new EventEmitter();
    setImmediate(() => {
      if (opts.errorCode) {
        const err = new Error("spawn failure") as NodeJS.ErrnoException;
        err.code = opts.errorCode;
        child.emit("error", err);
      } else {
        child.emit("exit", opts.exitCode ?? 0);
      }
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("runA14y", () => {
  it("resolves with the child's exit code on success", async () => {
    const code = await runA14y(["https://example.com"], {
      spawnFn: makeFakeSpawn({ exitCode: 0 }),
    });
    expect(code).toBe(0);
  });

  it("propagates non-zero exit codes from a14y", async () => {
    const code = await runA14y(["https://example.com", "--fail-under", "90"], {
      spawnFn: makeFakeSpawn({ exitCode: 1 }),
    });
    expect(code).toBe(1);
  });

  it("returns 127 when the binary is missing (ENOENT)", async () => {
    const code = await runA14y(["https://example.com"], {
      spawnFn: makeFakeSpawn({ errorCode: "ENOENT" }),
    });
    expect(code).toBe(127);
  });

  it("returns 1 for other spawn errors", async () => {
    const code = await runA14y(["https://example.com"], {
      spawnFn: makeFakeSpawn({ errorCode: "EACCES" }),
    });
    expect(code).toBe(1);
  });
});
