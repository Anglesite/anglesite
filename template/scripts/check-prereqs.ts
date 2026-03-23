/**
 * Anglesite — prerequisite check.
 *
 * Reports tool status as `key=value` pairs on stdout. Read-only,
 * safe to run anytime. Skills parse the output to decide next steps.
 *
 * Cross-platform: works on macOS, Linux, and Windows.
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
import {
  platform,
  HOSTS_FILE,
  hasPfctl,
  mkcertBin as mkcertBinPath,
  needsXcodeTools,
} from "./platform.js";
import { readConfig } from "./config.js";

/** Directory this script lives in (`scripts/`). */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Project root (one level up from `scripts/`). */
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

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
  consola.start(`Checking prerequisites (${platform})…`);

  // Xcode Command Line Tools (macOS only)
  if (needsXcodeTools) {
    const xcodeResult = await firstLine("xcode-select -p");
    if (xcodeResult) {
      console.log(`xcode_clt=installed ${xcodeResult}`);
    } else {
      console.log("xcode_clt=missing");
    }
  } else {
    console.log("xcode_clt=n/a (not needed on this platform)");
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
  const mkcertPath = mkcertBinPath();
  if (existsSync(mkcertPath)) {
    const ver = await firstLine(`${mkcertPath} --version`);
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

  // Hosts file entry
  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";
  if (devHostname !== "localhost") {
    try {
      const hosts = readFileSync(HOSTS_FILE, "utf-8");
      if (hosts.includes(devHostname)) {
        console.log(`https_hosts=ok (${devHostname})`);
      } else {
        console.log(
          `https_hosts=missing (${devHostname} not in ${HOSTS_FILE})`,
        );
      }
    } catch {
      console.log(`https_hosts=missing (cannot read ${HOSTS_FILE})`);
    }
  }

  // Port forwarding
  if (hasPfctl) {
    // macOS: check pfctl anchor
    if (existsSync("/etc/pf.anchors/com.anglesite")) {
      console.log("https_portforward=configured");
    } else {
      console.log("https_portforward=missing");
    }
  } else {
    console.log("https_portforward=n/a (manual setup on this platform)");
  }

  consola.success("Prerequisite check complete.");
}

main().catch((err) => {
  consola.error("Prerequisite check failed:", err);
  process.exit(1);
});
