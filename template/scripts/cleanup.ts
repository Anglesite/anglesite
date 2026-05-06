/**
 * Anglesite — remove system modifications.
 *
 * Reverses the hosts file entry and port-forwarding rules
 * created by setup. Does NOT delete project files, certificates,
 * or the mkcert CA.
 *
 * Cross-platform: works on macOS, Linux, and Windows.
 *
 * Usage: `npm run ai-cleanup` or `npx tsx scripts/cleanup.ts`
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execa, execaCommand } from "execa";
import consola from "consola";
import {
  isMacos,
  isWindows,
  HOSTS_FILE,
  hasPfctl,
  mkcertBin as mkcertBinPath,
} from "./platform.js";
import { readConfig } from "./config.js";

/** Whether sudo can be used in this environment (interactive or cached). */
async function canRunPrivileged(): Promise<boolean> {
  if (!isWindows && process.getuid?.() === 0) return true;
  if (isWindows) return true;
  try {
    await execaCommand("command -v sudo", { shell: true });
  } catch {
    return false;
  }
  try {
    await execa("sudo", ["-n", "true"], { stdio: "pipe" });
    return true;
  } catch {
    return process.stdin.isTTY === true;
  }
}

/** Directory this script lives in (`scripts/`). */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Project root (one level up from `scripts/`). */
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

/** pfctl anchor name used by Anglesite (macOS only). */
const PFCTL_ANCHOR = "com.anglesite";

/** Entry point — removes system modifications made by setup. */
async function main(): Promise<void> {
  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";

  // Check for hosts file entry
  let hasHostsEntry = false;
  if (devHostname !== "localhost") {
    try {
      const hosts = readFileSync(HOSTS_FILE, "utf-8");
      hasHostsEntry = hosts.includes(devHostname);
    } catch {
      // Can't read hosts file
    }
  }

  // Check for pfctl rules (macOS only)
  const hasPfctlRules = hasPfctl && existsSync(`/etc/pf.anchors/${PFCTL_ANCHOR}`);

  if (!hasHostsEntry && !hasPfctlRules) {
    consola.info("No system modifications to remove.");
    return;
  }

  consola.box("This will remove Anglesite's system modifications:");
  if (hasHostsEntry) {
    consola.info(`  ${HOSTS_FILE} entry for ${devHostname}`);
  }
  if (hasPfctlRules) {
    consola.info("  pfctl port forwarding rules (443 → 4321)");
  }
  console.log();
  consola.info("Your website files, certificates, and tools will NOT be deleted.");
  console.log();

  if (isWindows) {
    // Windows: provide manual instructions
    if (hasHostsEntry) {
      consola.info(`To remove the hosts entry, edit ${HOSTS_FILE} as Administrator`);
      consola.info(`and delete the line containing "${devHostname}".`);
    }
    return;
  }

  // macOS / Linux: use sudo
  if (!(await canRunPrivileged())) {
    consola.warn("Cannot remove system modifications: this environment doesn't support sudo.");
    if (hasHostsEntry) {
      consola.info(
        `To remove the hosts entry, edit ${HOSTS_FILE} on a machine with admin access`,
      );
      consola.info(`and delete the line containing "${devHostname}".`);
    }
    if (hasPfctlRules) {
      consola.info("To remove pfctl rules, run cleanup on a machine with admin access.");
    }
    return;
  }

  consola.warn("Your password is needed for this.");
  await execa("sudo", ["-v"], { stdio: "inherit" });

  // Remove hosts file entry using Node.js fs (avoids BSD vs GNU sed differences)
  if (hasHostsEntry) {
    consola.start(`Removing ${devHostname} from ${HOSTS_FILE}…`);
    const hosts = readFileSync(HOSTS_FILE, "utf-8");
    const filtered = hosts
      .split("\n")
      .filter((line) => !line.includes(devHostname))
      .join("\n");
    await execa("sudo", ["bash", "-c", `cat > ${HOSTS_FILE} << 'HOSTS_EOF'\n${filtered}\nHOSTS_EOF`]);
    consola.success("Hosts entry removed.");
  }

  // Remove pfctl anchor (macOS only)
  if (hasPfctlRules) {
    consola.start("Removing pfctl rules…");
    await execa("sudo", ["rm", "-f", `/etc/pf.anchors/${PFCTL_ANCHOR}`]);

    // Remove anchor references from pf.conf using Node.js filtering
    const pfConf = readFileSync("/etc/pf.conf", "utf-8");
    const filtered = pfConf
      .split("\n")
      .filter((line) => !line.includes(PFCTL_ANCHOR))
      .join("\n");
    await execa("sudo", ["bash", "-c", `cat > /etc/pf.conf << 'PF_EOF'\n${filtered}\nPF_EOF`]);

    await execa("sudo", ["pfctl", "-f", "/etc/pf.conf"]).catch(() => {});
    consola.success("Port forwarding rules removed.");
  }

  console.log();
  consola.success("System modifications removed.");
  const mkcertPath = mkcertBinPath();
  if (isMacos) {
    consola.info("To also remove the certificate authority from Keychain:");
  } else {
    consola.info("To also remove the local certificate authority:");
  }
  consola.info(`  ${mkcertPath} -uninstall`);
}

main().catch((err) => {
  consola.error("Cleanup failed:", err.message ?? err);
  process.exit(1);
});
