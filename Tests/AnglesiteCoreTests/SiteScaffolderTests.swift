import XCTest
import os
import AnglesiteTestSupport
@testable import AnglesiteCore

final class SiteScaffolderTests: XCTestCase {

    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func makeDraft() -> NewSiteDraft {
        NewSiteDraft(siteType: .business, name: "Acme Co", tagline: "We build.",
                     themeID: "classic", headline: "Acme", blurb: "Welcome to Acme.")
    }

    private func makeScaffolder(root: URL, calls: CallRecorder = CallRecorder()) -> SiteScaffolder {
        SiteScaffolder(
            sitesRoot: root,
            templateURL: URL(fileURLWithPath: "/template"),
            catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: calls),
            gitInit: { _ in },
            gitCommit: { _ in },
            register: { pkg in try SiteStore.Site.make(package: pkg) }
        )
    }

    private let theme = Theme(id: "classic", name: "Classic", blurb: "", swatch: [],
                              cssVars: ["color-primary": "#1e3a5f"])

    /// A fake CommandRunner that records calls and simulates scaffold.sh by writing the
    /// template files the appliers expect.
    private func fakeRunner(scaffoldExit: Int32 = 0, npmExit: Int32 = 0,
                            calls: CallRecorder) -> SiteScaffolder.CommandRunner {
        return { executable, args, cwd in
            await calls.append(args.joined(separator: " "))
            if args.contains(where: { $0.hasSuffix("scaffold.sh") }), scaffoldExit == 0, let cwd {
                // Simulate the template copy the real scaffold.sh performs.
                let css = cwd.appendingPathComponent("src/styles/global.css")
                let astro = cwd.appendingPathComponent("src/pages/index.astro")
                try? FileManager.default.createDirectory(at: css.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? FileManager.default.createDirectory(at: astro.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? ":root {\n  --color-primary: #2563eb;\n  --color-accent: #f59e0b;\n}".write(to: css, atomically: true, encoding: .utf8)
                try? "<section class=\"hero\">\n  <h1>Welcome</h1>\n</section>".write(to: astro, atomically: true, encoding: .utf8)
                try? "ANGLESITE_VERSION=1.0.0".write(to: cwd.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
            }
            let exit = args.contains(where: { $0.hasSuffix("scaffold.sh") }) ? scaffoldExit : npmExit
            return ProcessSupervisor.RunResult(stdout: "", stderr: exit == 0 ? "" : "boom", exitCode: exit)
        }
    }

    func testHappyPathEmitsStepsInOrderAndRegisters() async throws {
        let root = tmpDir()
        let scaffolder = makeScaffolder(root: root)
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }

        XCTAssertEqual(steps.first, .creatingFolder)
        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        let expectedID = try AnglesitePackage(url: pkgURL).readMarker().siteID.uuidString
        if case .done(let id) = steps.last { XCTAssertEqual(id, expectedID) }
        else { XCTFail("expected .done last, got \(String(describing: steps.last))") }
        // .site-config gained SITE_NAME. The ANGLESITE_VERSION scaffold.sh's placeholder wrote
        // ("1.0.0") gets corrected to the real running app/bundle version by SiteScaffolder itself
        // (see testHappyPathWritesADependencyBaselineAndStampsTheRealAppVersion) — here we only
        // assert it's no longer the placeholder, since the actual value is whatever Bundle.main
        // resolves to inside the XCTest host and isn't this test's concern.
        let cfg = try String(contentsOf: pkgURL.appendingPathComponent("Source/.site-config"), encoding: .utf8)
        XCTAssertFalse(cfg.contains("ANGLESITE_VERSION=1.0.0"))
        XCTAssertTrue(cfg.contains("SITE_NAME=Acme Co"))
        XCTAssertTrue(cfg.contains("CF_PROJECT_NAME=acme-co"))
        // Theme + homepage applied in Source/:
        let css = try String(contentsOf: pkgURL.appendingPathComponent("Source/src/styles/global.css"), encoding: .utf8)
        XCTAssertTrue(css.contains("--color-primary: #1e3a5f;"))
    }

    func testHappyPathWritesADeployableWranglerConfig() async throws {
        let root = tmpDir()
        let scaffolder = makeScaffolder(root: root)
        for await _ in scaffolder.scaffold(makeDraft()) {}

        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        let toml = try String(contentsOf: pkgURL.appendingPathComponent("Source/wrangler.toml"), encoding: .utf8)
        XCTAssertTrue(toml.contains(#"name = "acme-co""#))
        XCTAssertTrue(toml.contains(#"directory = "dist""#))
        // Static-only: no social-feature bindings and no Worker entrypoint.
        XCTAssertFalse(toml.contains("main ="))
        XCTAssertFalse(toml.contains("d1_databases"))
    }

    /// Two sites with different names must never share a Worker name (#701 case 11):
    /// the slug is derived the same way the wizard's `slugTaken` uniqueness check runs against.
    func testTwoSitesGetDistinctWorkerNames() async throws {
        let root = tmpDir()
        let scaffolder = makeScaffolder(root: root)
        var second = makeDraft()
        second.name = "Beta Co"
        for await _ in scaffolder.scaffold(makeDraft()) {}
        for await _ in scaffolder.scaffold(second) {}

        let firstCfg = try String(
            contentsOf: root.appendingPathComponent("acme-co.anglesite/Source/.site-config"), encoding: .utf8)
        let secondCfg = try String(
            contentsOf: root.appendingPathComponent("beta-co.anglesite/Source/.site-config"), encoding: .utf8)
        XCTAssertTrue(firstCfg.contains("CF_PROJECT_NAME=acme-co"))
        XCTAssertTrue(secondCfg.contains("CF_PROJECT_NAME=beta-co"))
    }

    func testSiteConfigValuesAreSanitizedAndBlurbBackfillsTagline() async throws {
        let root = tmpDir()
        let scaffolder = makeScaffolder(root: root)
        let draft = NewSiteDraft(siteType: .business,
                                 name: "Acme\nEVIL=1",
                                 domainChoice: .transfer,
                                 domain: "example.com\nEVIL=1",
                                 themeID: "classic",
                                 headline: "Acme",
                                 blurb: "Short description")

        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(draft) { steps.append(s) }

        guard case .done? = steps.last else { return XCTFail("expected .done") }
        let pkgURL = root.appendingPathComponent("acme-evil-1.anglesite")
        let cfg = try String(contentsOf: pkgURL.appendingPathComponent("Source/.site-config"), encoding: .utf8)
        XCTAssertTrue(cfg.contains("SITE_NAME=Acme"))
        XCTAssertTrue(cfg.contains("DOMAIN=example.com"))
        XCTAssertTrue(cfg.contains("TAGLINE=Short description"))
        XCTAssertFalse(cfg.contains("EVIL=1"))
    }

    func testCustomColorSchemeAndLogoAreApplied() async throws {
        let root = tmpDir()
        let logo = root.appendingPathComponent("brand.PNG")
        try Data("logo".utf8).write(to: logo)
        let scaffolder = makeScaffolder(root: root)
        var draft = makeDraft()
        draft.themeID = CustomTheme.id
        draft.customPrimaryColor = "#123456"
        draft.customAccentColor = "#abcdef"
        draft.logoURL = logo

        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(draft) { steps.append(s) }

        guard case .done? = steps.last else { return XCTFail("expected .done") }
        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        let css = try String(contentsOf: pkgURL.appendingPathComponent("Source/src/styles/global.css"), encoding: .utf8)
        XCTAssertTrue(css.contains("--color-primary: #123456;"))
        XCTAssertTrue(css.contains("--color-accent: #abcdef;"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: pkgURL.appendingPathComponent("Source/public/logo.png").path))
        let home = try String(contentsOf: pkgURL.appendingPathComponent("Source/src/pages/index.astro"), encoding: .utf8)
        XCTAssertTrue(home.contains(#"src="/logo.png""#))
        XCTAssertTrue(home.contains(#"class="site-logo""#))
        let cfg = try String(contentsOf: pkgURL.appendingPathComponent("Source/.site-config"), encoding: .utf8)
        XCTAssertTrue(cfg.contains("THEME=__custom"))
        XCTAssertTrue(cfg.contains("COLOR_PRIMARY=#123456"))
        XCTAssertTrue(cfg.contains("COLOR_ACCENT=#abcdef"))
        XCTAssertTrue(cfg.contains("LOGO=/logo.png"))
    }

    func testCustomSaveLocationAndDomainAreUsed() async throws {
        let root = tmpDir()
        let saveDirectory = root.appendingPathComponent("Chosen", isDirectory: true)
        try FileManager.default.createDirectory(at: saveDirectory, withIntermediateDirectories: true)
        let scaffolder = makeScaffolder(root: root)
        var draft = makeDraft()
        draft.domainChoice = .transfer
        draft.domain = "example.com"
        draft.saveDirectory = saveDirectory
        draft.saveFileName = "Example Website"

        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(draft) { steps.append(s) }

        guard case .done? = steps.last else { return XCTFail("expected .done") }
        let pkgURL = saveDirectory.appendingPathComponent("Example Website.anglesite")
        XCTAssertTrue(FileManager.default.fileExists(atPath: pkgURL.path))
        let cfg = try String(contentsOf: pkgURL.appendingPathComponent("Source/.site-config"), encoding: .utf8)
        XCTAssertTrue(cfg.contains("DOMAIN_CHOICE=transfer"))
        XCTAssertTrue(cfg.contains("DOMAIN=example.com"))
    }

    func testScaffoldFailureIsFatal() async throws {
        let root = tmpDir()
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: URL(fileURLWithPath: "/template"), catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(scaffoldExit: 1, calls: CallRecorder()),
            gitInit: { _ in },
            gitCommit: { _ in },
            register: { _ in XCTFail("must not register on scaffold failure"); fatalError() }
        )
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }
        guard case .failed(let step, _)? = steps.last else { return XCTFail("expected .failed") }
        XCTAssertEqual(step, "copyingTemplate")
    }

    func testHappyPathWritesADependencyBaselineAndStampsTheRealAppVersion() async throws {
        let root = tmpDir()
        let templateURL = try templateRoot()
        let calls = CallRecorder()
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: templateURL, catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: calls),
            gitInit: { _ in },
            gitCommit: { _ in },
            register: { pkg in try SiteStore.Site.make(package: pkg) },
            appVersion: { "9.9.9" }
        )
        for await _ in scaffolder.scaffold(makeDraft()) {}

        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        let configDir = pkgURL.appendingPathComponent("Config")
        let baseline = DependencyBaseline.load(from: configDir)
        XCTAssertNotNil(baseline)
        XCTAssertEqual(baseline?["astro"], "^7.1.3")  // matches Resources/Template/package.json today

        let siteConfig = try String(
            contentsOf: pkgURL.appendingPathComponent("Source/.site-config"), encoding: .utf8)
        let stampedVersion = SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: siteConfig)
        XCTAssertEqual(stampedVersion, "9.9.9")
        XCTAssertNotEqual(stampedVersion, "1.0.0")  // no longer the scaffold.sh placeholder
    }

    func testMissingTemplatePackageJSONWarnsButStillRegisters() async throws {
        // makeScaffolder's default templateURL ("/template") has no package.json,
        // so reading it for the dependency baseline fails — this must surface as a
        // warning rather than disappearing silently (the site would otherwise never
        // get dependency-sync, with no record of why).
        let root = tmpDir()
        let scaffolder = makeScaffolder(root: root)
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }

        XCTAssertTrue(steps.contains { if case .warning(let s, _) = $0 { return s == "copyingTemplate" }; return false })
        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        XCTAssertNil(DependencyBaseline.load(from: pkgURL.appendingPathComponent("Config")))
        guard case .done? = steps.last else { return XCTFail("expected .done despite missing template package.json") }
    }

    /// Resolve the real scaffold.sh from the in-repo template (Resources/Template/), mirroring
    /// HomepageWriterTests.realIndexAstroURL()'s repo-root-relative lookup.
    private static func realScaffoldScriptURL() -> URL {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return repoRoot.appendingPathComponent("Resources/Template/scripts/scaffold.sh")
    }

    /// Regression coverage for #501: exercises the real scaffold.sh subprocess (not the mocked
    /// CommandRunner the other tests use) to confirm .site-config is still generated correctly
    /// now that the heredoc has been replaced with printf. Other tests in this file mock
    /// scaffold.sh entirely, so they wouldn't catch a reintroduced heredoc-shaped regression here.
    func testRealScaffoldScriptWritesSiteConfigWithoutHeredoc() throws {
        let script = Self.realScaffoldScriptURL()
        guard FileManager.default.fileExists(atPath: script.path) else {
            throw XCTSkip("scaffold.sh not found at \(script.path)")
        }
        let target = tmpDir().appendingPathComponent("scaffold-test")

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [script.path, "--yes", target.path]
        let stderrPipe = Pipe()
        process.standardError = stderrPipe
        try process.run()
        process.waitUntilExit()

        let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        XCTAssertEqual(process.terminationStatus, 0, "scaffold.sh failed: \(stderr)")
        XCTAssertFalse(stderr.contains("here document"), "heredoc scratch-file error reintroduced: \(stderr)")

        let cfg = try String(contentsOf: target.appendingPathComponent(".site-config"), encoding: .utf8)
        XCTAssertTrue(cfg.contains("ANGLESITE_VERSION=1.0.0"))
        XCTAssertTrue(cfg.contains("# SITE_URL=https://example.com"))
        XCTAssertTrue(cfg.contains("# BLOCK_AI=true"))
    }

    func testGitInitFailureIsNonFatalAndStillRegisters() async throws {
        let root = tmpDir()
        let registered = OSAllocatedUnfairLock<Bool>(initialState: false)
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: URL(fileURLWithPath: "/template"), catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: CallRecorder()),
            gitInit: { _ in throw CocoaError(.fileWriteUnknown) },
            gitCommit: { _ in },
            register: { pkg in
                registered.withLock { $0 = true }
                return try SiteStore.Site.make(package: pkg)
            }
        )
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }
        XCTAssertTrue(registered.withLock { $0 }, "git init failure should not block registration")
        XCTAssertTrue(steps.contains { if case .warning(let s, _) = $0 { return s == "copyingTemplate" }; return false })
        guard case .done? = steps.last else { return XCTFail("expected .done despite git init failure") }
    }

    func testGitCommitFailureIsNonFatalAndStillRegisters() async throws {
        let root = tmpDir()
        let registered = OSAllocatedUnfairLock<Bool>(initialState: false)
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: URL(fileURLWithPath: "/template"), catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: CallRecorder()),
            gitInit: { _ in },
            gitCommit: { _ in throw CocoaError(.fileWriteUnknown) },
            register: { pkg in
                registered.withLock { $0 = true }
                return try SiteStore.Site.make(package: pkg)
            }
        )
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }
        XCTAssertTrue(registered.withLock { $0 }, "initial-commit failure should not block registration")
        XCTAssertTrue(steps.contains { if case .warning(let s, let m) = $0 { return s == "writingContent" && m.contains("Initial commit skipped") }; return false })
        guard case .done? = steps.last else { return XCTFail("expected .done despite initial-commit failure") }
    }

    /// Regression coverage for the missing-initial-commit bug: a brand-new site's `gitInit`
    /// closure creates a real `.git` (via `GitInitRunner`, same as production) and `gitCommit`
    /// creates a real commit (via `RepoBootstrap.commitAll`, same as production) — asserting the
    /// scaffolded repo actually has a `HEAD` afterward, not just that the closures were called.
    /// Without the fix, `Source/` had a `.git` but zero commits, so a container runtime cloning
    /// it and running `git checkout HEAD` failed and the site could never preview.
    func testHappyPathLandsARealInitialCommit() async throws {
        let root = tmpDir()
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: URL(fileURLWithPath: "/template"), catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: CallRecorder()),
            gitInit: { sourceDir in
                try GitInitRunner.run(in: sourceDir)
            },
            gitCommit: { sourceDir in try await RepoBootstrap.live().commitAll(source: sourceDir) },
            register: { pkg in try SiteStore.Site.make(package: pkg) }
        )
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }
        guard case .done? = steps.last else { return XCTFail("expected .done, got \(String(describing: steps.last))") }

        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        let sourceDir = pkgURL.appendingPathComponent("Source")
        let git = URL(fileURLWithPath: "/usr/bin/git")
        let log = try await ProcessSupervisor.shared.run(
            executable: git, arguments: ["log", "--oneline"], currentDirectoryURL: sourceDir)
        XCTAssertEqual(log.exitCode, 0, "git log failed — no initial commit was created: \(log.stderr)")
        XCTAssertFalse(log.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                       "expected at least one commit in the freshly scaffolded Source/ repo")
    }
}

/// Tiny test helper: records command-runner calls behind an actor (no data race in @Sendable).
actor CallRecorder {
    private(set) var calls: [String] = []
    func append(_ s: String) { calls.append(s) }
}
