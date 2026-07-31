import Foundation

/// Seam for validating an owner-pasted custom analytics HTML snippet before it's saved into the
/// site config. A protocol (rather than the concrete validator) so the plist editor can be tested
/// with a canned validator instead of a live container.
public protocol CustomAnalyticsHTMLValidating: Sendable {
    /// `nil` when the snippet is acceptable; otherwise an owner-facing message explaining why it
    /// was rejected — or why it *couldn't be checked*, which also blocks the save: an unvalidated
    /// snippet is injected into every page head, so "can't verify" must not pass silently.
    func validationMessage(for html: String, siteDirectory: URL) async -> String?
}

/// Validates custom analytics HTML by feeding it through the site's own `@astrojs/compiler`
/// inside the container guest — the exact parser that will consume the snippet at build time, so
/// "valid here" can't drift from "builds there". Requires the site's `node_modules` to be
/// installed and its container to be running; both absences produce an explanatory message rather
/// than a pass (host Node is retired, #70, so there is no host-side fallback parse).
public struct AstroHTMLValidator: CustomAnalyticsHTMLValidating, Sendable {
    /// Reached lazily, at the moment validation actually runs — never resolved eagerly at
    /// construction time — mirroring `DeployModel`/`PreviewModel.activeContainerControl()`
    /// (`SiteWindowModel.swift`'s `deploySite()`), since the container may not have finished
    /// booting yet when `PlistEditorModel` (and this validator) are created.
    public typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    private let containerControlProvider: ContainerControlProvider

    /// The default provider always returns `nil` ("no container"), which makes an undecorated
    /// validator fail safe — it reports validation as unavailable instead of approving snippets
    /// it never checked.
    public init(containerControlProvider: @escaping ContainerControlProvider = { nil }) {
        self.containerControlProvider = containerControlProvider
    }

    /// See ``CustomAnalyticsHTMLValidating/validationMessage(for:siteDirectory:)``. An empty or
    /// whitespace-only snippet is trivially valid (there is nothing to inject); everything else
    /// must round-trip through the compiler in the guest.
    public func validationMessage(for html: String, siteDirectory: URL) async -> String? {
        let snippet = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !snippet.isEmpty else { return nil }

        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: siteDirectory.appendingPathComponent("node_modules/@astrojs/compiler/package.json").path) else {
            return "Custom analytics HTML couldn't be validated because Astro dependencies are missing. Run npm install in this site and try again."
        }
        guard let (siteID, control) = await containerControlProvider() else {
            return HostNodeRetirement.reason("Custom analytics HTML validation") + "."
        }

        // The guest is a *cloned* copy of the site, not a host bind-mount, so host-written temp
        // files never appear in it. Instead the snippet and the fixed validation script are
        // base64-encoded and passed as positional shell parameters ($1/$2) — never spliced into
        // the script text — mirroring `ContainerDeployExecutor.wellKnownSeamArgv`'s
        // injection-safety pattern (`DeployExecutor.swift`).
        let snippetBase64 = Data(snippet.utf8).base64EncodedString()
        let scriptBase64 = Data(Self.validationScript.utf8).base64EncodedString()

        do {
            let result = try await control.exec(
                siteID: siteID,
                argv: Self.guestArgv(snippetBase64: snippetBase64, scriptBase64: scriptBase64),
                environment: [:],
                workingDirectory: "/workspace/site",
                onOutput: { _, _ in }
            )
            guard result.exitCode != 0 else { return nil }
            let message = [result.stderr, result.stdout]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .first { !$0.isEmpty }
            return "Custom analytics HTML is invalid: \(Self.friendlyMessage(message))"
        } catch {
            return "Custom analytics HTML couldn't be validated: \(error.localizedDescription)"
        }
    }

    private static let snippetGuestPath = "/tmp/anglesite-custom-analytics.html"
    private static let scriptGuestPath = "/tmp/anglesite-validate-custom-analytics.mjs"

    static func guestArgv(snippetBase64: String, scriptBase64: String) -> [String] {
        let script = """
        trap 'rm -f \(snippetGuestPath) \(scriptGuestPath)' EXIT INT TERM
        printf '%s' "$1" | base64 -d > \(snippetGuestPath)
        printf '%s' "$2" | base64 -d > \(scriptGuestPath)
        node \(scriptGuestPath) /workspace/site \(snippetGuestPath)
        """
        return ["sh", "-c", script, "sh", snippetBase64, scriptBase64]
    }

    private static func friendlyMessage(_ message: String?) -> String {
        guard let message, !message.isEmpty else {
            return "Astro couldn't parse the snippet."
        }
        if message.contains("Cannot read properties of undefined")
            || message.contains("index out of range") {
            return "Astro couldn't parse the snippet. Check for incomplete tags or script blocks."
        }
        return message
    }

    private static let validationScript = #"""
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';

    const siteDirectory = process.argv[2];
    const snippetPath = process.argv[3];
    const require = createRequire(pathToFileURL(join(siteDirectory, 'package.json')));
    const { convertToTSX } = require('@astrojs/compiler/sync');
    const snippet = readFileSync(snippetPath, 'utf8');
    const source = `---
    ---
    <html>
      <head>
    ${snippet}
      </head>
      <body></body>
    </html>
    `;

    try {
      const result = convertToTSX(source, {
        filename: 'AnglesiteCustomAnalytics.astro',
        includeScripts: true,
        includeStyles: true,
      });
      const diagnostic = (result.diagnostics || []).find((item) => item.severity === 1);
      if (diagnostic) {
        const location = diagnostic.location
          ? `${diagnostic.location.line}:${diagnostic.location.column}: `
          : '';
        console.error(`${location}${diagnostic.text || 'Astro reported invalid HTML.'}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(error?.message || String(error));
      process.exit(1);
    }
    """#
}
