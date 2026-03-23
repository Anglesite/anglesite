import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import * as p from "../template/scripts/platform.js";

// ---------------------------------------------------------------------------
// Derive expected values from the actual process.platform so the tests
// pass on any OS (macOS in CI, Linux in containers, etc.)
// ---------------------------------------------------------------------------

const expectedPlatform: p.Platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : "linux";

const onMacos = expectedPlatform === "macos";
const onLinux = expectedPlatform === "linux";
const onWindows = expectedPlatform === "windows";
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";

// ---------------------------------------------------------------------------
// Platform detection constants
// ---------------------------------------------------------------------------

describe("platform detection", () => {
  it("platform matches process.platform", () => {
    expect(p.platform).toBe(expectedPlatform);
  });

  it("isMacos is correct", () => {
    expect(p.isMacos).toBe(onMacos);
  });

  it("isLinux is correct", () => {
    expect(p.isLinux).toBe(onLinux);
  });

  it("isWindows is correct", () => {
    expect(p.isWindows).toBe(onWindows);
  });
});

// ---------------------------------------------------------------------------
// HOME and HOSTS_FILE
// ---------------------------------------------------------------------------

describe("HOME", () => {
  it("is a non-empty string", () => {
    expect(p.HOME).toBeTruthy();
    expect(typeof p.HOME).toBe("string");
  });
});

describe("HOSTS_FILE", () => {
  it("points to the correct hosts file for the current OS", () => {
    if (onWindows) {
      expect(p.HOSTS_FILE).toBe("C:\\Windows\\System32\\drivers\\etc\\hosts");
    } else {
      expect(p.HOSTS_FILE).toBe("/etc/hosts");
    }
  });
});

// ---------------------------------------------------------------------------
// shellProfile / shellName
// ---------------------------------------------------------------------------

describe("shellProfile()", () => {
  it("returns the correct profile path for the current OS", () => {
    if (onMacos) {
      expect(p.shellProfile()).toBe(resolve(HOME, ".zshrc"));
    } else if (onLinux) {
      expect(p.shellProfile()).toBe(resolve(HOME, ".bashrc"));
    } else {
      expect(p.shellProfile()).toBe("");
    }
  });
});

describe("shellName()", () => {
  it("returns the correct shell name for the current OS", () => {
    if (onMacos) {
      expect(p.shellName()).toBe("zsh");
    } else if (onLinux) {
      expect(p.shellName()).toBe("bash");
    } else {
      expect(p.shellName()).toBe("powershell");
    }
  });
});

// ---------------------------------------------------------------------------
// fnmDir / localBinDir
// ---------------------------------------------------------------------------

describe("fnmDir()", () => {
  it("returns the correct fnm directory", () => {
    if (onWindows) {
      expect(p.fnmDir()).toBe(resolve(HOME, ".fnm"));
    } else {
      expect(p.fnmDir()).toBe(resolve(HOME, ".local/share/fnm"));
    }
  });
});

describe("localBinDir()", () => {
  it("returns ~/.local/bin resolved", () => {
    expect(p.localBinDir()).toBe(resolve(HOME, ".local/bin"));
  });
});

// ---------------------------------------------------------------------------
// mkcertBin / mkcertDownloadUrl
// ---------------------------------------------------------------------------

describe("mkcertBin()", () => {
  it("returns the correct binary name", () => {
    const expected = onWindows ? "mkcert.exe" : "mkcert";
    expect(p.mkcertBin()).toBe(resolve(p.localBinDir(), expected));
  });
});

describe("mkcertDownloadUrl()", () => {
  it("returns arm64 URL for arm64 arch", () => {
    const url = p.mkcertDownloadUrl("arm64");
    const os = onWindows ? "windows" : onMacos ? "darwin" : "linux";
    expect(url).toBe(`https://dl.filippo.io/mkcert/latest?for=${os}/arm64`);
  });

  it("returns amd64 URL for x64 arch", () => {
    const url = p.mkcertDownloadUrl("x64");
    const os = onWindows ? "windows" : onMacos ? "darwin" : "linux";
    expect(url).toBe(`https://dl.filippo.io/mkcert/latest?for=${os}/amd64`);
  });

  it("returns amd64 URL for any non-arm64 arch", () => {
    const url = p.mkcertDownloadUrl("ia32");
    expect(url).toContain("/amd64");
  });
});

// ---------------------------------------------------------------------------
// openCommand
// ---------------------------------------------------------------------------

describe("openCommand()", () => {
  it("returns the correct open command for a URL", () => {
    const url = "https://example.com";
    if (onMacos) {
      expect(p.openCommand(url)).toBe(`open ${url}`);
    } else if (onWindows) {
      expect(p.openCommand(url)).toBe(`start ${url}`);
    } else {
      expect(p.openCommand(url)).toBe(`xdg-open ${url}`);
    }
  });
});

// ---------------------------------------------------------------------------
// portCheckCommand / dnsCheckCommand
// ---------------------------------------------------------------------------

describe("portCheckCommand()", () => {
  it("returns the correct command for a port", () => {
    const port = 4321;
    if (onWindows) {
      expect(p.portCheckCommand(port)).toBe(`netstat -ano | findstr :${port}`);
    } else {
      expect(p.portCheckCommand(port)).toBe(`lsof -i :${port}`);
    }
  });
});

describe("dnsCheckCommand()", () => {
  it("returns the correct command for a hostname", () => {
    const host = "local.example.com";
    if (onMacos) {
      expect(p.dnsCheckCommand(host)).toBe(`dscacheutil -q host -a name ${host}`);
    } else if (onWindows) {
      expect(p.dnsCheckCommand(host)).toBe(`nslookup ${host}`);
    } else {
      expect(p.dnsCheckCommand(host)).toBe(`getent hosts ${host}`);
    }
  });
});

// ---------------------------------------------------------------------------
// sedInPlace / hasPfctl / needsXcodeTools
// ---------------------------------------------------------------------------

describe("platform-specific constants", () => {
  it("sedInPlace is correct", () => {
    expect(p.sedInPlace).toBe(onMacos ? "-i ''" : "-i");
  });

  it("hasPfctl is true only on macOS", () => {
    expect(p.hasPfctl).toBe(onMacos);
  });

  it("needsXcodeTools is true only on macOS", () => {
    expect(p.needsXcodeTools).toBe(onMacos);
  });
});

// ---------------------------------------------------------------------------
// notifyCommand
// ---------------------------------------------------------------------------

describe("notifyCommand()", () => {
  const title = "Test";
  const message = "Hello world";

  if (onMacos) {
    it("returns osascript command on macOS", () => {
      const result = p.notifyCommand(title, message);
      expect(result).not.toBeNull();
      expect(result!.cmd).toBe("osascript");
      expect(result!.args).toContain("-e");
      expect(result!.args[1]).toContain(title);
      expect(result!.args[1]).toContain(message);
    });
  } else if (onLinux) {
    it("returns notify-send command on Linux", () => {
      const result = p.notifyCommand(title, message);
      expect(result).not.toBeNull();
      expect(result!.cmd).toBe("notify-send");
      expect(result!.args).toEqual([title, message]);
    });
  } else {
    it("returns null on Windows", () => {
      expect(p.notifyCommand(title, message)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// portForwardingInfo
// ---------------------------------------------------------------------------

describe("portForwardingInfo()", () => {
  it("returns an object with supported and description", () => {
    const info = p.portForwardingInfo();
    expect(info).toHaveProperty("supported");
    expect(info).toHaveProperty("description");
    expect(typeof info.supported).toBe("boolean");
    expect(typeof info.description).toBe("string");
    expect(info.description.length).toBeGreaterThan(0);
  });

  it("has correct supported flag for the current OS", () => {
    const info = p.portForwardingInfo();
    if (onMacos) {
      expect(info.supported).toBe(true);
      expect(info.description).toContain("pfctl");
    } else {
      expect(info.supported).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// fnmShellInit
// ---------------------------------------------------------------------------

describe("fnmShellInit()", () => {
  it("returns an array of strings", () => {
    const lines = p.fnmShellInit();
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((line) => expect(typeof line).toBe("string"));
  });

  it("includes fnm comment", () => {
    const lines = p.fnmShellInit();
    expect(lines.some((l) => l.includes("fnm"))).toBe(true);
  });

  if (onWindows) {
    it("includes powershell invocation on Windows", () => {
      const lines = p.fnmShellInit();
      expect(lines.some((l) => l.includes("Invoke-Expression"))).toBe(true);
    });
  } else {
    it("includes eval and shell name on Unix", () => {
      const lines = p.fnmShellInit();
      const shell = p.shellName();
      expect(lines.some((l) => l.includes("eval"))).toBe(true);
      expect(lines.some((l) => l.includes(`--shell ${shell}`))).toBe(true);
    });

    it("includes fnmDir in PATH export", () => {
      const lines = p.fnmShellInit();
      expect(lines.some((l) => l.includes(p.fnmDir()))).toBe(true);
    });
  }
});
