import AppKit
import UniformTypeIdentifiers
import AnglesiteCore

/// File-menu / launcher actions that are window-independent. Today this is just the
/// “open an existing package as a site” flow, extracted from `SitesLauncherView.openFolder()`
/// so the File ▸ Open Site… command and the launcher footer share one implementation —
/// in particular the MAS security-scoped-bookmark minting, which must live in exactly one place.
@MainActor
enum SiteActions {
    /// Surfaced when registering a chosen package fails. Carries the package name so callers
    /// get a readable, location-specific message via `localizedDescription` — the regression
    /// that motivated this was a generic “couldn't add the chosen folder” that dropped the name.
    struct ImportError: LocalizedError {
        let folderName: String
        let underlying: Error
        var errorDescription: String? {
            String(localized: "Couldn't add “\(folderName)”: \(underlying.localizedDescription)")
        }
    }

    /// Register an existing `.anglesite` package and (on MAS) mint its security-scoped bookmark —
    /// the ONLY mint call site, shared by every open path: Finder-open (`onOpenURL`), launcher
    /// drag-drop (#524), the Dock menu, File ▸ Open Site… (`pickAndRegisterSite`), and Import
    /// (`importPackage`). `record` reads and validates the marker, throwing a legible error for
    /// non-packages.
    static func registerPackage(at url: URL) async throws -> SiteStore.Site {
        try await registerPackage(AnglesitePackage(url: url))
    }

    /// Variant for callers that already hold a constructed package (Import creates one via
    /// `PackageTransfer` before registering). Every open path funnels through here, which makes
    /// this the natural heal-on-open point (#877): before recording, migrate the package to the
    /// split-repo layout if it still has an embedded `Source/.git` — already-split packages are a
    /// no-op. `siteStore` is an injection seam for tests; production always uses `.shared`.
    static func registerPackage(_ package: AnglesitePackage, siteStore: SiteStore = .shared) async throws -> SiteStore.Site {
        // `migrate`'s file coordination (NSFileCoordinator) can block waiting on iCloud Drive to
        // relinquish the item — run it off the main actor so heal-on-open doesn't stall the UI.
        // `AnglesitePackage` is `Sendable`, so it crosses into the detached task safely.
        try await Task.detached {
            _ = try RepoRelocator.migrate(package: package)
        }.value
        let site = try await siteStore.record(package)
        #if ANGLESITE_MAS
        // The current access grant (open panel, drag, or LaunchServices open) is the only chance
        // to mint a scoped bookmark — persist it now so the grant survives relaunch. Mint from
        // `site.packageURL` (the canonicalized path the store recorded) so the bookmark's path
        // matches what subprocesses are spawned against. Propagate failures (never `try?`): a
        // grantless site silently fails to preview at open.
        let bookmark = try SecurityScopedBookmark.create(for: site.packageURL)
        try await siteStore.setBookmark(bookmark, for: site.id)
        #endif
        return site
    }

    /// Copy a plain Anglesite directory into a package, bootstrap its `Source/` as a committable
    /// git repo, then register the package. Kept separate from the panel flow so the migration
    /// behavior is unit-testable without driving AppKit.
    static func importDirectory(
        _ sourceDir: URL,
        toPackageAt dest: URL,
        displayName: String,
        bootstrapGit: @escaping @Sendable (_ sourceDirectory: URL) async throws -> Void = { sourceDirectory in
            try await RepoBootstrap.live().commitAll(source: sourceDirectory)
        },
        register: @escaping @MainActor @Sendable (_ package: AnglesitePackage) async throws -> SiteStore.Site = { package in
            try await registerPackage(package)
        }
    ) async throws -> SiteStore.Site {
        // The tree copy can be large (it may include node_modules) — run it off the main actor so
        // the import doesn't stall the UI. On failure after the copy created the package, clean up
        // the orphan; a `destinationExists` throw comes from importDirectory itself (before it
        // creates anything), so it lands in the caller's catch and never deletes a pre-existing dir.
        let pkg = try await Task.detached {
            try PackageTransfer.importDirectory(sourceDir, toPackageAt: dest, displayName: displayName)
        }.value
        do {
            try ensureImportGitignore(in: pkg.sourceURL)
            try await bootstrapGit(pkg.sourceURL)
            return try await register(pkg)
        } catch {
            // Git bootstrap or record/bookmark failed after importDirectory wrote the package —
            // remove the orphan (we created it this call) so it isn't left invisible-and-unopenable
            // on disk. If registration persisted the recents entry before a later failure (for
            // example bookmark minting in MAS), unwind that entry too.
            if let marker = try? pkg.readMarker() {
                try? await SiteStore.shared.remove(id: marker.siteID.uuidString)
            }
            try? FileManager.default.removeItem(at: pkg.url)
            throw error
        }
    }

    /// Import can receive a plain, non-git working directory that already has local build output
    /// or secrets. Seed the baseline ignores before `RepoBootstrap.commitAll` stages everything.
    private static func ensureImportGitignore(in sourceDirectory: URL, fileManager: FileManager = .default) throws {
        let url = sourceDirectory.appendingPathComponent(".gitignore")
        let required = [
            "node_modules/",
            "dist/",
            ".astro/",
            ".wrangler/",
            ".env*",
        ]
        var existing = fileManager.fileExists(atPath: url.path)
            ? try String(contentsOf: url, encoding: .utf8)
            : ""
        let lines = Set(existing.split(whereSeparator: \.isNewline).map(String.init))
        let missing = required.filter { !lines.contains($0) }
        guard !missing.isEmpty else { return }

        if !existing.isEmpty && !existing.hasSuffix("\n") { existing += "\n" }
        if !existing.isEmpty { existing += "\n" }
        existing += "# Local build artifacts and secrets are not committed by Anglesite imports.\n"
        existing += missing.joined(separator: "\n")
        existing += "\n"
        try existing.write(to: url, atomically: true, encoding: .utf8)
    }

    #if ANGLESITE_MAS
    /// Obtain (or reuse) a security-scoped grant to `sitesRoot` under the sandboxed (MAS) build.
    /// Shared by `SitesLauncherView.presentNewSite()` and `importPackage()` below — MAS
    /// security-scoped-bookmark minting lives in exactly one place (see this enum's doc comment).
    /// Returns the started-accessing URL, or nil if the user cancelled the grant panel.
    static func ensureSitesRootAccess(_ sitesRoot: URL) async -> URL? {
        if let data = AppSettings.shared.sitesRootBookmark,
           let resolved = try? SecurityScopedBookmark.resolve(data),
           resolved.url.startAccessingSecurityScopedResource() {
            if resolved.isStale, let fresh = try? SecurityScopedBookmark.create(for: resolved.url) {
                AppSettings.shared.sitesRootBookmark = fresh
            }
            return resolved.url
        }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.directoryURL = sitesRoot
        panel.prompt = String(localized: "Grant Access")
        panel.message = String(localized: "Choose your Sites folder so Anglesite can create the new site there.")
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        if let data = try? SecurityScopedBookmark.create(for: url) {
            AppSettings.shared.sitesRootBookmark = data
        }
        return url.startAccessingSecurityScopedResource() ? url : nil
    }
    #endif

    /// Pick a plain Anglesite directory, choose where to save the new package, copy it in, and
    /// register the package. Returns the new site, or nil if either panel was cancelled.
    static func importPackage() async throws -> SiteStore.Site? {
        let picker = NSOpenPanel()
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.allowsMultipleSelection = false
        picker.prompt = String(localized: "Choose")
        picker.message = String(localized: "Choose an existing Anglesite site folder to import.")
        guard picker.runModal() == .OK, let sourceDir = picker.url else { return nil }

        // NSSavePanel silently ignores a directoryURL that doesn't exist yet and reverts to its
        // last-used location, so create the sites root first — otherwise Import as a fresh
        // install's first action wouldn't default into the Anglesite folder at all (#865). Under
        // the sandbox this can need the same security-scoped grant New Site needs — gate on the
        // declared source, not a write probe (createDirectory reports success for an existing but
        // unwritable directory, so probing alone silently no-ops here — #865 PR review), and hold
        // the scope open for the rest of this function via `defer`.
        let sitesRoot = AppSettings.shared.sitesRoot
        var scopedRootURL: URL?
        defer { scopedRootURL?.stopAccessingSecurityScopedResource() }
        #if ANGLESITE_MAS
        if AppSettings.shared.sitesRootSource != .iCloudContainer {
            guard let rootScope = await ensureSitesRootAccess(sitesRoot) else { return nil }  // user cancelled
            scopedRootURL = rootScope
        }
        #endif
        try? FileManager.default.createDirectory(at: sitesRoot, withIntermediateDirectories: true)

        let name = sourceDir.deletingPathExtension().lastPathComponent
        let save = NSSavePanel()
        save.message = String(localized: "Save the imported site package.")
        save.nameFieldStringValue = "\(name).anglesite"
        save.directoryURL = sitesRoot
        guard save.runModal() == .OK, let dest = save.url else { return nil }

        do {
            return try await importDirectory(sourceDir, toPackageAt: dest, displayName: name)
        } catch {
            throw ImportError(folderName: sourceDir.lastPathComponent, underlying: error)
        }
    }

    /// Export the given site's source tree to a chosen folder, with an opt-in for `.git` history.
    static func exportSource(of site: SiteStore.Site) {
        let save = NSSavePanel()
        save.message = String(localized: "Export this site's source files to a folder.")
        save.nameFieldStringValue = site.name
        let gitToggle = NSButton(checkboxWithTitle: String(localized: "Include Git history (.git)"), target: nil, action: nil)
        gitToggle.state = .off
        let accessory = NSView(frame: NSRect(x: 0, y: 0, width: 280, height: 28))
        gitToggle.frame = NSRect(x: 12, y: 4, width: 256, height: 20)
        accessory.addSubview(gitToggle)
        save.accessoryView = accessory
        guard save.runModal() == .OK, let dest = save.url else { return }
        let includeGit = gitToggle.state == .on
        let pkgURL = site.packageURL
        // Off-load the copy from the main actor; surface any failure back on main via NSAlert.
        Task.detached {
            do {
                try PackageTransfer.exportSource(of: AnglesitePackage(url: pkgURL), to: dest, includeGit: includeGit)
            } catch {
                await MainActor.run { NSAlert(error: error).runModal() }
            }
        }
    }

    /// Surfaced by `reauthorize(_:)` when the folder picked in the "Locate…" panel isn't the same
    /// package as the site being repaired — guards against silently rebinding a recents entry to
    /// an unrelated package that happens to share a name (#776).
    struct ReauthorizationMismatchError: LocalizedError {
        var errorDescription: String? {
            String(localized: "That's a different site — choose the original package folder instead.")
        }
    }

    /// True when `picked`'s marker UUID matches `expectedID`.
    static func markerMatches(_ picked: AnglesitePackage, expectedID: String) -> Bool {
        (try? picked.readMarker())?.siteID.uuidString == expectedID
    }

    /// Re-grant access to `site` after its security-scoped bookmark stopped resolving (#776 — a
    /// reboot, or a preceding runtime failure, can invalidate the sandbox extension even though
    /// the package on disk is untouched). Prompts an `NSOpenPanel` anchored at the site's
    /// last-known location, confirms the chosen folder is the SAME package by marker UUID (not
    /// just path), then re-registers it through the shared `registerPackage` path — which
    /// re-validates against the just-granted access and mints a fresh bookmark, healing both
    /// `isValid` and `needsReauthorization` for every observer of `SiteStore.changeStream()`.
    ///
    /// - Returns: the healed site, or `nil` if the panel was cancelled.
    /// - Throws: `ImportError` wrapping `ReauthorizationMismatchError` on a mismatched pick, or any
    ///   error from re-registration.
    static func reauthorize(_ site: SiteStore.Site) async throws -> SiteStore.Site? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.anglesiteSite]
        panel.treatsFilePackagesAsDirectories = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = site.packageURL.deletingLastPathComponent()
        panel.prompt = String(localized: "Grant Access")
        panel.message = String(
            localized: "Anglesite lost access to “\(site.name)”, likely after a restart. Locate it again to restore access."
        )
        guard panel.runModal() == .OK, let url = panel.url else { return nil }

        let package = AnglesitePackage(url: url)
        guard markerMatches(package, expectedID: site.id) else {
            throw ImportError(folderName: url.lastPathComponent, underlying: ReauthorizationMismatchError())
        }
        do {
            return try await registerPackage(package)
        } catch {
            throw ImportError(folderName: url.lastPathComponent, underlying: error)
        }
    }

    /// Run the package picker, register the chosen `.anglesite` package with `SiteStore`, and
    /// (on MAS) mint + persist a security-scoped bookmark so the grant survives relaunch.
    ///
    /// - Returns: the newly registered site, or `nil` if the user cancelled the panel.
    /// - Throws: `ImportError` (naming the chosen package) if registration or bookmarking fails.
    static func pickAndRegisterSite() async throws -> SiteStore.Site? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.anglesiteSite]
        panel.treatsFilePackagesAsDirectories = false
        panel.allowsMultipleSelection = false
        panel.prompt = String(localized: "Open")
        panel.message = String(localized: "Choose an Anglesite site package.")
        guard panel.runModal() == .OK, let url = panel.url else { return nil }

        do {
            return try await registerPackage(at: url)
        } catch {
            throw ImportError(folderName: url.lastPathComponent, underlying: error)
        }
    }
}
