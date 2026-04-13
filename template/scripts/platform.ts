/**
 * Anglesite — cross-platform utilities.
 *
 * Detects the host OS and provides platform-appropriate paths, commands,
 * and helpers so setup, cleanup, and check-prereqs work on macOS, Linux,
 * and Windows.
 *
 * @module
 */

import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

export type Platform = "macos" | "linux" | "windows";

/** Normalized platform name. */
export const platform: Platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : "linux";

export const isMacos = platform === "macos";
export const isLinux = platform === "linux";
export const isWindows = platform === "windows";

// ---------------------------------------------------------------------------
// Home directory
// ---------------------------------------------------------------------------

/** User home directory — works on all platforms. */
export const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Path to the system hosts file. */
export const HOSTS_FILE = isWindows
  ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
  : "/etc/hosts";

/** Default shell profile file to append fnm init. */
export function shellProfile(): string {
  if (isWindows) return ""; // Windows uses PowerShell profile; handled separately
  if (isMacos) return resolve(HOME, ".zshrc");
  // Linux: prefer .bashrc, fall back to .profile
  return resolve(HOME, ".bashrc");
}

/** Shell name for fnm `--shell` flag. */
export function shellName(): string {
  if (isMacos) return "zsh";
  if (isWindows) return "powershell";
  return "bash";
}

/** fnm install directory. */
export function fnmDir(): string {
  if (isWindows) return resolve(HOME, ".fnm");
  return resolve(HOME, ".local/share/fnm");
}

/** Directory for user-local binaries (mkcert, etc.). */
export function localBinDir(): string {
  if (isWindows) return resolve(HOME, ".local/bin");
  return resolve(HOME, ".local/bin");
}

/** mkcert binary path. */
export function mkcertBin(): string {
  const name = isWindows ? "mkcert.exe" : "mkcert";
  return resolve(localBinDir(), name);
}

// ---------------------------------------------------------------------------
// Download URLs
// ---------------------------------------------------------------------------

/** mkcert download URL for the current platform and architecture. */
export function mkcertDownloadUrl(cpuArch: string): string {
  const arch = cpuArch === "arm64" ? "arm64" : "amd64";
  const os = isWindows ? "windows" : isMacos ? "darwin" : "linux";
  return `https://dl.filippo.io/mkcert/latest?for=${os}/${arch}`;
}

/** GitHub CLI (`gh`) binary path. */
export function ghCliBin(): string {
  const name = isWindows ? "gh.exe" : "gh";
  return resolve(localBinDir(), name);
}

/**
 * GitHub CLI download URL for a given version, platform, and architecture.
 * Version is the semver string without the "v" prefix (e.g. "2.74.0").
 * The setup script fetches the latest version from the GitHub API first.
 */
export function ghCliDownloadUrl(version: string, cpuArch: string): string {
  const arch = cpuArch === "arm64" ? "arm64" : "amd64";
  const os = isWindows ? "windows" : isMacos ? "macOS" : "linux";
  const ext = isWindows ? "zip" : "tar.gz";
  return `https://github.com/cli/cli/releases/download/v${version}/gh_${version}_${os}_${arch}.${ext}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Command to open a URL in the default browser. */
export function openCommand(url: string): string {
  if (isMacos) return `open ${url}`;
  if (isWindows) return `start ${url}`;
  return `xdg-open ${url}`;
}

/**
 * Command to check what process is using a port.
 * Returns the appropriate command for the platform.
 */
export function portCheckCommand(port: number): string {
  if (isWindows) return `netstat -ano | findstr :${port}`;
  return `lsof -i :${port}`;
}

/**
 * Command to check DNS resolution of a hostname.
 * Returns the appropriate command for the platform.
 */
export function dnsCheckCommand(hostname: string): string {
  if (isMacos) return `dscacheutil -q host -a name ${hostname}`;
  if (isWindows) return `nslookup ${hostname}`;
  return `getent hosts ${hostname}`;
}

/**
 * sed in-place flag differs between macOS (BSD) and Linux (GNU).
 * Windows should not use sed at all — use Node.js fs instead.
 */
export const sedInPlace = isMacos ? "-i ''" : "-i";

/**
 * Whether the platform supports pfctl (macOS packet filter).
 * Linux uses iptables/socat; Windows uses netsh. Only macOS has pfctl.
 */
export const hasPfctl = isMacos;

/**
 * Whether the platform needs Xcode Command Line Tools.
 * Only macOS — Linux and Windows install git separately.
 */
export const needsXcodeTools = isMacos;

/**
 * Send a desktop notification. Returns the command args for execa.
 * Returns null if no notification mechanism is available.
 */
export function notifyCommand(
  title: string,
  message: string,
): { cmd: string; args: string[] } | null {
  if (isMacos) {
    return {
      cmd: "osascript",
      args: ["-e", `display notification "${message}" with title "${title}"`],
    };
  }
  if (isLinux) {
    return { cmd: "notify-send", args: [title, message] };
  }
  // Windows: PowerShell toast — not worth the complexity for a minor feature
  return null;
}

// ---------------------------------------------------------------------------
// Port forwarding
// ---------------------------------------------------------------------------

/**
 * Platform-specific port forwarding setup info.
 * Returns a description and whether it's supported automatically.
 */
export function portForwardingInfo(): {
  supported: boolean;
  description: string;
} {
  if (isMacos) {
    return {
      supported: true,
      description: "pfctl port forwarding (443 → 4321)",
    };
  }
  if (isLinux) {
    return {
      supported: false,
      description:
        "Port forwarding on Linux requires iptables or socat. " +
        "Run: sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 4321",
    };
  }
  return {
    supported: false,
    description:
      "Port forwarding on Windows requires netsh. " +
      "Run: netsh interface portproxy add v4tov4 listenport=443 connectport=4321 connectaddress=127.0.0.1",
  };
}

// ---------------------------------------------------------------------------
// fnm shell init snippet
// ---------------------------------------------------------------------------

/** Shell init lines for fnm, appropriate to the platform. */
export function fnmShellInit(): string[] {
  if (isWindows) {
    return [
      "# fnm (Node.js manager)",
      'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression',
    ];
  }
  const shell = shellName();
  return [
    "",
    "# fnm (Node.js manager)",
    `export PATH="${fnmDir()}:$PATH"`,
    `eval "$(fnm env --shell ${shell})"`,
    "",
  ];
}
