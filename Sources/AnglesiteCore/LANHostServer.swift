import Foundation

/// A setup failure the `anglesite-lan-host` CLI reports before starting any server process —
/// each case names the path that failed resolution so the operator can fix the invocation.
public enum LANHostServerError: Error, Equatable, CustomStringConvertible {
    /// The `--site` path is neither an `.anglesite` package nor an Astro project directory
    /// (no `Info.plist` + `Source/`, and no `package.json`).
    case siteNotFound(String)
    /// The resolved project root has no `.git` directory. The LAN host serves a working copy
    /// that guests treat as the site's source of truth, so it must be a clonable git repo.
    case notAGitRepo(String)
    /// No `server/index.mjs` under the resolved plugin root — the MCP sidecar entry point is
    /// missing; pass `--plugin-path` or set `ANGLESITE_PLUGIN_SRC`.
    case pluginServerNotFound(String)

    /// Operator-facing message printed by the CLI: the failing path plus the fix.
    public var description: String {
        switch self {
        case .siteNotFound(let path):
            return "no .anglesite package or Astro project found at \(path)"
        case .notAGitRepo(let path):
            return "\(path) has no .git directory — the project root must be a git repo"
        case .pluginServerNotFound(let path):
            return "no server/index.mjs found under \(path) — pass --plugin-path or set ANGLESITE_PLUGIN_SRC"
        }
    }
}

/// Pure, testable logic backing the `anglesite-lan-host` CLI (`Sources/AnglesiteLANHost`) — the
/// Mac-Studio-side standing process for #601 §2. Kept here rather than in the executable target
/// per the `TokenOnboarding` precedent noted in CLAUDE.md: `swift test` can exercise this,
/// `main.swift` (a hosted CLI entry point) cannot be unit-tested the same way.
public enum LANHostServer {
    /// Resolves a `--site` argument — either an `.anglesite` package directory (containing
    /// `Info.plist` + `Source/`) or a raw Astro project directory — to the Astro project root to
    /// serve. Mirrors `AnglesitePackage.sourceURL` (`Sources/AnglesiteSiteModel/AnglesitePackage.swift`)
    /// without depending on `AnglesiteSiteModel`, since only the `Source/` path matters here.
    public static func resolveSiteDirectory(sitePath: String, fileManager: FileManager = .default) throws -> URL {
        let path = URL(fileURLWithPath: sitePath, isDirectory: true).standardizedFileURL
        let infoPlist = path.appendingPathComponent("Info.plist", isDirectory: false)
        let sourceDir = path.appendingPathComponent("Source", isDirectory: true)

        let projectRoot: URL
        if fileManager.fileExists(atPath: infoPlist.path), fileManager.fileExists(atPath: sourceDir.path) {
            projectRoot = sourceDir
        } else if fileManager.fileExists(atPath: path.appendingPathComponent("package.json", isDirectory: false).path) {
            projectRoot = path
        } else {
            throw LANHostServerError.siteNotFound(sitePath)
        }

        guard fileManager.fileExists(atPath: projectRoot.appendingPathComponent(".git", isDirectory: true).path) else {
            throw LANHostServerError.notAGitRepo(projectRoot.standardizedFileURL.path)
        }
        return projectRoot
    }

    /// Resolves the sibling `anglesite` plugin repo's `server/` directory — the MCP HTTP sidecar
    /// entry point (`server/index.mjs`) staged into the container image at build time by
    /// `scripts/vendor-container-image.sh`. Resolution order:
    /// explicit path > `ANGLESITE_PLUGIN_SRC` env > `../anglesite` sibling default.
    public static func resolvePluginServerPath(
        explicit: String?,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true),
        fileManager: FileManager = .default
    ) throws -> URL {
        let pluginRoot: URL
        if let explicit {
            pluginRoot = URL(fileURLWithPath: explicit, isDirectory: true).standardizedFileURL
        } else if let envPath = environment["ANGLESITE_PLUGIN_SRC"] {
            pluginRoot = URL(fileURLWithPath: envPath, isDirectory: true).standardizedFileURL
        } else {
            pluginRoot = currentDirectory.appendingPathComponent("../anglesite", isDirectory: true).standardizedFileURL
        }

        let serverDir = pluginRoot.appendingPathComponent("server", isDirectory: true)
        let entry = serverDir.appendingPathComponent("index.mjs", isDirectory: false)
        guard fileManager.fileExists(atPath: entry.path) else {
            throw LANHostServerError.pluginServerNotFound(pluginRoot.standardizedFileURL.path)
        }
        return serverDir
    }

    /// `astro dev` CLI arguments for the LAN-bound host invocation — mirrors the container
    /// guest's `npx astro dev --port 4321 --host 127.0.0.1`
    /// (`Sources/AnglesiteContainer/ContainerizationControl.swift`), swapping the guest's
    /// loopback-only bind for the configured LAN `bindHost`.
    public static func astroDevArguments(bindHost: String, previewPort: Int) -> [String] {
        ["astro", "dev", "--port", String(previewPort), "--host", bindHost]
    }

    /// Environment for the MCP sidecar (`node <pluginServerPath>/index.mjs`). Mirrors the
    /// container guest's env exactly (`ANGLESITE_MCP_TRANSPORT=http`, `ANGLESITE_MCP_PORT=4399`)
    /// except `ANGLESITE_MCP_HOST`, which the guest leaves unset (defaulting to 127.0.0.1,
    /// correct for its own loopback vsock bridge) but the LAN host must set explicitly to bind
    /// beyond loopback. `bearerToken` is optional forward-compat plumbing for #601 §2's "auth
    /// parity with the sandbox path" checkbox — nil by default (trusted-LAN, single-owner).
    public static func mcpSidecarEnvironment(
        bindHost: String, mcpPort: Int, projectRoot: URL, bearerToken: String?
    ) -> [String: String] {
        var env = [
            "ANGLESITE_MCP_TRANSPORT": "http",
            "ANGLESITE_MCP_PORT": String(mcpPort),
            "ANGLESITE_MCP_HOST": bindHost,
            "ANGLESITE_PROJECT_ROOT": projectRoot.path
        ]
        if let bearerToken {
            env["ANGLESITE_MCP_BEARER_TOKEN"] = bearerToken
        }
        return env
    }
}
