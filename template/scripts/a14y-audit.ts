/**
 * Agent readability audit (a14y).
 *
 * Wraps the `a14y` CLI (https://a14y.dev) — a scoring service that measures how
 * well AI agents can read the site. Anglesite sites are built and maintained by
 * AI agents, so making them readable to other agents (search agents, browsing
 * agents, content-mapping agents) is a first-class concern.
 *
 * The wrapper is intentionally thin: a14y already provides JSON output and a
 * `--fail-under` threshold flag for CI use. This script:
 *
 *   1. Resolves the target URL — `--url` arg, then `DEV_HOSTNAME` from
 *      `.site-config` (`https://DEV_HOSTNAME`), then `http://localhost:4321`.
 *   2. Pulls `A14Y_FAIL_UNDER` from `.site-config` and forwards it as
 *      `--fail-under <n>` unless the caller passed their own.
 *   3. Spawns `a14y` and forwards stdout/stderr to the parent.
 *   4. Honors `A14Y_WARN_ONLY=true` (or `--warn-only`) by translating any
 *      non-zero exit code to 0 — useful while a site is being remediated.
 *
 * Usage:
 *   tsx scripts/a14y-audit.ts                      # audit DEV_HOSTNAME / localhost
 *   tsx scripts/a14y-audit.ts --url https://x.com  # audit a specific URL
 *   tsx scripts/a14y-audit.ts --json               # passthrough --json to a14y
 *   tsx scripts/a14y-audit.ts --fail-under 80      # explicit threshold
 *   tsx scripts/a14y-audit.ts --warn-only          # never fail the process
 *
 * a14y must be installed (or available via npx). If it's not on PATH the script
 * prints install instructions and exits with the warn-only status.
 */

import { spawn } from "node:child_process";
import { readConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface A14yOptions {
  url: string;
  failUnder?: string;
  json?: boolean;
  passthrough?: string[];
}

export function buildA14yArgs(opts: A14yOptions): string[] {
  const args = [opts.url];
  if (opts.failUnder !== undefined && opts.failUnder !== "") {
    args.push("--fail-under", String(opts.failUnder));
  }
  if (opts.json) args.push("--json");
  if (opts.passthrough && opts.passthrough.length > 0) {
    args.push(...opts.passthrough);
  }
  return args;
}

export function resolveTargetUrl(
  cliUrl: string | undefined,
  devHostname: string | undefined,
): string {
  if (cliUrl && cliUrl.length > 0) return cliUrl;
  if (devHostname && devHostname.length > 0) return `https://${devHostname}`;
  return "http://localhost:4321";
}

export function translateExitCode(rawCode: number, warnOnly: boolean): number {
  if (warnOnly) return 0;
  return rawCode;
}

export function parseCliArgs(argv: string[]): {
  url?: string;
  failUnder?: string;
  json: boolean;
  warnOnly: boolean;
  passthrough: string[];
} {
  const out: {
    url?: string;
    failUnder?: string;
    json: boolean;
    warnOnly: boolean;
    passthrough: string[];
  } = {
    json: false,
    warnOnly: false,
    passthrough: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url" && i + 1 < argv.length) {
      out.url = argv[i + 1];
      i += 1;
    } else if (arg === "--fail-under" && i + 1 < argv.length) {
      out.failUnder = argv[i + 1];
      i += 1;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--warn-only") {
      out.warnOnly = true;
    } else if (arg === "--") {
      out.passthrough.push(...argv.slice(i + 1));
      break;
    } else {
      out.passthrough.push(arg);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const INSTALL_HINT = `a14y is not installed. Install it with one of:

  npm install -g a14y                # global
  npm install --save-dev a14y        # per-project (preferred for CI)

Then re-run \`npm run ai-a14y\`. Docs: https://a14y.dev`;

interface RunOptions {
  command?: string;
  spawnFn?: typeof spawn;
}

export async function runA14y(args: string[], opts: RunOptions = {}): Promise<number> {
  const command = opts.command ?? "a14y";
  const spawner = opts.spawnFn ?? spawn;
  return new Promise<number>((resolve) => {
    const child = spawner(command, args, { stdio: "inherit" });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        console.error(INSTALL_HINT);
        resolve(127);
      } else {
        console.error(`a14y failed to start: ${err.message}`);
        resolve(1);
      }
    });
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Script entry — only when invoked directly (not when imported by tests)
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("a14y-audit.ts")) {
  const cli = parseCliArgs(process.argv.slice(2));

  const devHostname = readConfig("DEV_HOSTNAME");
  const configFailUnder = readConfig("A14Y_FAIL_UNDER");
  const configWarnOnly = (readConfig("A14Y_WARN_ONLY") ?? "").toLowerCase() === "true";

  const url = resolveTargetUrl(cli.url, devHostname);
  const failUnder = cli.failUnder ?? configFailUnder;
  const warnOnly = cli.warnOnly || configWarnOnly;

  const args = buildA14yArgs({
    url,
    failUnder,
    json: cli.json,
    passthrough: cli.passthrough,
  });

  runA14y(args)
    .then((rawCode) => process.exit(translateExitCode(rawCode, warnOnly)))
    .catch((err) => {
      console.error("a14y audit failed:", err);
      process.exit(1);
    });
}
