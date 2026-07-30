import Foundation

public protocol CustomAnalyticsHTMLValidating: Sendable {
    func validationMessage(for html: String, siteDirectory: URL) async -> String?
}

public struct AstroHTMLValidator: CustomAnalyticsHTMLValidating, Sendable {
    /// Reached lazily, at the moment validation actually runs — never resolved eagerly at
    /// construction time — mirroring `DeployModel`/`PreviewModel.activeContainerControl()`
    /// (`SiteWindowModel.swift`'s `deploySite()`), since the container may not have finished
    /// booting yet when `PlistEditorModel` (and this validator) are created.
    public typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    private let containerControlProvider: ContainerControlProvider

    public init(containerControlProvider: @escaping ContainerControlProvider = { nil }) {
        self.containerControlProvider = containerControlProvider
    }

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
