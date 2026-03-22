/**
 * Anglesite — first-time setup.
 *
 * Installs Node.js via fnm (no Homebrew needed), generates local HTTPS
 * certificates, configures port forwarding, and runs `npm install`.
 * Idempotent — safe to rerun. Logs to `~/.anglesite/logs/setup.log`.
 *
 * Cross-platform: works on macOS, Linux, and Windows.
 *
 * Usage: `npm run ai-setup` or `npx tsx scripts/setup.ts [--dry-run]`
 *
 * @module
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arch } from "node:os";
import { execa, execaCommand } from "execa";
import consola from "consola";
import {
  platform,
  isMacos,
  isLinux,
  isWindows,
  HOME,
  HOSTS_FILE,
  shellProfile,
  fnmDir,
  localBinDir,
  mkcertBin as mkcertBinPath,
  mkcertDownloadUrl,
  ghCliBin as ghCliBinPath,
  ghCliDownloadUrl,
  needsXcodeTools,
  hasPfctl,
  notifyCommand,
  fnmShellInit,
} from "./platform.js";
import { readConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Directory this script lives in (`scripts/`). */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Project root (one level up from `scripts/`). */
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

/** Log directory under the user's home folder. */
const LOG_DIR = resolve(HOME, ".anglesite/logs");

/** Log file path. */
const LOG_FILE = resolve(LOG_DIR, "setup.log");

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** When true, log what would happen without executing. */
const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("-n");

/** Steps that failed non-fatally and were skipped. Reported at the end. */
const skipped: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Append a timestamped message to the log file and display it.
 *
 * @param msg - Message to log
 */
function log(msg: string): void {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
  appendFileSync(LOG_FILE, line + "\n");
  consola.info(msg);
}

/**
 * Run a shell command, piping output to the log file.
 * In dry-run mode, only logs what would run.
 *
 * @param cmd - Command string to execute
 * @param opts - Extra execa options
 * @returns execa result
 */
async function run(cmd: string, opts: Record<string, unknown> = {}) {
  if (DRY_RUN) {
    log(`[dry-run] would run: ${cmd}`);
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  const result = await execaCommand(cmd, { stdio: "pipe", ...opts });
  if (result.stdout) appendFileSync(LOG_FILE, result.stdout + "\n");
  if (result.stderr) appendFileSync(LOG_FILE, result.stderr + "\n");
  return result;
}

/**
 * Check if a command exists in PATH.
 *
 * @param cmd - Command name
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const which = isWindows ? "where" : "command -v";
    await execaCommand(`${which} ${cmd}`, { shell: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep for a given number of milliseconds.
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------------

/** Install Xcode Command Line Tools if missing (macOS only). */
async function installXcodeTools(): Promise<void> {
  if (!needsXcodeTools) {
    // On Linux/Windows, check for git separately
    if (await commandExists("git")) {
      log("Git already installed.");
    } else {
      log("Git is not installed.");
      if (isLinux) {
        consola.warn("Install Git with your package manager (e.g. sudo apt install git).");
      } else if (isWindows) {
        consola.warn("Install Git from https://git-scm.com/download/win");
      }
      skipped.push("git (not installed — install manually)");
    }
    return;
  }

  try {
    await execaCommand("xcode-select -p");
    log("Xcode tools already installed.");
    return;
  } catch {
    // not installed
  }

  log("Installing Xcode command line tools (includes Git)…");
  log("A macOS dialog will appear — click Install and wait for it to finish.");
  await run("xcode-select --install");

  // Poll until installation completes
  let installed = false;
  while (!installed) {
    await sleep(5000);
    try {
      await execaCommand("xcode-select -p");
      installed = true;
    } catch {
      // still installing
    }
  }
  log("Xcode tools installed.");
}

/** Install fnm (Fast Node Manager) if missing. */
async function installFnm(): Promise<void> {
  const fnmBinName = isWindows ? "fnm.exe" : "fnm";
  const fnmBin = resolve(fnmDir(), fnmBinName);
  if ((await commandExists("fnm")) || existsSync(fnmBin)) {
    log("fnm already installed.");
    return;
  }

  log("Installing fnm (Node.js manager)…");

  if (DRY_RUN) {
    log("[dry-run] would download and run fnm installer");
    return;
  }

  if (isWindows) {
    consola.warn("On Windows, install fnm manually: https://github.com/Schniz/fnm#installation");
    consola.warn("Or run: winget install Schniz.fnm");
    skipped.push("fnm install (manual install needed on Windows)");
    return;
  }

  // Download installer to a temp location
  const response = await fetch("https://fnm.vercel.app/install");
  const installer = await response.text();
  if (!installer.startsWith("#!")) {
    consola.warn("fnm installer download failed — Node.js setup will be skipped.");
    skipped.push("fnm install (download failed)");
    return;
  }

  const tmpFile = resolve(LOG_DIR, "fnm-installer.sh");
  writeFileSync(tmpFile, installer, { mode: 0o755 });
  await execa("bash", [tmpFile, "--skip-shell"], { stdio: "pipe" });
  writeFileSync(tmpFile, ""); // clean up

  log("fnm installed.");
}

/** Ensure fnm is in PATH for this session. */
function addFnmToPath(): void {
  const dir = fnmDir();
  if (!process.env.PATH?.includes(dir)) {
    const sep = isWindows ? ";" : ":";
    process.env.PATH = `${dir}${sep}${process.env.PATH}`;
  }
}

/** Install Node.js LTS via fnm if missing. */
async function installNode(): Promise<void> {
  addFnmToPath();

  if (await commandExists("node")) {
    const { stdout } = await execaCommand("node --version");
    log(`Node.js ${stdout.trim()} ready.`);
    return;
  }

  log("Installing Node.js (LTS)…");
  await run("fnm install --lts");
  await run("fnm default lts-latest");

  const { stdout } = await execaCommand("node --version");
  log(`Node.js ${stdout.trim()} ready.`);
}

/** Add fnm initialization to the user's shell profile if not already present. */
async function ensureShellProfile(): Promise<void> {
  const profile = shellProfile();

  if (!profile) {
    if (isWindows) {
      log("On Windows, add fnm to your PowerShell profile manually.");
      log('Run: fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression');
      skipped.push("shell profile (manual setup needed on Windows)");
    }
    return;
  }

  const content = existsSync(profile) ? readFileSync(profile, "utf-8") : "";

  if (content.includes("fnm env")) {
    return;
  }

  log("Adding fnm to shell profile…");

  if (DRY_RUN) {
    log(`[dry-run] would append fnm init to ${profile}`);
    return;
  }

  appendFileSync(profile, fnmShellInit().join("\n"));
}

/** Run `npm install` in the project directory. */
async function installDependencies(): Promise<void> {
  log("Installing project dependencies (this may take a minute)…");
  await run("npm install", { cwd: PROJECT_DIR });
  log("Dependencies installed.");
}

/** Install mkcert binary if missing. */
async function installMkcert(): Promise<void> {
  const mkcertPath = mkcertBinPath();

  if (existsSync(mkcertPath)) {
    log("mkcert already installed.");
    return;
  }

  log("Installing mkcert (for local HTTPS)…");

  if (DRY_RUN) {
    log("[dry-run] would download mkcert binary");
    return;
  }

  const binDir = localBinDir();
  mkdirSync(binDir, { recursive: true });

  const cpuArch = arch();
  const url = mkcertDownloadUrl(cpuArch);

  const response = await fetch(url);
  if (!response.ok) {
    consola.warn("Failed to download mkcert — HTTPS setup will be skipped.");
    skipped.push("mkcert download");
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(mkcertPath, buffer);
  if (!isWindows) {
    chmodSync(mkcertPath, 0o755);
  }
  log("mkcert installed.");
}

/** Install the GitHub CLI (`gh`) if missing. */
async function installGhCli(): Promise<void> {
  if (await commandExists("gh")) {
    log("GitHub CLI already installed.");
    return;
  }

  const ghPath = ghCliBinPath();
  if (existsSync(ghPath)) {
    log("GitHub CLI already installed.");
    return;
  }

  log("Installing GitHub CLI (for backup and issue tracking)…");

  if (DRY_RUN) {
    log("[dry-run] would download GitHub CLI binary");
    return;
  }

  if (isWindows) {
    consola.warn("On Windows, install the GitHub CLI: winget install GitHub.cli");
    skipped.push("GitHub CLI (install manually: winget install GitHub.cli)");
    return;
  }

  // Fetch latest version tag from the GitHub API
  let version: string;
  try {
    const res = await fetch("https://api.github.com/repos/cli/cli/releases/latest");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { tag_name: string };
    version = data.tag_name.replace(/^v/, "");
  } catch {
    consola.warn("Could not determine latest GitHub CLI version — skipping.");
    skipped.push("GitHub CLI (version check failed)");
    return;
  }

  const cpuArch = arch();
  const url = ghCliDownloadUrl(version, cpuArch);

  const response = await fetch(url);
  if (!response.ok) {
    consola.warn("Failed to download GitHub CLI — skipping.");
    skipped.push("GitHub CLI download");
    return;
  }

  const binDir = localBinDir();
  mkdirSync(binDir, { recursive: true });

  // Download tarball and extract the `gh` binary
  const tarball = resolve(LOG_DIR, "gh.tar.gz");
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(tarball, buffer);

  const extractDir = resolve(LOG_DIR, "gh-extract");
  mkdirSync(extractDir, { recursive: true });
  await run(`tar -xzf ${tarball} -C ${extractDir}`);

  // The tarball extracts to gh_VERSION_OS_ARCH/bin/gh
  const os = isMacos ? "macOS" : "linux";
  const archName = cpuArch === "arm64" ? "arm64" : "amd64";
  const extractedBin = resolve(extractDir, `gh_${version}_${os}_${archName}`, "bin", "gh");

  if (existsSync(extractedBin)) {
    const dest = resolve(binDir, "gh");
    writeFileSync(dest, readFileSync(extractedBin));
    chmodSync(dest, 0o755);
    log("GitHub CLI installed.");
  } else {
    consola.warn("Could not find gh binary in downloaded archive — skipping.");
    skipped.push("GitHub CLI (extraction failed)");
  }

  // Clean up temp files
  try { rmSync(tarball, { force: true }); } catch {}
  try { rmSync(extractDir, { recursive: true, force: true }); } catch {}
}

/** Trust the local CA in the system certificate store. */
async function trustLocalCA(): Promise<void> {
  const mkcertPath = mkcertBinPath();
  const binDir = localBinDir();
  const sep = isWindows ? ";" : ":";
  process.env.PATH = `${binDir}${sep}${process.env.PATH}`;

  if (!existsSync(mkcertPath)) {
    if (DRY_RUN) {
      log("[dry-run] would trust local CA");
      return;
    }
    consola.warn("mkcert not found — skipping CA trust.");
    skipped.push("local CA trust (mkcert not available)");
    return;
  }

  const { stdout: caRoot } = await execa(mkcertPath, ["-CAROOT"]);
  if (existsSync(resolve(caRoot.trim(), "rootCA.pem"))) {
    log("Local CA already trusted.");
    return;
  }

  log("Trusting the local certificate authority…");
  if (isMacos) {
    log("A macOS Keychain dialog will appear — enter your password or click Allow.");
  } else if (isWindows) {
    log("A Windows security dialog may appear — click Yes to trust the certificate.");
  } else {
    log("You may be prompted for your password to trust the certificate.");
  }

  try {
    await run(`${mkcertPath} -install`);
    log("Local CA trusted.");
  } catch {
    log("Could not trust the local CA (this may require running manually).");
    skipped.push("mkcert -install (local CA trust)");
  }
}

/** Generate local HTTPS certificate for the dev hostname. */
async function generateCert(): Promise<void> {
  const mkcertPath = mkcertBinPath();

  if (DRY_RUN && !existsSync(mkcertPath)) {
    log("[dry-run] would generate HTTPS certificate");
    return;
  }

  const certsDir = resolve(PROJECT_DIR, ".certs");
  mkdirSync(certsDir, { recursive: true });

  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";
  const certFile = resolve(certsDir, "cert.pem");
  const keyFile = resolve(certsDir, "key.pem");
  const hostnameFile = resolve(certsDir, ".hostname");

  const currentHostname = existsSync(hostnameFile)
    ? readFileSync(hostnameFile, "utf-8").trim()
    : "";

  if (existsSync(certFile) && currentHostname === devHostname) {
    log(`Certificate for ${devHostname} already exists.`);
    return;
  }

  log(`Generating HTTPS certificate for ${devHostname}…`);
  await run(
    `${mkcertPath} -cert-file ${certFile} -key-file ${keyFile} ${devHostname} localhost 127.0.0.1`,
  );
  if (!DRY_RUN) {
    writeFileSync(hostnameFile, devHostname);
  }
  log(`Certificate generated for ${devHostname}.`);
}

/**
 * Configure system-level HTTPS: hosts file entry and port forwarding.
 * Platform-specific: pfctl on macOS, manual instructions on Linux/Windows.
 */
async function configureSystemHttps(): Promise<void> {
  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";

  // --- Hosts file entry ---
  if (devHostname !== "localhost") {
    try {
      const hosts = readFileSync(HOSTS_FILE, "utf-8");
      if (!hosts.includes(devHostname)) {
        log(`Adding ${devHostname} to hosts file…`);

        if (isWindows) {
          log(`On Windows, run as Administrator and add to ${HOSTS_FILE}:`);
          log(`127.0.0.1 ${devHostname}`);
          skipped.push(`hosts file entry (add manually to ${HOSTS_FILE})`);
        } else {
          // macOS / Linux: use sudo
          log("Your password is needed to update the hosts file (admin access).");
          log("Type your password below — nothing will appear as you type. Press Enter.");
          if (!DRY_RUN) {
            try {
              await execa("sudo", ["-v"], { stdio: "inherit" });
              await execa("sudo", ["bash", "-c", `echo "127.0.0.1 ${devHostname}" >> ${HOSTS_FILE}`], {
                stdio: "inherit",
              });
              log("Hosts file updated.");
            } catch {
              consola.warn("Could not update hosts file — skipping.");
              skipped.push("hosts file entry");
            }
          }
        }
      } else {
        log(`${devHostname} already in hosts file.`);
      }
    } catch {
      log(`Could not read ${HOSTS_FILE}.`);
      if (isWindows) {
        skipped.push(`hosts file (run as Administrator to access ${HOSTS_FILE})`);
      }
    }
  }

  // --- Port forwarding (443 → 4321) ---
  if (hasPfctl) {
    // macOS: use pfctl
    const pfctlAnchor = "com.anglesite";
    const pfctlFile = `/etc/pf.anchors/${pfctlAnchor}`;
    const pfctlRule =
      "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 4321";

    if (!existsSync(pfctlFile)) {
      log("Setting up port forwarding (443 → 4321)…");

      if (!DRY_RUN) {
        // Backup pf.conf
        await execa("sudo", ["cp", "/etc/pf.conf", "/etc/pf.conf.anglesite-backup"]).catch(
          () => {},
        );

        // Write anchor file
        await execa("sudo", ["bash", "-c", `echo '${pfctlRule}' > ${pfctlFile}`]);

        // Add anchor references to pf.conf if not present
        const pfConf = readFileSync("/etc/pf.conf", "utf-8");
        if (!pfConf.includes(pfctlAnchor)) {
          await execa("sudo", [
            "bash",
            "-c",
            `echo 'rdr-anchor "${pfctlAnchor}"' >> /etc/pf.conf && echo 'load anchor "${pfctlAnchor}" from "${pfctlFile}"' >> /etc/pf.conf`,
          ]);
        }

        await execa("sudo", ["pfctl", "-ef", "/etc/pf.conf"]).catch(() => {});
      }

      log("Port forwarding configured.");
    } else {
      // Ensure rules are loaded (may have been lost after reboot)
      if (!DRY_RUN) {
        await execa("sudo", ["pfctl", "-ef", "/etc/pf.conf"]).catch(() => {});
      }
      log("Port forwarding already configured.");
    }
  } else {
    // Linux / Windows: provide instructions
    log("Port forwarding (443 → 4321) is not auto-configured on this platform.");
    if (isLinux) {
      log("To forward port 443 → 4321, run:");
      log("  sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 4321");
    } else if (isWindows) {
      log("To forward port 443 → 4321, run as Administrator:");
      log("  netsh interface portproxy add v4tov4 listenport=443 connectport=4321 connectaddress=127.0.0.1");
    }
    skipped.push("port forwarding (manual setup — see log for instructions)");
  }
}

/** Initialize a Git repository if one doesn't exist. */
async function initGit(): Promise<void> {
  if (existsSync(resolve(PROJECT_DIR, ".git"))) {
    log("Git already initialized.");
    return;
  }

  log("Initializing git…");
  await run("git init -b draft", { cwd: PROJECT_DIR });
  await run("git add -A", { cwd: PROJECT_DIR });
  await run('git commit -m "Initial setup"', { cwd: PROJECT_DIR });
  log("Git initialized.");
}

/** Write PROJECT_DIR to `.site-config`. */
function saveProjectDir(): void {
  if (DRY_RUN) {
    log("[dry-run] would write PROJECT_DIR to .site-config");
    return;
  }

  if (existsSync(CONFIG_FILE)) {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    if (content.includes("PROJECT_DIR=")) {
      writeFileSync(
        CONFIG_FILE,
        content.replace(/^PROJECT_DIR=.*$/m, `PROJECT_DIR=${PROJECT_DIR}`),
      );
    } else {
      appendFileSync(CONFIG_FILE, `\nPROJECT_DIR=${PROJECT_DIR}\n`);
    }
  } else {
    writeFileSync(CONFIG_FILE, `PROJECT_DIR=${PROJECT_DIR}\n`);
  }

  log("Project directory saved to .site-config");
}

/** Show a desktop notification (best-effort, cross-platform). */
async function notify(title: string, message: string): Promise<void> {
  if (DRY_RUN) return;
  const cmd = notifyCommand(title, message);
  if (cmd) {
    await execa(cmd.cmd, cmd.args).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Entry point — runs all setup steps sequentially. */
async function main(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_FILE, ""); // reset log

  if (DRY_RUN) consola.warn("Dry-run mode — no changes will be made.");
  consola.start(`Starting site setup on ${platform}…`);
  log(`Project directory: ${PROJECT_DIR}`);
  log(`Platform: ${platform} (${process.platform}/${arch()})`);

  await installXcodeTools();
  await installFnm();
  await installNode();
  await ensureShellProfile();
  await installDependencies();
  await installMkcert();
  await installGhCli();
  await trustLocalCA();
  await generateCert();
  await configureSystemHttps();
  await initGit();
  saveProjectDir();

  if (skipped.length > 0) {
    consola.warn(`Setup finished with ${skipped.length} skipped step(s):`);
    for (const s of skipped) consola.warn(`  • ${s}`);
    consola.info("Run `npm run ai-setup` again to retry, or use `/anglesite:check` for help.");
    await notify("Setup Finished", `${skipped.length} step(s) need attention.`);
  } else {
    consola.success("Setup complete!");
    await notify("Site Setup Complete", "Everything is installed and ready.");
  }
}

main().catch(async (err) => {
  consola.error("Setup failed:", err.message ?? err);
  await notify("Setup Failed", String(err.message ?? err));
  process.exit(1);
});
