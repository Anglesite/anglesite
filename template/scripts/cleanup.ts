/**
 * Anglesite — remove system modifications.
 *
 * Reverses the `/etc/hosts` entry and pfctl port-forwarding rules
 * created by setup. Does NOT delete project files, certificates,
 * or the mkcert CA.
 *
 * Usage: `npm run ai-cleanup` or `npx tsx scripts/cleanup.ts`
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import consola from "consola";

/** Directory this script lives in (`scripts/`). */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Project root (one level up from `scripts/`). */
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

/** Path to `.site-config` in the project root. */
const CONFIG_FILE = resolve(PROJECT_DIR, ".site-config");

/** pfctl anchor name used by Anglesite. */
const PFCTL_ANCHOR = "com.anglesite";

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

/** Entry point — removes system modifications made by setup. */
async function main(): Promise<void> {
  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";
  const hasHostsEntry =
    devHostname !== "localhost" &&
    existsSync("/etc/hosts") &&
    readFileSync("/etc/hosts", "utf-8").includes(devHostname);
  const hasPfctl = existsSync(`/etc/pf.anchors/${PFCTL_ANCHOR}`);

  if (!hasHostsEntry && !hasPfctl) {
    consola.info("No system modifications to remove.");
    return;
  }

  consola.box("This will remove Anglesite's system modifications:");
  if (hasHostsEntry) {
    consola.info(`  /etc/hosts entry for ${devHostname}`);
  }
  if (hasPfctl) {
    consola.info("  pfctl port forwarding rules (443 → 4321)");
  }
  console.log();
  consola.info("Your website files, certificates, and tools will NOT be deleted.");
  console.log();
  consola.warn("Your Mac password is needed for this.");

  // Validate sudo access
  await execa("sudo", ["-v"], { stdio: "inherit" });

  // Remove /etc/hosts entry
  if (hasHostsEntry) {
    consola.start(`Removing ${devHostname} from /etc/hosts…`);
    await execa("sudo", ["sed", "-i", "", `/${devHostname}/d`, "/etc/hosts"]);
    consola.success("Hosts entry removed.");
  }

  // Remove pfctl anchor
  if (hasPfctl) {
    consola.start("Removing pfctl rules…");
    await execa("sudo", ["rm", "-f", `/etc/pf.anchors/${PFCTL_ANCHOR}`]);
    await execa("sudo", ["sed", "-i", "", `/${PFCTL_ANCHOR}/d`, "/etc/pf.conf"]);
    await execa("sudo", ["pfctl", "-f", "/etc/pf.conf"]).catch(() => {});
    consola.success("Port forwarding rules removed.");
  }

  console.log();
  consola.success("System modifications removed.");
  consola.info("To also remove the certificate authority from Keychain:");
  consola.info(`  ${resolve(process.env.HOME ?? "~", ".local/bin/mkcert")} -uninstall`);
}

main().catch((err) => {
  consola.error("Cleanup failed:", err.message ?? err);
  process.exit(1);
});
