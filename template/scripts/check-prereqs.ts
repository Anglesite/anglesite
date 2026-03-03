/**
 * Anglesite — prerequisite check.
 *
 * Reports tool status as `key=value` pairs on stdout. Read-only,
 * safe to run anytime. Skills parse the output to decide next steps.
 *
 * Usage: `npm run ai-check` or `npx tsx scripts/check-prereqs.ts`
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execaCommand } from "execa";
import consola from "consola";

/** Directory this script lives in (`scripts/`). */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Project root (one level up from `scripts/`). */
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

/** Path to `.site-config` in the project root. */
const CONFIG_FILE = resolve(PROJECT_DIR, ".site-config");

/**
 * Read a value from `.site-config` (KEY=value, one per line).
 *
 * @param key - Config key to look up
 * @returns The trimmed value, or `undefined` if missing
 */
function readConfig(key: string): string | undefined {
  if (!existsSync(CONFIG_FILE)) return undefined;
  const content = readFileSync(CONFIG_FILE, "utf-8");
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

/**
 * Run a command and return its first line of stdout, or `null` on failure.
 *
 * @param cmd - Shell command string
 * @returns First line of output, or `null`
 */
async function firstLine(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execaCommand(cmd);
    return stdout.split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether a CLI tool is installed and print its version.
 *
 * @param label - Key name for the output line
 * @param cmd - Command name to check
 */
async function check(label: string, cmd: string): Promise<void> {
  const ver = await firstLine(`${cmd} --version`);
  if (ver) {
    console.log(`${label}=installed ${ver}`);
  } else {
    console.log(`${label}=missing`);
  }
}

/** Entry point — runs all prerequisite checks. */
async function main(): Promise<void> {
  consola.start("Checking prerequisites…");

  // Xcode Command Line Tools
  const xcodeResult = await firstLine("xcode-select -p");
  if (xcodeResult) {
    console.log(`xcode_clt=installed ${xcodeResult}`);
  } else {
    console.log("xcode_clt=missing");
  }

  // Core tools
  await check("node", "node");
  await check("npm", "npm");
  await check("git", "git");
  await check("fnm", "fnm");

  // node_modules
  if (existsSync(resolve(PROJECT_DIR, "node_modules"))) {
    console.log("node_modules=installed");
  } else {
    console.log("node_modules=missing");
  }

  // --- HTTPS ---

  // mkcert
  const mkcertBin = resolve(process.env.HOME ?? "~", ".local/bin/mkcert");
  if (existsSync(mkcertBin)) {
    const ver = await firstLine(`${mkcertBin} --version`);
    console.log(`mkcert=installed ${ver ?? ""}`);
  } else {
    console.log("mkcert=missing");
  }

  // Local HTTPS certificate
  const certsDir = resolve(PROJECT_DIR, ".certs");
  const certFile = resolve(certsDir, "cert.pem");

  if (existsSync(certFile)) {
    const expiry = await firstLine(
      `openssl x509 -in ${certFile} -checkend 86400 -noout`,
    );
    const hostname = existsSync(resolve(certsDir, ".hostname"))
      ? readFileSync(resolve(certsDir, ".hostname"), "utf-8").trim()
      : "";
    // openssl exits 0 if cert is valid, non-zero if expiring
    if (expiry !== null) {
      console.log(`https_cert=valid (${hostname})`);
    } else {
      console.log("https_cert=expiring");
    }
  } else {
    console.log("https_cert=missing");
  }

  // /etc/hosts entry
  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";
  if (devHostname !== "localhost") {
    try {
      const hosts = readFileSync("/etc/hosts", "utf-8");
      if (hosts.includes(devHostname)) {
        console.log(`https_hosts=ok (${devHostname})`);
      } else {
        console.log(
          `https_hosts=missing (${devHostname} not in /etc/hosts)`,
        );
      }
    } catch {
      console.log(`https_hosts=missing (cannot read /etc/hosts)`);
    }
  }

  // pfctl port forwarding
  if (existsSync("/etc/pf.anchors/com.anglesite")) {
    console.log("https_portforward=configured");
  } else {
    console.log("https_portforward=missing");
  }

  consola.success("Prerequisite check complete.");
}

main().catch((err) => {
  consola.error("Prerequisite check failed:", err);
  process.exit(1);
});
