import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// sharp is an OPTIONAL native dep (#361)
//
// The MCP server's boot graph reaches optimize-images.mjs via
// apply-edit-dispatcher.mjs. A top-level `import sharp` there means a missing
// `sharp` (stale/partial node_modules) throws ERR_MODULE_NOT_FOUND during graph
// load and takes down the whole server before it ever listens. sharp must load
// lazily so only the image-optimization tool fails — at call time, with a clear
// message — when it's absent.
//
// We simulate sharp's absence with an ESM resolution hook (fixtures/sharp-absent)
// run in a subprocess, so the test is faithful even though sharp is installed in
// the dev/CI environment.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const REGISTER = join(__dirname, "fixtures", "sharp-absent", "register.mjs");
const DISPATCHER = join(REPO_ROOT, "server", "apply-edit-dispatcher.mjs");
const OPTIMIZE = join(REPO_ROOT, "server", "optimize-images.mjs");

/** Run a snippet in a subprocess with `sharp` made unresolvable. Returns stdout. */
function runWithoutSharp(snippet) {
  try {
    return execFileSync(
      process.execPath,
      ["--import", REGISTER, "--input-type=module", "-e", snippet],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
  } catch (e) {
    // execFileSync only surfaces "Command failed" on a non-zero exit; pull the
    // real stderr/stdout forward so a CI failure here is diagnosable.
    throw new Error(`subprocess failed:\n${e.stderr ?? ""}\n${e.stdout ?? ""}`, { cause: e });
  }
}

describe("sharp is optional (#361)", () => {
  it("loads the apply_edit boot module graph when sharp is absent", () => {
    const out = runWithoutSharp(
      `import(${JSON.stringify(DISPATCHER)})` +
        `.then((m) => console.log(typeof m.applyEdit === "function" ? "BOOT_OK" : "BOOT_BAD"))`,
    );
    expect(out).toContain("BOOT_OK");
  });

  it("fails image optimization at call time with an actionable sharp error", () => {
    const out = runWithoutSharp(
      `const { optimizeImage } = await import(${JSON.stringify(OPTIMIZE)});` +
        `try { await optimizeImage("/nonexistent.jpg", { outputDir: "/tmp" }); console.log("NO_THROW"); }` +
        `catch (e) { console.log("ERR:" + e.message); }`,
    );
    expect(out).toContain("ERR:");
    expect(out.toLowerCase()).toContain("sharp");
    expect(out).not.toContain("NO_THROW");
  });
});
