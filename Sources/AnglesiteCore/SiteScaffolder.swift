import Foundation
import AnglesiteSiteModel

/// Runs the deterministic new-site pipeline and emits progress. No Claude. Every subprocess
/// goes through the injected `CommandRunner` (production: `ProcessSupervisor.shared.run`).
public actor SiteScaffolder {

    /// Progress events from the pipeline, in emission order. The milestone cases mark a step
    /// *starting* (the wizard's progress list checks them off as they arrive); `warning` reports
    /// a non-fatal problem within a step without stopping the pipeline, while `failed` is
    /// terminal — the stream finishes after it, as it does after `done`.
    public enum ScaffoldStep: Sendable, Equatable {
        /// Milestone steps: package skeleton, template copy, theme, homepage/content writes,
        /// dependency install (delegated to the runtime), and registry recording.
        case creatingFolder, copyingTemplate, applyingTheme, writingContent, installing, registering
        /// A step partially failed but the site is still viable (e.g. theme not applied, git init
        /// skipped); `step` names the milestone it happened within.
        case warning(step: String, message: String)
        /// A fatal failure in `step`; nothing after it ran, and no site was registered.
        case failed(step: String, message: String)
        /// The pipeline finished and the package is registered; `siteID` is the recorded site's
        /// registry ID, ready to open.
        case done(siteID: String)
    }

    /// Run a command, return its result. cwd may be nil.
    public typealias CommandRunner = @Sendable (_ executable: URL, _ args: [String], _ cwd: URL?) async throws -> ProcessSupervisor.RunResult
    /// Register a freshly-scaffolded package and return the Site (production: SiteStore.shared.record).
    public typealias Register = @Sendable (_ package: AnglesitePackage) async throws -> SiteStore.Site
    /// Initialize a git repo in the source dir (production: `git init` via ProcessSupervisor).
    public typealias GitInit = @Sendable (_ sourceDirectory: URL) async throws -> Void
    /// Land the initial commit once template/theme/content are all written (production:
    /// `RepoBootstrap.commitAll` — local init+commit only, no GitHub).
    public typealias GitCommit = @Sendable (_ sourceDirectory: URL) async throws -> Void

    private let sitesRoot: URL
    private let templateURL: URL
    private let catalog: ThemeCatalog
    private let run: CommandRunner
    private let gitInit: GitInit
    private let gitCommit: GitCommit
    private let register: Register
    private let fileManager: FileManager
    private let appVersion: @Sendable () -> String?
    private let hostLanguage: @Sendable () -> String

    /// `catalog` (not a fixed theme) so the owner's Look-step choice resolves at pipeline time
    /// from `draft.themeID`. `appVersion` defaults to `AppVersion.current()` (i.e. `Bundle.main`);
    /// tests inject a fixed string since `Bundle.main` inside `swift test` is the test runner and
    /// has no `CFBundleShortVersionString`. `hostLanguage` defaults to
    /// `SiteLanguageAsset.hostLanguageTag()` (i.e. `Locale.current`); tests inject a fixed tag
    /// since the host locale running `swift test` varies by machine (#956).
    public init(sitesRoot: URL, templateURL: URL, catalog: ThemeCatalog,
                run: @escaping CommandRunner, gitInit: @escaping GitInit,
                gitCommit: @escaping GitCommit,
                register: @escaping Register, fileManager: FileManager = .default,
                appVersion: @escaping @Sendable () -> String? = { AppVersion.current() },
                hostLanguage: @escaping @Sendable () -> String = { SiteLanguageAsset.hostLanguageTag() }) {
        self.sitesRoot = sitesRoot
        self.templateURL = templateURL
        self.catalog = catalog
        self.run = run
        self.gitInit = gitInit
        self.gitCommit = gitCommit
        self.register = register
        self.fileManager = fileManager
        self.appVersion = appVersion
        self.hostLanguage = hostLanguage
    }

    /// Runs the whole pipeline for the wizard's finished draft, streaming ``ScaffoldStep``s as it
    /// goes. `nonisolated` and immediately returning: the stream is the only result channel —
    /// success is `.done`, failure `.failed`, and the stream finishes after either — so the
    /// wizard binds its progress UI to this without awaiting the actor.
    public nonisolated func scaffold(_ draft: NewSiteDraft) -> AsyncStream<ScaffoldStep> {
        AsyncStream<ScaffoldStep>(bufferingPolicy: .unbounded) { continuation in
            Task {
                await self.runPipeline(draft) { step in continuation.yield(step) }
                continuation.finish()
            }
        }
    }

    private func runPipeline(_ draft: NewSiteDraft, emit: @Sendable (ScaffoldStep) -> Void) async {
        let fileName = packageFileName(for: draft)
        let parentURL = draft.saveDirectory ?? sitesRoot
        let packageURL = parentURL.appendingPathComponent(fileName, isDirectory: true)

        // 1. Package skeleton (dir + Source/ + Config/ + Info.plist marker).
        emit(.creatingFolder)
        let package: AnglesitePackage
        do {
            (package, _) = try AnglesitePackage.createSkeleton(at: packageURL, displayName: draft.name, fileManager: fileManager)
        } catch { return emit(.failed(step: "creatingFolder", message: humanize(error))) }
        let siteDir = package.sourceURL   // everything below runs in Source/

        // 2. scaffold.sh (cwd = Source/)
        emit(.copyingTemplate)
        let scaffoldScript = templateURL.appendingPathComponent("scripts/scaffold.sh")
        do {
            let r = try await run(URL(fileURLWithPath: "/bin/zsh"),
                                  [scaffoldScript.path, "--yes", siteDir.path], siteDir)
            if r.exitCode != 0 {
                return emit(.failed(step: "copyingTemplate", message: "Couldn't create the site files.\n\(r.stderr)"))
            }
        } catch { return emit(.failed(step: "copyingTemplate", message: humanize(error))) }

        // Write the dependency baseline (spec §3) and correct the ANGLESITE_VERSION
        // stamp scaffold.sh just wrote (it hardcodes a "1.0.0" placeholder — the real
        // value is a Swift-side concern, since scaffold.sh has no access to the running
        // app's version). Both are best-effort: a failure here must never fail the
        // overall scaffold, since the site itself was already created successfully —
        // but unlike the version stamp, losing the baseline silently disables
        // dependency-sync for this site going forward, so it surfaces as a warning.
        let configDir = package.configURL
        do {
            let templatePackageText = try String(
                contentsOf: templateURL.appendingPathComponent("package.json"), encoding: .utf8)
            let templateDeps = try PackageJSONDependencies.extract(from: templatePackageText)
            try DependencyBaseline.save(templateDeps, to: configDir)
        } catch {
            emit(.warning(step: "copyingTemplate", message: "Dependency baseline not saved: \(humanize(error))"))
        }
        if let currentAppVersion = appVersion() {
            let siteConfigURL = siteDir.appendingPathComponent(".site-config")
            let existingConfig = (try? String(contentsOf: siteConfigURL, encoding: .utf8)) ?? ""
            let updatedConfig = SiteConfigFile.upsert([("ANGLESITE_VERSION", currentAppVersion)], into: existingConfig)
            try? updatedConfig.write(to: siteConfigURL, atomically: true, encoding: .utf8)
        }

        // 2b. git init in Source/ (non-fatal — coordinates with #68).
        do { try await gitInit(siteDir) }
        catch { emit(.warning(step: "copyingTemplate", message: "git init skipped: \(humanize(error))")) }

        // 3. Theme (non-fatal). Resolve the owner's chosen theme; fall back to the first available.
        emit(.applyingTheme)
        if let theme = resolvedTheme(for: draft) {
            do { try ThemeApplier.apply(theme, siteDirectory: siteDir, fileManager: fileManager) }
            catch { emit(.warning(step: "applyingTheme", message: humanize(error))) }
        } else {
            emit(.warning(step: "applyingTheme", message: "No themes available; left default look."))
        }

        // 4. Homepage (non-fatal). Skipped when the draft has no content at all — the chooser
        // flow (#1071) ships the template's placeholder copy for the owner to edit in the
        // preview; intents/AI paths that supply real words still get them written.
        emit(.writingContent)
        let metadataDescription = draft.tagline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? draft.blurb
            : draft.tagline
        let hasHomepageContent = !draft.headline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !draft.blurb.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if hasHomepageContent {
            do { try HomepageWriter.write(headline: draft.headline, blurb: draft.blurb,
                                          tagline: metadataDescription, siteDirectory: siteDir, fileManager: fileManager) }
            catch { emit(.warning(step: "writingContent", message: humanize(error))) }
        }

        var logoPublicPath: String?
        if let logo = draft.logoURL {
            do {
                logoPublicPath = try LogoAsset.install(from: logo, siteName: draft.name,
                                                       siteDirectory: siteDir, fileManager: fileManager)
            } catch {
                emit(.warning(step: "writingContent", message: "Logo not added: \(humanize(error))"))
            }
        }

        // Cloudflare Worker config (#701): a per-site-unique name (the same slug the wizard's
        // uniqueness check ran against) so a fresh site is deployable without hand-editing
        // wrangler.toml, and two sites never clobber each other's Worker.
        let projectSlug = SiteSlug.derive(from: draft.name)
        do { try writeWranglerConfig(siteName: projectSlug, siteDir: siteDir) }
        catch { emit(.warning(step: "writingContent", message: "Cloudflare Worker config not written: \(humanize(error))")) }

        do { try appendSiteConfig(draft, logoPublicPath: logoPublicPath, metadataDescription: metadataDescription, siteDir: siteDir, cfProjectName: projectSlug) }
        catch { emit(.warning(step: "writingContent", message: "Site metadata not written: \(humanize(error))")) }

        // 4b. Optional hero image (Image Playground, #92) — non-blocking. Only when the owner
        // generated one in the wizard; copies it into public/ and references it from the homepage.
        if let hero = draft.heroImageURL {
            do {
                try HeroImage.install(from: hero, headline: draft.headline, siteName: draft.name,
                                      siteDirectory: siteDir, fileManager: fileManager)
            } catch {
                emit(.warning(step: "writingContent", message: "Hero image not added: \(humanize(error))"))
            }
        }

        // 4c. Initial commit, once all template/theme/content writes above have landed (non-fatal,
        // matching git init's handling above). Without this, a freshly scaffolded site has no
        // commits, so a container runtime that clones it and runs `git checkout HEAD` fails and
        // the site can never preview.
        do { try await gitCommit(siteDir) }
        catch { emit(.warning(step: "writingContent", message: "Initial commit skipped: \(humanize(error))")) }

        // 5. Dependency install is handled by the selected runtime after scaffold.
        emit(.installing)

        // 6. Register the package
        emit(.registering)
        do {
            let site = try await register(package)
            emit(.done(siteID: site.id))
        } catch { emit(.failed(step: "registering", message: humanize(error))) }
    }

    /// Writes a static-only `wrangler.toml` (no social features) so the site is deployable via
    /// `npx wrangler deploy` with no manual setup. `SocialWorkerProvisionCommand` overwrites this
    /// with a features-enabled config if the owner opts into social features later.
    private func writeWranglerConfig(siteName: String, siteDir: URL) throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: siteName, workers: [])
        try toml.write(to: siteDir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
    }

    /// Append owner answers without clobbering existing lines (e.g. ANGLESITE_VERSION).
    private func appendSiteConfig(_ draft: NewSiteDraft, logoPublicPath: String?,
                                  metadataDescription: String, siteDir: URL, cfProjectName: String) throws {
        var values: [(String, String)] = [("SITE_NAME", draft.name)]
        // `.blank` is the chooser flow's "no answer" (#1071) — nothing reads SITE_TYPE back,
        // so an unasked question writes no key rather than a fake answer.
        if draft.siteType != .blank { values.append(("SITE_TYPE", draft.siteType.rawValue)) }
        values.append(contentsOf: [
            ("DOMAIN_CHOICE", draft.domainChoice.rawValue),
            ("CF_PROJECT_NAME", cfProjectName),
            ("LANG", hostLanguage()),
        ])
        if draft.domainChoice == .transfer && !draft.domain.isEmpty { values.append(("DOMAIN", draft.domain)) }
        if draft.themeID == CustomTheme.id {
            values.append(contentsOf: [
                ("THEME", CustomTheme.id),
                ("COLOR_PRIMARY", draft.customPrimaryColor),
                ("COLOR_ACCENT", draft.customAccentColor),
            ])
        } else {
            values.append(("THEME", draft.themeID))
        }
        if !metadataDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            values.append(("TAGLINE", metadataDescription))
        }
        if let logoPublicPath { values.append(("LOGO", logoPublicPath)) }
        try appendSiteConfigValues(values, siteDir: siteDir)
    }

    private func appendSiteConfigValues(_ values: [(String, String)], siteDir: URL) throws {
        let url = siteDir.appendingPathComponent(".site-config")
        let contentsExists = fileManager.fileExists(atPath: url.path)
        var contents = contentsExists ? try String(contentsOf: url, encoding: .utf8) : ""
        func setKey(_ key: String, _ value: String) {
            guard !contents.contains("\n\(key)=") && !contents.hasPrefix("\(key)=") else { return }
            if !contents.isEmpty && !contents.hasSuffix("\n") { contents += "\n" }
            contents += "\(key)=\(Self.safeConfigValue(value))\n"
        }
        for (key, value) in values { setKey(key, value) }
        try contents.write(to: url, atomically: true, encoding: .utf8)
    }

    private static func safeConfigValue(_ value: String) -> String {
        (value.components(separatedBy: .newlines).first ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func resolvedTheme(for draft: NewSiteDraft) -> Theme? {
        if draft.themeID == CustomTheme.id {
            return CustomTheme.make(primary: draft.customPrimaryColor, accent: draft.customAccentColor)
        }
        return catalog.theme(id: draft.themeID) ?? catalog.themes.first
    }

    private func packageFileName(for draft: NewSiteDraft) -> String {
        let raw = draft.saveFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = raw.isEmpty ? "\(SiteSlug.derive(from: draft.name)).anglesite" : raw
        return base.hasSuffix(".anglesite") ? base : "\(base).anglesite"
    }

    private func humanize(_ error: Error) -> String { (error as NSError).localizedDescription }
}
