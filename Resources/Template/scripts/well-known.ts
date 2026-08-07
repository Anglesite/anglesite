#!/usr/bin/env npx tsx
/**
 * Template side of the `/.well-known/` build seam (#744, transport from #748).
 *
 * The app/deploy orchestrator — not this script — assembles the *complete* effective claim
 * inventory, because Worker activation lives in the package's `Config/` and provider capabilities
 * are host-side; neither is present inside the site's runtime clone. Before the build it hands
 * this script an ephemeral, non-secret `WellKnownClaimManifest` and asks for two things back
 * (docs/superpowers/specs/2026-07-14-well-known-support-design.md §"Delivery rules", steps 2 and 6):
 *
 *   `check`  — run at **prebuild, before any generator writes**. Rescans the actual runtime clone's
 *              `public/.well-known/` and rejects a static file that shadows a `dynamic` or
 *              `externalRuntime` claim. The host scanned its own working tree; the guest holds a
 *              clone of git `HEAD`, so a collision can exist here that the host never saw. Exits
 *              non-zero on such a collision, which stops the build before generation.
 *   `verify` — run at **postbuild**. Reports the exact `dist/.well-known/...` artifacts the build
 *              actually produced, so the orchestrator can verify every static/generated claim
 *              landed and flag any artifact with no matching claim.
 *
 * Both modes are a **no-op unless the seam env vars are set**, so an ordinary `npm run build`
 * (dev, CI, `npm run build:ci`) is completely unaffected.
 *
 * Contract notes:
 * - `ANGLESITE_WELLKNOWN_CLAIM_MANIFEST` holds a path to the manifest JSON; absent means "no
 *   orchestrator on the other end" and every mode returns immediately.
 * - `ANGLESITE_WELLKNOWN_RESULT_PATH` holds the path to write the result JSON to. Both modes
 *   merge into whatever is already there, so `check`'s findings survive `verify`'s rewrite.
 * - This script must never print the runtime's result marker itself — the runtime shell emits it
 *   exactly once after the build exits (see `ContainerDeployExecutor.wellKnownResultMarker`).
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAtprotoDidOwned, isMTAStsMarkerOwned, isSecurityTxtMarkerOwned } from "./edge-artifacts";

/** Mirrors `WellKnownClaimManifest.environmentVariableName`. */
export const MANIFEST_ENV_VAR = "ANGLESITE_WELLKNOWN_CLAIM_MANIFEST";
/** Mirrors `WellKnownClaimManifest.resultPathEnvironmentVariable`. */
export const RESULT_PATH_ENV_VAR = "ANGLESITE_WELLKNOWN_RESULT_PATH";

/**
 * Mirrors `WellKnownInventory.defaultMaxFileSizeBytes`. Generous for text-based protocol documents
 * while still bounding what an unreviewed static file can commit to the origin's namespace.
 */
export const MAX_FILE_SIZE_BYTES = 64 * 1024;

/** One entry of the ephemeral manifest — mirrors `WellKnownClaimManifest.Entry`. */
export interface ClaimEntry {
  id: string;
  /** Relative to `.well-known/` itself: no leading slash, no `.well-known/` prefix. */
  path: string;
  match: "exact" | "prefix";
  owner: string;
  /** Raw value of `WellKnownEndpointDescriptor.Delivery`. */
  delivery: "userStatic" | "generated" | "dynamic" | "externalRuntime";
}

/** Mirrors `WellKnownBuildSeamResult.Finding`. */
export interface Finding {
  path?: string;
  message: string;
}

/** Mirrors `WellKnownBuildSeamResult`. */
export interface SeamResult {
  observedArtifacts: string[];
  /** The subset of `observedArtifacts` carrying an Anglesite generator's content marker. */
  generatedArtifacts: string[];
  findings: Finding[];
}

/**
 * Parses a manifest JSON blob. Never throws: a malformed or unexpectedly shaped blob yields no
 * entries rather than failing the build, matching #748's "malformed results degrade" contract on
 * the other direction of this same seam. Entries missing `delivery` default to `userStatic`, which
 * is the non-blocking classification — this script must not invent a collision out of a field an
 * older orchestrator never sent.
 */
export function parseClaimManifest(json: string): ClaimEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const out: ClaimEntry[] = [];
  for (const raw of entries) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.path !== "string" || typeof entry.owner !== "string") continue;
    out.push({
      id: typeof entry.id === "string" ? entry.id : entry.path,
      path: entry.path,
      match: entry.match === "prefix" ? "prefix" : "exact",
      owner: entry.owner,
      delivery:
        entry.delivery === "generated" || entry.delivery === "dynamic" || entry.delivery === "externalRuntime"
          ? entry.delivery
          : "userStatic",
    });
  }
  return out;
}

/**
 * Recursively lists files under `dir`, returning paths relative to `dir` (POSIX separators, no
 * leading slash) plus findings for anything excluded. A missing directory yields nothing — a site
 * need not have any `.well-known` content.
 *
 * Exclusions mirror `WellKnownInventory.scanUserStatic` exactly, so the guest's view of what
 * counts as an inventoried file matches the host's: symlinks, percent-encoded-looking names (a
 * real filesystem can't hold `..` or an empty segment, but such a name could still smuggle a
 * traversal segment past a later URL-facing consumer that decodes it), paths that resolve outside
 * the root, and files over `maxFileSizeBytes`.
 */
export function scanWellKnown(
  dir: string,
  maxFileSizeBytes: number = MAX_FILE_SIZE_BYTES,
): { paths: string[]; findings: Finding[] } {
  const paths: string[] = [];
  const findings: Finding[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { paths, findings };
  const root = resolvedPath(dir);

  const walk = (current: string, prefix: string[]): void => {
    let entries: string[];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const relPath = [...prefix, name].join("/");
      const full = resolve(current, name);
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) {
        findings.push({ path: relPath, message: "symlink not allowed under .well-known/ — excluded from inventory" });
        continue;
      }
      if (name.includes("%")) {
        findings.push({
          path: relPath,
          message: "percent-encoded-looking filename not allowed under .well-known/ — excluded from inventory",
        });
        continue;
      }
      if (stats.isDirectory()) {
        walk(full, [...prefix, name]);
        continue;
      }
      // Compare *resolved* paths on both sides, mirroring Swift's `resolvingSymlinksInPath()`:
      // the scan root itself often lives under a symlinked ancestor (macOS `/var` → `/private/var`
      // is the everyday case), so comparing a raw join against a resolved root would reject every
      // real file. Direct symlinks are already excluded above, so this only catches a genuine
      // escape through a resolved ancestor.
      const resolvedFull = resolvedPath(full);
      if (!(resolvedFull === root || resolvedFull.startsWith(root + "/"))) {
        findings.push({ path: relPath, message: "resolved path escapes .well-known/ root — excluded from inventory" });
        continue;
      }
      if (stats.size > maxFileSizeBytes) {
        findings.push({ path: relPath, message: `file exceeds ${maxFileSizeBytes} bytes — excluded from inventory` });
        continue;
      }
      paths.push(relPath);
    }
  };
  walk(dir, []);
  return { paths, findings };
}

function resolvedPath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

/** The manifest entries that cover `path`: an exact match, or a prefix claim containing it. */
export function claimsCovering(entries: ClaimEntry[], path: string): ClaimEntry[] {
  return entries.filter((entry) => {
    if (entry.match === "exact") return entry.path === path;
    const prefix = entry.path.endsWith("/") ? entry.path : entry.path + "/";
    return path.startsWith(prefix);
  });
}

/**
 * Classifies each static file the runtime clone actually holds against the effective claim set.
 *
 * `blocking` findings are the design doc's "a dynamic route and same-path static output conflict
 * even if the current host would choose one" rule, caught at the one moment the host cannot: after
 * the clone materializes and before any generator writes. There is no precedence recovery — the
 * finding names both owners and the caller stops the build.
 *
 * `advisory` findings cover a static file with no claim at all, which is drift between the host's
 * working tree (what the orchestrator scanned) and the clone's git `HEAD` — worth surfacing, never
 * worth blocking a deploy over.
 */
export function classifyStaticPaths(
  entries: ClaimEntry[],
  staticPaths: string[],
): { blocking: Finding[]; advisory: Finding[] } {
  const blocking: Finding[] = [];
  const advisory: Finding[] = [];
  for (const path of staticPaths) {
    const covering = claimsCovering(entries, path);
    if (covering.length === 0) {
      advisory.push({
        path,
        message:
          `.well-known/${path} exists in the built source but has no matching inventory claim ` +
          "— the deploying working tree and the committed source may have drifted",
      });
      continue;
    }
    for (const claim of covering) {
      if (claim.delivery !== "dynamic" && claim.delivery !== "externalRuntime") continue;
      blocking.push({
        path,
        message:
          `.well-known/${path} (static file in the site source) collides with ` +
          `/.well-known/${claim.path} claimed by ${claim.owner} (${claim.delivery})`,
      });
    }
  }
  return { blocking, advisory };
}

// --- result-file I/O ---

/** A fresh empty result — a function, not a shared const, so no caller can mutate the arrays. */
const emptyResult = (): SeamResult => ({ observedArtifacts: [], generatedArtifacts: [], findings: [] });

/** Reads whatever result JSON already exists at `path`, degrading to an empty result. */
export function readSeamResult(path: string): SeamResult {
  if (!existsSync(path)) return emptyResult();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return emptyResult();
  }
  const record = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    observedArtifacts: stringArray(record.observedArtifacts),
    generatedArtifacts: stringArray(record.generatedArtifacts),
    findings: Array.isArray(record.findings)
      ? (record.findings as unknown[]).flatMap((value) => {
          if (typeof value !== "object" || value === null) return [];
          const finding = value as Record<string, unknown>;
          if (typeof finding.message !== "string") return [];
          return [{ path: typeof finding.path === "string" ? finding.path : undefined, message: finding.message }];
        })
      : [],
  };
}

/** Merges `addition` into whatever is already at `path` and writes the result back. */
export function mergeSeamResult(path: string, addition: Partial<SeamResult>): SeamResult {
  const existing = readSeamResult(path);
  const merged: SeamResult = {
    observedArtifacts: [...new Set([...existing.observedArtifacts, ...(addition.observedArtifacts ?? [])])].sort(),
    generatedArtifacts: [...new Set([...existing.generatedArtifacts, ...(addition.generatedArtifacts ?? [])])].sort(),
    findings: [...existing.findings, ...(addition.findings ?? [])],
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged), "utf-8");
  return merged;
}

// --- modes ---

/**
 * Prebuild mode. Returns the process exit code: 1 when the clone holds a static file that shadows
 * a dynamic or runtime-owned claim, 0 otherwise (including "no seam configured").
 *
 * On a blocking collision the result file carries **only** the blocking findings, so the
 * orchestrator's rule stays unambiguous: a non-zero build exit plus a non-empty finding list means
 * "these are the collisions that stopped the build," never a mix of collisions and advisories.
 */
export function runCheck(cwd: string, env: NodeJS.ProcessEnv): number {
  const manifestPath = env[MANIFEST_ENV_VAR];
  const resultPath = env[RESULT_PATH_ENV_VAR];
  if (!manifestPath || !existsSync(manifestPath)) return 0;

  const entries = parseClaimManifest(readFileSync(manifestPath, "utf-8"));
  const scan = scanWellKnown(resolve(cwd, "public/.well-known"));
  const { blocking, advisory } = classifyStaticPaths(entries, scan.paths);

  if (resultPath) {
    mergeSeamResult(resultPath, { findings: blocking.length > 0 ? blocking : [...scan.findings, ...advisory] });
  }
  for (const finding of blocking) console.error(`well-known collision: ${finding.message}`);
  return blocking.length > 0 ? 1 : 0;
}

/**
 * Postbuild mode. Records the exact `dist/.well-known/...` artifacts the build produced so the
 * orchestrator can verify each static/generated claim landed. Always succeeds — deciding what a
 * missing or unexpected artifact means is the orchestrator's job
 * (`WellKnownInventory.verifyBuildArtifacts`), not this script's.
 *
 * Artifacts carrying an Anglesite generator's marker are reported separately: those files are
 * written by `edge-artifacts.ts` during *this* prebuild, so the host-side inventory could not have
 * seen them and must not read them as unclaimed.
 */
export function runVerify(cwd: string, env: NodeJS.ProcessEnv): number {
  const manifestPath = env[MANIFEST_ENV_VAR];
  const resultPath = env[RESULT_PATH_ENV_VAR];
  if (!manifestPath || !resultPath) return 0;

  const distWellKnown = resolve(cwd, "dist/.well-known");
  const scan = scanWellKnown(distWellKnown);
  const generated = scan.paths.filter((path) => isGeneratedArtifact(resolve(distWellKnown, path)));
  mergeSeamResult(resultPath, {
    observedArtifacts: scan.paths,
    generatedArtifacts: generated,
    findings: scan.findings,
  });
  return 0;
}

/**
 * True when the file at `fullPath` carries one of Anglesite's generator content markers — the same
 * marker predicates `edge-artifacts.ts` uses to decide it owns an existing file, and that
 * `GeneratedEndpoints` mirrors on the Swift side.
 */
function isGeneratedArtifact(fullPath: string): boolean {
  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    return false;
  }
  return isSecurityTxtMarkerOwned(content) || isMTAStsMarkerOwned(content) || isAtprotoDidOwned(content);
}

function main(argv: string[]): void {
  const mode = argv[2];
  if (mode !== "check" && mode !== "verify") {
    console.error("usage: npx tsx scripts/well-known.ts <check|verify>");
    process.exit(2);
  }
  const code = mode === "check" ? runCheck(process.cwd(), process.env) : runVerify(process.cwd(), process.env);
  if (code !== 0) process.exit(code);
}

// Run only when invoked directly (e.g. `npx tsx scripts/well-known.ts check`), never on import.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
