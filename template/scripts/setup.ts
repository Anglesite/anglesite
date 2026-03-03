/**
 * Anglesite — first-time setup.
 *
 * Installs Node.js via fnm (no Homebrew needed), generates local HTTPS
 * certificates, configures port forwarding, and runs `npm install`.
 * Idempotent — safe to rerun. Logs to `~/.anglesite/logs/setup.log`.
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
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arch } from "node:os";
import { execa, execaCommand } from "execa";
import consola from "consola";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Directory this script lives in (`scripts/`). */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Project root (one level up from `scripts/`). */
const PROJECT_DIR = resolve(SCRIPT_DIR, "..");

/** Path to `.site-config` in the project root. */
const CONFIG_FILE = resolve(PROJECT_DIR, ".site-config");

/** Log directory under the user's home folder. */
const LOG_DIR = resolve(process.env.HOME ?? "~", ".anglesite/logs");

/** Log file path. */
const LOG_FILE = resolve(LOG_DIR, "setup.log");

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** When true, log what would happen without executing. */
const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("-n");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Run a command with sudo. Prompts the user for their password.
 *
 * @param args - Arguments to pass after `sudo`
 */
async function sudo(...args: string[]) {
  if (DRY_RUN) {
    log(`[dry-run] would run: sudo ${args.join(" ")}`);
    return;
  }
  await execa("sudo", args, { stdio: "inherit" });
}

/**
 * Check if a command exists in PATH.
 *
 * @param cmd - Command name
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execaCommand(`command -v ${cmd}`, { shell: true });
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

/** Install Xcode Command Line Tools if missing. */
async function installXcodeTools(): Promise<void> {
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
  const fnmBin = resolve(process.env.HOME ?? "~", ".local/share/fnm/fnm");
  if ((await commandExists("fnm")) || existsSync(fnmBin)) {
    log("fnm already installed.");
    return;
  }

  log("Installing fnm (Node.js manager)…");

  if (DRY_RUN) {
    log("[dry-run] would download and run fnm installer");
    return;
  }

  // Download installer to a temp location
  const response = await fetch("https://fnm.vercel.app/install");
  const installer = await response.text();
  if (!installer.startsWith("#!")) {
    consola.fail("fnm installer download failed or was corrupted.");
    process.exit(1);
  }

  const tmpFile = resolve(LOG_DIR, "fnm-installer.sh");
  writeFileSync(tmpFile, installer, { mode: 0o755 });
  await execa("bash", [tmpFile, "--skip-shell"], { stdio: "pipe" });
  writeFileSync(tmpFile, ""); // clean up

  log("fnm installed.");
}

/** Ensure fnm is in PATH for this session. */
function addFnmToPath(): void {
  const fnmDir = resolve(process.env.HOME ?? "~", ".local/share/fnm");
  if (!process.env.PATH?.includes(fnmDir)) {
    process.env.PATH = `${fnmDir}:${process.env.PATH}`;
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

/** Add fnm initialization to `~/.zshrc` if not already present. */
async function ensureShellProfile(): Promise<void> {
  const zshrc = resolve(process.env.HOME ?? "~", ".zshrc");
  const content = existsSync(zshrc) ? readFileSync(zshrc, "utf-8") : "";

  if (content.includes("fnm env")) {
    return;
  }

  log("Adding fnm to shell profile…");

  if (DRY_RUN) {
    log("[dry-run] would append fnm init to ~/.zshrc");
    return;
  }

  appendFileSync(
    zshrc,
    [
      "",
      "# fnm (Node.js manager)",
      'export PATH="$HOME/.local/share/fnm:$PATH"',
      'eval "$(fnm env --shell zsh)"',
      "",
    ].join("\n"),
  );
}

/** Run `npm install` in the project directory. */
async function installDependencies(): Promise<void> {
  log("Installing project dependencies (this may take a minute)…");
  await run("npm install", { cwd: PROJECT_DIR });
  log("Dependencies installed.");
}

/** Install mkcert binary if missing. */
async function installMkcert(): Promise<void> {
  const mkcertBin = resolve(process.env.HOME ?? "~", ".local/bin/mkcert");

  if (existsSync(mkcertBin)) {
    log("mkcert already installed.");
    return;
  }

  log("Installing mkcert (for local HTTPS)…");

  if (DRY_RUN) {
    log("[dry-run] would download mkcert binary");
    return;
  }

  const binDir = resolve(process.env.HOME ?? "~", ".local/bin");
  mkdirSync(binDir, { recursive: true });

  const cpuArch = arch();
  const mkcertArch = cpuArch === "arm64" ? "arm64" : "amd64";
  const url = `https://dl.filippo.io/mkcert/latest?for=darwin/${mkcertArch}`;

  const response = await fetch(url);
  if (!response.ok) {
    consola.fail("Failed to download mkcert.");
    process.exit(1);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(mkcertBin, buffer);
  chmodSync(mkcertBin, 0o755);
  log("mkcert installed.");
}

/** Trust the local CA in macOS Keychain (one-time prompt). */
async function trustLocalCA(): Promise<void> {
  const mkcertBin = resolve(process.env.HOME ?? "~", ".local/bin/mkcert");
  process.env.PATH = `${resolve(process.env.HOME ?? "~", ".local/bin")}:${process.env.PATH}`;

  if (!existsSync(mkcertBin)) {
    if (DRY_RUN) {
      log("[dry-run] would trust local CA");
      return;
    }
    consola.fail("mkcert not found — run setup without --dry-run first.");
    process.exit(1);
  }

  const { stdout: caRoot } = await execa(mkcertBin, ["-CAROOT"]);
  if (existsSync(resolve(caRoot.trim(), "rootCA.pem"))) {
    log("Local CA already trusted.");
    return;
  }

  log("Trusting the local certificate authority…");
  log("A macOS Keychain dialog will appear — enter your password or click Allow.");
  await run(`${mkcertBin} -install`);
  log("Local CA trusted.");
}

/** Generate local HTTPS certificate for the dev hostname. */
async function generateCert(): Promise<void> {
  const mkcertBin = resolve(process.env.HOME ?? "~", ".local/bin/mkcert");

  if (DRY_RUN && !existsSync(mkcertBin)) {
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
    `${mkcertBin} -cert-file ${certFile} -key-file ${keyFile} ${devHostname} localhost 127.0.0.1`,
  );
  if (!DRY_RUN) {
    writeFileSync(hostnameFile, devHostname);
  }
  log(`Certificate generated for ${devHostname}.`);
}

/**
 * Configure system-level HTTPS: `/etc/hosts` entry and pfctl port forwarding.
 * Requires sudo when changes are needed.
 */
async function configureSystemHttps(): Promise<void> {
  const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";
  const pfctlAnchor = "com.anglesite";
  const pfctlFile = `/etc/pf.anchors/${pfctlAnchor}`;

  let needsSudo = false;

  if (devHostname !== "localhost") {
    try {
      const hosts = readFileSync("/etc/hosts", "utf-8");
      if (!hosts.includes(devHostname)) needsSudo = true;
    } catch {
      needsSudo = true;
    }
  }

  if (!existsSync(pfctlFile)) needsSudo = true;

  if (needsSudo) {
    log("Some setup steps need your Mac password (admin access).");
    log("Type your password below — nothing will appear as you type. Press Enter.");
    if (!DRY_RUN) {
      await execa("sudo", ["-v"], { stdio: "inherit" });
    }
  }

  // /etc/hosts entry
  if (devHostname !== "localhost") {
    try {
      const hosts = readFileSync("/etc/hosts", "utf-8");
      if (!hosts.includes(devHostname)) {
        log(`Adding ${devHostname} to hosts file…`);
        await sudo("tee", "-a", "/etc/hosts");
        // Use a more direct approach with echo pipe
        if (!DRY_RUN) {
          await execa("sudo", ["bash", "-c", `echo "127.0.0.1 ${devHostname}" >> /etc/hosts`], {
            stdio: "inherit",
          });
        }
        log("Hosts file updated.");
      } else {
        log(`${devHostname} already in hosts file.`);
      }
    } catch {
      log(`Could not check /etc/hosts.`);
    }
  }

  // pfctl port forwarding: 443 → 4321
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
}

/** Initialize a Git repository if one doesn't exist. */
async function initGit(): Promise<void> {
  if (existsSync(resolve(PROJECT_DIR, ".git"))) {
    log("Git already initialized.");
    return;
  }

  log("Initializing git…");
  await run("git init", { cwd: PROJECT_DIR });
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

/** Show a macOS notification. */
async function notify(title: string, message: string): Promise<void> {
  if (DRY_RUN) return;
  await execa("osascript", [
    "-e",
    `display notification "${message}" with title "${title}"`,
  ]).catch(() => {});
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Entry point — runs all setup steps sequentially. */
async function main(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_FILE, ""); // reset log

  if (DRY_RUN) consola.warn("Dry-run mode — no changes will be made.");
  consola.start("Starting site setup…");
  log(`Project directory: ${PROJECT_DIR}`);

  await installXcodeTools();
  await installFnm();
  await installNode();
  await ensureShellProfile();
  await installDependencies();
  await installMkcert();
  await trustLocalCA();
  await generateCert();
  await configureSystemHttps();
  await initGit();
  saveProjectDir();

  consola.success("Setup complete!");
  await notify("Site Setup Complete", "Everything is installed and ready.");
}

main().catch(async (err) => {
  consola.error("Setup failed:", err.message ?? err);
  await notify("Setup Failed", String(err.message ?? err));
  process.exit(1);
});
