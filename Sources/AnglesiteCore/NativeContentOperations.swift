// Sources/AnglesiteCore/NativeContentOperations.swift
import Foundation
#if canImport(Darwin)
import SwiftGit2
#endif

/// Native, in-process `create_page` / `create_post`. Byte-faithful to the Node sidecar's
/// `create-content.mjs` (see `ContentScaffold`), but writes the file with `FileManager` and
/// commits best-effort via an injected git closure — no MCP round-trip. Replaces the
/// MCP-routed `ContentOperations` at the App Intents dependency registration.
public struct NativeContentOperations: ContentOperationsService {

    public typealias GitCommit = @Sendable (_ projectRoot: URL, _ relPath: String, _ message: String) async -> String?
    public typealias GitDelete = @Sendable (_ projectRoot: URL, _ relPath: String, _ message: String) async -> String?
    /// Whether `projectRoot`'s commit history already contains a commit whose message is exactly
    /// `message` — used by `publish` to tell a first-time publish from a republish (#798), without
    /// a persisted "everPublished" flag. Injectable for the same reason `GitCommit`/`GitDelete` are:
    /// tests supply a fake in-memory history instead of a real git repo.
    public typealias GitHasCommit = @Sendable (_ projectRoot: URL, _ message: String) async -> Bool

    private let siteDirectory: @Sendable (_ siteID: String) async -> URL?
    private let gitCommit: GitCommit
    private let gitDelete: GitDelete
    private let gitHasCommit: GitHasCommit
    private let now: @Sendable () -> Date
    private let copyGenerator: any PageCopyGenerating
    // FileManager is a thread-safe singleton but not Sendable; nonisolated(unsafe) preserves the
    // test-injection seam (the plan's intended seam for write-failure paths) without breaking the
    // struct's Sendable conformance.
    private nonisolated(unsafe) let fileManager: FileManager

    public init(
        siteDirectory: @escaping @Sendable (_ siteID: String) async -> URL?,
        gitCommit: @escaping GitCommit = NativeContentOperations.processGitCommit,
        gitDelete: @escaping GitDelete = NativeContentOperations.processGitDelete,
        gitHasCommit: @escaping GitHasCommit = NativeContentOperations.hasCommit,
        now: @escaping @Sendable () -> Date = { Date() },
        copyGenerator: any PageCopyGenerating = NoopPageCopyGenerator(),
        fileManager: FileManager = .default
    ) {
        self.siteDirectory = siteDirectory
        self.gitCommit = gitCommit
        self.gitDelete = gitDelete
        self.gitHasCommit = gitHasCommit
        self.now = now
        self.copyGenerator = copyGenerator
        self.fileManager = fileManager
    }

    public func createPage(siteID: String, name: String, route: String?, onProgress: ProgressHandler? = nil) async -> ContentCreateResult {
        await createPage(siteID: siteID, name: name, route: route, template: .standard, onProgress: onProgress)
    }

    public func createPage(
        siteID: String,
        name: String,
        route: String?,
        template: ContentScaffold.PageTemplate,
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        onProgress?(.createResolvingRuntime)
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }

        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return .failed(reason: "create_page requires a non-empty name") }

        let base = route.flatMap { $0.isEmpty ? nil : $0 } ?? ContentScaffold.slugify(title)
        let normalized = ContentScaffold.normalizeRoute(base)
        guard normalized != "/" else {
            return .failed(reason: "create_page can't scaffold the site root; give the page a name or route")
        }

        let relPath = ContentScaffold.pageRelativePath(normalizedRoute: normalized)
        let abs = root.appendingPathComponent(relPath)
        if fileManager.fileExists(atPath: abs.path) {
            return .failed(reason: "A page already exists at \(relPath)")
        }

        onProgress?(.createCallingPlugin)
        let suggestion = await copyGenerator.suggestDescription(title: title, siteID: siteID, siteDirectory: root)
        let contents = ContentScaffold.renderPage(
            title: title,
            layoutImport: ContentScaffold.layoutImport(normalizedRoute: normalized),
            template: template,
            description: suggestion?.description)
        do { try write(contents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        onProgress?(.createFinalizing)
        _ = await gitCommit(root, relPath, "anglesite: add page \(normalized)")
        return .created(filePath: relPath, identifier: normalized)
    }

    public func createPost(siteID: String, title: String, collection: String?, slug: String?, onProgress: ProgressHandler? = nil) async -> ContentCreateResult {
        onProgress?(.createResolvingRuntime)
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }

        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return .failed(reason: "create_post requires a non-empty title") }

        let trimmedColl = (collection ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let coll = trimmedColl.isEmpty ? "posts" : trimmedColl
        guard coll.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            return .failed(reason: "Invalid collection name: \(coll)")
        }

        let slugSource = slug.flatMap { $0.isEmpty ? nil : $0 } ?? cleanTitle
        let finalSlug = ContentScaffold.slugify(slugSource)
        guard !finalSlug.isEmpty else { return .failed(reason: "create_post could not derive a slug from the title") }

        let relPath = ContentScaffold.postRelativePath(collection: coll, slug: finalSlug)
        let abs = root.appendingPathComponent(relPath)
        if fileManager.fileExists(atPath: abs.path) {
            return .failed(reason: "A \(coll) entry already exists at \(relPath)")
        }

        onProgress?(.createCallingPlugin)
        let suggestion = await copyGenerator.suggestDescription(title: cleanTitle, siteID: siteID, siteDirectory: root)
        let contents = ContentScaffold.renderPost(title: cleanTitle, now: now(), description: suggestion?.description ?? "")
        do { try write(contents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        onProgress?(.createFinalizing)
        _ = await gitCommit(root, relPath, "anglesite: add \(coll) \(finalSlug)")
        return .created(filePath: relPath, identifier: finalSlug)
    }

    /// `ContentOperationsService` witness: derive the slug from `title` alone. Mirrors the plugin's
    /// `create_content` MCP tool, which takes only `{ type, title }`.
    public func createTyped(siteID: String, typeID: String, title: String, onProgress: ProgressHandler? = nil) async -> ContentCreateResult {
        await createTyped(siteID: siteID, typeID: typeID, title: title, slug: nil, onProgress: onProgress)
    }

    /// Create a typed content entry (V-1.2). Looks the type up in `registry`, derives a slug from
    /// `slug ?? title ?? <target URL>`, renders frontmatter via `ContentScaffold.renderEntry`, writes
    /// it, and commits — the same write/commit path as `createPost`. Collection-stored types only;
    /// singleton-stored types (e.g. the `profile` identity) go through `createTypedSingleton`. The
    /// explicit-`slug` overload is the native path's superset over the MCP witness (SiteWindow's
    /// per-type editor passes a caller-chosen slug).
    ///
    /// `fieldValues` carries values collected before the write (the New Collection sheet's URL
    /// rows). Every required `.url` field must have one that passes
    /// `ContentFieldValidation.isAbsoluteURL`, and any supplied optional `.url` must too — this is
    /// the boundary that makes a schema-invalid entry unwritable by *any* caller, not just the
    /// sheet (#916). Note the `ContentOperationsService` protocol witness above is title-only, so a
    /// non-native runtime cannot carry field values; unreachable today, and widening the protocol
    /// would ripple into `RemoteSandboxSiteRuntime` (#66) / `LocalContainerSiteRuntime` (#69) for no
    /// present benefit — same reasoning as the `createTypedSingleton` TODO below.
    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?,
        fieldValues: [String: String] = [:],
        registry: ContentTypeRegistry = ContentTypeRegistry(),
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        onProgress?(.createResolvingRuntime)
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        guard let descriptor = registry.descriptor(id: typeID) else {
            return .failed(reason: "Unknown content type: \(typeID)")
        }
        guard let collection = descriptor.collection else {
            return .failed(reason: "\(typeID) is not a collection type; use createTypedSingleton")
        }

        // Trimmed copy of `fieldValues`, built alongside the validation loop below: `.url` values
        // are trimmed here for both the guard and everything downstream, so the value that gets
        // validated is exactly the value that gets rendered and slugged — not the raw, untrimmed
        // input. Without this, a value like `"https://example.com/post\n"` passes validation (via
        // its trimmed copy) but the untrimmed original — which `ContentScaffold.escapeYAML` doesn't
        // clean up — is what reaches the file, splitting the YAML frontmatter (#916 follow-up).
        var trimmedFieldValues = fieldValues
        for field in descriptor.fields where field.kind == .url {
            let supplied = fieldValues[field.name]?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let supplied {
                trimmedFieldValues[field.name] = supplied
            }
            if field.required {
                guard let supplied, ContentFieldValidation.isAbsoluteURL(supplied) else {
                    return .failed(reason:
                        "\(descriptor.displayName) needs an absolute URL for \(field.name), "
                        + "e.g. https://example.com/post")
                }
            } else if let supplied, !supplied.isEmpty, !ContentFieldValidation.isAbsoluteURL(supplied) {
                return .failed(reason:
                    "\(field.name) must be an absolute URL, e.g. https://example.com/post")
            }
        }

        // Single-sourced so the slug date and `publishDate` can never disagree across a UTC
        // midnight boundary between the two `now()` calls this used to be.
        let createdAt = now()
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSlug = (slug ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // Slug precedence: explicit → title → target URL → type id. The URL step is what gives
        // `reply`/`like` a meaningful permalink now that they no longer ask for a throwaway title
        // (#916); it uses the first required `.url` field in declaration order, which is the only
        // one each of bookmark/reply/like declares.
        let urlSlug = descriptor.requiredURLFields.first
            .flatMap { trimmedFieldValues[$0.name] }
            .map { ContentScaffold.slugFromURL($0, now: createdAt) } ?? ""
        let slugSource = [cleanSlug, cleanTitle, urlSlug].first { !$0.isEmpty } ?? descriptor.id
        let finalSlug = ContentScaffold.slugify(slugSource)
        guard !finalSlug.isEmpty else { return .failed(reason: "createTyped could not derive a slug") }

        let relPath = ContentScaffold.postRelativePath(collection: collection, slug: finalSlug)
        let abs = root.appendingPathComponent(relPath)
        if fileManager.fileExists(atPath: abs.path) {
            return .failed(reason: "A \(collection) entry already exists at \(relPath)")
        }

        // No `.createCallingPlugin` here: this is a native Swift write with no plugin involved.
        // `.createFinalizing` (below) covers the write + commit milestone honestly.
        let contents = ContentScaffold.renderEntry(
            descriptor: descriptor, title: cleanTitle.isEmpty ? nil : cleanTitle, now: createdAt,
            fieldValues: trimmedFieldValues)
        do { try write(contents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        onProgress?(.createFinalizing)
        _ = await gitCommit(root, relPath, "anglesite: add \(collection) \(finalSlug)")
        return .created(filePath: relPath, identifier: finalSlug)
    }

    /// Create a per-site singleton (V-1.3 follow-up, #388) — e.g. the representative h-card.
    /// Looks the type up, resolves its `singletonSlot`, renders the JSON data module via
    /// `ContentScaffold.renderSingleton`, and writes it — refusing if the slot file already exists,
    /// which enforces one identity per site across both `businessProfile` and `personalProfile`
    /// (they share the `"profile"` slot). Same write/commit path as `createTyped`.
    ///
    /// TODO: add to the `ContentOperationsService` protocol when remote runtimes land
    /// (`RemoteSandboxSiteRuntime` #66, `LocalContainerSiteRuntime` #69) — they implement the
    /// protocol and currently have no path to create singletons.
    public func createTypedSingleton(
        siteID: String,
        typeID: String,
        name: String,
        registry: ContentTypeRegistry = ContentTypeRegistry(),
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        onProgress?(.createResolvingRuntime)
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        guard let descriptor = registry.descriptor(id: typeID) else {
            return .failed(reason: "Unknown content type: \(typeID)")
        }
        guard let slot = descriptor.singletonSlot else {
            return .failed(reason: "\(typeID) is not a singleton type")
        }

        let relPath = ContentScaffold.singletonRelativePath(slot: slot)
        let abs = root.appendingPathComponent(relPath)
        // The exists-check → write below is a TOCTOU window (as it is in the sibling create*
        // methods). Acceptable here: the app is single-user and the create path is serialized, so
        // two concurrent calls for the same site don't occur in practice. If that assumption ever
        // changes, make this atomic with an O_CREAT|O_EXCL create rather than this check.
        if fileManager.fileExists(atPath: abs.path) {
            return .failed(reason: "A site identity already exists at \(relPath)")
        }

        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let contents = ContentScaffold.renderSingleton(
            descriptor: descriptor, name: cleanName.isEmpty ? nil : cleanName)
        do { try write(contents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        onProgress?(.createFinalizing)
        _ = await gitCommit(root, relPath, "anglesite: add \(descriptor.id)")
        return .created(filePath: relPath, identifier: slot)
    }

    /// Delete a page/post/component file: `git rm` + commit via the injected `gitDelete` closure
    /// (default `processGitDelete`). Git is the underlying mechanism, but not a user-facing
    /// concept: the in-app "Undo" affordance (`restoreContent`, driven by the caller holding the
    /// pre-delete contents) is what recovers a deleted file, not an instruction to use git.
    public func deleteContent(siteID: String, relativePath: String) async -> ContentDeleteResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        let abs = root.appendingPathComponent(relativePath)
        guard fileManager.fileExists(atPath: abs.path) else {
            return .failed(reason: "No file exists at \(relativePath)")
        }
        guard await gitDelete(root, relativePath, "anglesite: delete \(relativePath)") != nil else {
            return .failed(reason: "Couldn't delete \(relativePath). Try again in a moment.")
        }
        return .deleted(filePath: relativePath)
    }

    /// Re-writes `contents` back to `relativePath` and commits — the "Undo" half of `deleteContent`
    /// (#586). The caller is responsible for having captured `contents` before the delete; this
    /// method doesn't itself know what was deleted.
    ///
    /// Unlike the best-effort `_ = await gitCommit(...)` elsewhere in this file (a freshly-created
    /// file simply has no prior git history to protect), a failed recommit here is reported as
    /// `.failed` rather than silently swallowed: `processGitDelete`'s `cat-file -e HEAD:relPath`
    /// guard requires a committed HEAD copy, so an uncommitted restore would leave the file
    /// existing on disk (and reported to the user as "undone") while any *later* delete of it keeps
    /// failing opaquely — the file is back but the app's own recovery mechanism can no longer touch
    /// it. Surfacing the failure here at least tells the user restoration is incomplete (PR #608
    /// review).
    public func restoreContent(siteID: String, relativePath: String, contents: String) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        let abs = root.appendingPathComponent(relativePath)
        do { try write(contents, to: abs) }
        catch { return .failed(reason: "\(error)") }
        guard await gitCommit(root, relativePath, "anglesite: restore \(relativePath)") != nil else {
            return .failed(reason: "Restored \(relativePath), but couldn't save it to your site's history. Try again in a moment.")
        }
        return .created(filePath: relativePath, identifier: relativePath)
    }

    /// "Publish" (#798): flip `draft: false`, re-stamping `publishDate` to now only when this
    /// entry has never been published before — a fresh draft's `publishDate` is already stamped
    /// to its creation time by `ContentScaffold.renderEntry`, and `unpublish` doesn't clear it, so
    /// "never published" is detected via `gitHasCommit` rather than the frontmatter itself: this
    /// exact commit message has never appeared in history. A republish (published → unpublished →
    /// published again) keeps its original date, per the design doc's "an explicitly user-edited
    /// date is respected" rule — a previously-published date counts as user-visible, not provisional.
    public func publish(
        siteID: String,
        relativePath: String,
        collection: String,
        registry: ContentTypeRegistry = ContentTypeRegistry()
    ) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        guard let descriptor = registry.descriptor(forCollection: collection) else {
            return .failed(reason: "\(collection) is not a registered content type")
        }
        guard descriptor.fields.contains(where: { $0.name == "draft" }) else {
            return .failed(reason: "\(collection) entries don't support draft/publish")
        }
        let abs = root.appendingPathComponent(relativePath)
        guard let raw = try? String(contentsOf: abs, encoding: .utf8) else {
            return .failed(reason: "Couldn't read \(relativePath)")
        }
        let slug = abs.deletingPathExtension().lastPathComponent
        let message = "anglesite: publish \(descriptor.id) \(slug)"

        var values = TypedContentEditor.read(raw, descriptor: descriptor)
        values["draft"] = .flag(false)
        let publishedBefore = await gitHasCommit(root, message)
        if !publishedBefore {
            values["publishDate"] = .date(now())
        }
        let newContents = TypedContentEditor.write(values, into: raw, descriptor: descriptor)
        do { try write(newContents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        guard await gitCommit(root, relativePath, message) != nil else {
            return .failed(reason: "Published \(relativePath), but couldn't save it to your site's history. Try again in a moment.")
        }
        return .created(filePath: relativePath, identifier: slug)
    }

    /// "Unpublish": the inverse of `publish` — flip `draft: true`, leave `publishDate` untouched
    /// so a later `publish` can still tell (via `gitHasCommit`) that this entry was public once.
    public func unpublish(
        siteID: String,
        relativePath: String,
        collection: String,
        registry: ContentTypeRegistry = ContentTypeRegistry()
    ) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        guard let descriptor = registry.descriptor(forCollection: collection) else {
            return .failed(reason: "\(collection) is not a registered content type")
        }
        guard descriptor.fields.contains(where: { $0.name == "draft" }) else {
            return .failed(reason: "\(collection) entries don't support draft/publish")
        }
        let abs = root.appendingPathComponent(relativePath)
        guard let raw = try? String(contentsOf: abs, encoding: .utf8) else {
            return .failed(reason: "Couldn't read \(relativePath)")
        }
        var values = TypedContentEditor.read(raw, descriptor: descriptor)
        values["draft"] = .flag(true)
        let newContents = TypedContentEditor.write(values, into: raw, descriptor: descriptor)
        do { try write(newContents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        let slug = abs.deletingPathExtension().lastPathComponent
        guard await gitCommit(root, relativePath, "anglesite: unpublish \(descriptor.id) \(slug)") != nil else {
            return .failed(reason: "Unpublished \(relativePath), but couldn't save it to your site's history. Try again in a moment.")
        }
        return .created(filePath: relativePath, identifier: slug)
    }

    /// Duplicate an existing page: read its contents, retitle to `"<title> Copy"` (bumping to
    /// `"<title> Copy 2"`, `"<title> Copy 3"`… on route collision — which slugifies to the
    /// `-copy`/`-copy-2` file-name convention), write the new file, commit. Title rewrite reuses
    /// `PageTitleEditor` (same transform `NavigatorRenameService` uses for Rename); if the source
    /// has no editable title location, the contents are duplicated verbatim.
    public func duplicatePage(siteID: String, relativePath: String, title: String) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        let sourceAbs = root.appendingPathComponent(relativePath)
        guard fileManager.fileExists(atPath: sourceAbs.path) else {
            return .failed(reason: "No page exists at \(relativePath)")
        }
        let contents: String
        do { contents = try FileDocumentIO.load(sourceAbs, fileManager: fileManager).contents }
        catch { return .failed(reason: "\(error)") }

        let baseTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let copyTitle = baseTitle.isEmpty ? "Copy" : "\(baseTitle) Copy"
        var attempt = 1
        var route = ContentScaffold.normalizeRoute(ContentScaffold.slugify(copyTitle))
        var relPath = ContentScaffold.pageRelativePath(normalizedRoute: route)
        while attempt < 1000, fileManager.fileExists(atPath: root.appendingPathComponent(relPath).path) {
            attempt += 1
            route = ContentScaffold.normalizeRoute(ContentScaffold.slugify("\(copyTitle) \(attempt)"))
            relPath = ContentScaffold.pageRelativePath(normalizedRoute: route)
        }
        guard !fileManager.fileExists(atPath: root.appendingPathComponent(relPath).path) else {
            return .failed(reason: "Couldn't find an available name for the duplicate after 1000 attempts")
        }

        let ext = (relativePath as NSString).pathExtension
        let rewritten: String
        switch PageTitleEditor.rewrite(contents: contents, fileExtension: ext, newTitle: copyTitle) {
        case .success(let s): rewritten = s
        case .failure: rewritten = contents
        }

        do { try write(rewritten, to: root.appendingPathComponent(relPath)) }
        catch { return .failed(reason: "\(error)") }

        _ = await gitCommit(root, relPath, "anglesite: duplicate page \(route)")
        return .created(filePath: relPath, identifier: route)
    }

    /// Duplicate an existing post within the same `collection`. Same retitle/collision/commit
    /// shape as `duplicatePage`, but derives a slug (not a route) and writes via
    /// `ContentScaffold.postRelativePath`.
    public func duplicatePost(siteID: String, relativePath: String, collection: String, title: String) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        let sourceAbs = root.appendingPathComponent(relativePath)
        guard fileManager.fileExists(atPath: sourceAbs.path) else {
            return .failed(reason: "No \(collection) entry exists at \(relativePath)")
        }
        let contents: String
        do { contents = try FileDocumentIO.load(sourceAbs, fileManager: fileManager).contents }
        catch { return .failed(reason: "\(error)") }

        let baseTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let copyTitle = baseTitle.isEmpty ? "Copy" : "\(baseTitle) Copy"
        var attempt = 1
        var slug = ContentScaffold.slugify(copyTitle)
        var relPath = ContentScaffold.postRelativePath(collection: collection, slug: slug)
        while attempt < 1000, fileManager.fileExists(atPath: root.appendingPathComponent(relPath).path) {
            attempt += 1
            slug = ContentScaffold.slugify("\(copyTitle) \(attempt)")
            relPath = ContentScaffold.postRelativePath(collection: collection, slug: slug)
        }
        guard !fileManager.fileExists(atPath: root.appendingPathComponent(relPath).path) else {
            return .failed(reason: "Couldn't find an available name for the duplicate after 1000 attempts")
        }

        let ext = (relativePath as NSString).pathExtension
        let rewritten: String
        switch PageTitleEditor.rewrite(contents: contents, fileExtension: ext, newTitle: copyTitle) {
        case .success(let s): rewritten = s
        case .failure: rewritten = contents
        }

        do { try write(rewritten, to: root.appendingPathComponent(relPath)) }
        catch { return .failed(reason: "\(error)") }

        _ = await gitCommit(root, relPath, "anglesite: duplicate \(collection) \(slug)")
        return .created(filePath: relPath, identifier: slug)
    }

    /// Duplicate an existing `.astro` component: read its contents verbatim (no retitle —
    /// unlike pages/posts, a component has no title to rewrite), derive a "Copy"-suffixed
    /// PascalCase name colliding-safely with `NameCopy`/`NameCopy2`… (mirrors `createComponent`'s
    /// PascalCase convention), write, commit. Preserves the source's subdirectory (e.g.
    /// `src/components/esi/EsiInclude.astro` duplicates to `src/components/esi/EsiIncludeCopy.astro`)
    /// since component grouping directories are meaningful (design spec §4.1's palette groups by
    /// `SiteFileTree`'s components group).
    public func duplicateComponent(siteID: String, relativePath: String) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        let sourceAbs = root.appendingPathComponent(relativePath)
        guard fileManager.fileExists(atPath: sourceAbs.path) else {
            return .failed(reason: "No component exists at \(relativePath)")
        }
        let contents: String
        do { contents = try FileDocumentIO.load(sourceAbs, fileManager: fileManager).contents }
        catch { return .failed(reason: "\(error)") }

        let relDir = (relativePath as NSString).deletingLastPathComponent
        let baseName = ((relativePath as NSString).lastPathComponent as NSString).deletingPathExtension
        func candidatePath(_ name: String) -> String {
            relDir.isEmpty ? "\(name).astro" : "\(relDir)/\(name).astro"
        }
        var attempt = 1
        var candidateName = "\(baseName)Copy"
        var relPath = candidatePath(candidateName)
        while attempt < 1000, fileManager.fileExists(atPath: root.appendingPathComponent(relPath).path) {
            attempt += 1
            candidateName = "\(baseName)Copy\(attempt)"
            relPath = candidatePath(candidateName)
        }
        guard !fileManager.fileExists(atPath: root.appendingPathComponent(relPath).path) else {
            return .failed(reason: "Couldn't find an available name for the duplicate after 1000 attempts")
        }

        do { try write(contents, to: root.appendingPathComponent(relPath)) }
        catch { return .failed(reason: "\(error)") }

        _ = await gitCommit(root, relPath, "anglesite: duplicate component \(candidateName)")
        return .created(filePath: relPath, identifier: candidateName)
    }

    /// Scaffold a minimal blank `.astro` component into `src/components/`. Derives a PascalCase
    /// file name from `name` (Astro convention) via the same `ContentScaffold.slugify` used for
    /// pages/posts, then title-cases each hyphenated segment.
    public func createComponent(siteID: String, name: String) async -> ContentCreateResult {
        guard let root = await siteDirectory(siteID) else { return .siteNotFound }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else { return .failed(reason: "New Component requires a non-empty name") }

        let slug = ContentScaffold.slugify(cleanName)
        guard !slug.isEmpty else { return .failed(reason: "Couldn't derive a file name from \"\(cleanName)\"") }
        let fileName = slug.split(separator: "-")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined()

        let relPath = "src/components/\(fileName).astro"
        let abs = root.appendingPathComponent(relPath)
        if fileManager.fileExists(atPath: abs.path) {
            return .failed(reason: "A component already exists at \(relPath)")
        }

        let contents = ContentScaffold.renderComponent(name: fileName)
        do { try write(contents, to: abs) }
        catch { return .failed(reason: "\(error)") }

        _ = await gitCommit(root, relPath, "anglesite: add component \(fileName)")
        return .created(filePath: relPath, identifier: fileName)
    }

    private func write(_ contents: String, to abs: URL) throws {
        try fileManager.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
        try contents.write(to: abs, atomically: true, encoding: .utf8)
    }

    #if canImport(Darwin)
    /// Stage and commit exactly `relPath` on the current branch. Returns the new HEAD SHA, or
    /// nil on any failure (not a repo) — best-effort, mirroring the Node sidecar's `commitFile`.
    /// Via SwiftGit2 (in-process libgit2, #640): `/usr/bin/git` cannot execute at all under App
    /// Sandbox. A missing git identity is not a failure: it resolves through `GitIdentity`, which
    /// falls back to the app's own identity rather than dropping the commit (#969).
    ///
    /// Two behavioral differences from the subprocess-git version this replaced, both judged
    /// acceptable for this app's single-user, one-operation-at-a-time usage:
    ///  - Commits whatever is currently staged, not scoped to just `relPath` the way `git commit
    ///    -- relPath` was — there's no equivalent path-scoped commit in SwiftGit2's public API.
    ///    Since every call site here does add-then-commit for one file with nothing else staged
    ///    in between, this doesn't currently observably differ.
    ///  - Does not run `.git/hooks/pre-commit`/`commit-msg` — libgit2 never invokes shell hooks
    ///    (that's a porcelain-layer concept). Nothing in this app currently relies on commit-time
    ///    hooks firing for content-op commits (unlike `pre-deploy-check.sh`, which is a separate,
    ///    still-enforced deploy-time gate — see CLAUDE.md's "app cannot bypass plugin security
    ///    hooks").
    @Sendable public static func processGitCommit(_ projectRoot: URL, _ relPath: String, _ message: String) async -> String? {
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(projectRoot) else { return nil }
        guard case .success = repo.add(path: relPath) else { return nil }
        let signature = await GitIdentity.signature(for: repo)
        guard case .success(let commit) = repo.commit(message: message, signature: signature) else { return nil }
        return commit.oid.description
    }

    /// Default `GitHasCommit`: walks history from HEAD looking for an exact message match.
    /// Best-effort like `processGitCommit` — an unreadable repo or unresolvable HEAD (e.g. zero
    /// commits) reports `false`, which `publish` treats as "never published," the safe default.
    @Sendable public static func hasCommit(_ projectRoot: URL, _ message: String) async -> Bool {
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(projectRoot) else { return false }
        guard case .success(let head) = repo.HEAD() else { return false }
        for result in repo.commits(from: head.oid) {
            guard case .success(let commit) = result else { continue }
            if commit.message.trimmingCharacters(in: .whitespacesAndNewlines) == message { return true }
        }
        return false
    }
    #else
    /// Stage and commit exactly `relPath` on the current branch. Returns the new HEAD SHA,
    /// or nil on any failure (not a repo, rejecting hook, git missing) — best-effort, mirroring
    /// the Node sidecar's `commitFile`. Off-Darwin there's no App Sandbox to route around, so
    /// plain subprocess git remains correct here rather than a gap to fill.
    @Sendable public static func processGitCommit(_ projectRoot: URL, _ relPath: String, _ message: String) async -> String? {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        func run(_ args: [String]) async -> ProcessSupervisor.RunResult? {
            let result = try? await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: projectRoot)
            guard let result, result.exitCode == 0 else { return nil }
            return result
        }
        guard await run(["rev-parse", "--git-dir"]) != nil,
              await run(["add", "--", relPath]) != nil,
              await run(["commit", "-m", message, "--", relPath]) != nil,
              let head = await run(["rev-parse", "HEAD"]) else { return nil }
        return head.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Default `GitHasCommit` off-Darwin: `git log --grep` narrows to candidates, then each is
    /// confirmed for an exact match (the message shell-metacharacter-escaped via -F/--fixed-strings
    /// wouldn't itself need this, but this avoids depending on --grep's own exact-match semantics).
    @Sendable public static func hasCommit(_ projectRoot: URL, _ message: String) async -> Bool {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        guard let result = try? await ProcessSupervisor.shared.run(
            executable: git,
            arguments: ["log", "--format=%s", "--fixed-strings", "--grep=\(message)"],
            currentDirectoryURL: projectRoot), result.exitCode == 0 else { return false }
        return result.stdout.split(separator: "\n").contains { $0.trimmingCharacters(in: .whitespaces) == message }
    }
    #endif

    #if canImport(Darwin)
    /// Stage-delete and commit exactly `relPath` on the current branch (`git rm` + `git commit`
    /// equivalent). Returns the new HEAD SHA, or nil on any failure (not a repo, no HEAD copy) —
    /// best-effort, mirroring `processGitCommit`'s shape exactly. A missing git identity is not
    /// one of those failures: it resolves through `GitIdentity`, which falls back to the app's own
    /// identity rather than aborting the delete (#969).
    /// Git history is the sole undo/archive mechanism for this delete; there is no separate
    /// trash/archive path. Via SwiftGit2 (in-process libgit2, #640): `/usr/bin/git` cannot
    /// execute at all under App Sandbox. Uses three fork-specific additions —
    /// `headHasEntry(atPath:)`, `remove(path:)`, `restorePathFromHEAD(_:)` — landed on
    /// `anglesite/SwiftGit2` specifically for this conversion.
    @Sendable public static func processGitDelete(_ projectRoot: URL, _ relPath: String, _ message: String) async -> String? {
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(projectRoot) else { return nil }
        // Require a HEAD copy before touching anything: if the commit below fails after the
        // remove already succeeds, the only safe rollback is restoring from HEAD, which needs
        // HEAD to actually have the file. A staged-but-never-committed file would otherwise risk
        // ending up gone from both the index and the working tree with no way back — refusing up
        // front is a clean, side-effect-free failure instead.
        guard repo.headHasEntry(atPath: relPath) else { return nil }
        guard case .success = repo.remove(path: relPath) else { return nil }

        let signature = await GitIdentity.signature(for: repo)
        guard case .success(let commit) = repo.commit(message: message, signature: signature) else {
            // remove(path:) already removed the file from the index and working tree before the
            // commit failed — restore both from HEAD so a failed delete never leaves the file gone
            // without a commit. Same "never a raw non-git-recoverable delete" safety property the
            // happy path relies on, applied to the failure path too.
            // This second failure (the rollback itself also failing) has no regression test: by
            // this point the `headHasEntry` guard above has already confirmed HEAD has the file,
            // so the restore failing here means something environmental went wrong between that
            // check and this line (disk full, permissions revoked mid-flight) — genuinely hard to
            // construct reliably/portably in a test, and narrower than it looks since the
            // precondition above already rules out the most common cause (no HEAD copy). Logged
            // rather than silently swallowed so it's at least diagnosable if it ever fires for
            // real.
            if case .failure = repo.restorePathFromHEAD(relPath) {
                await LogCenter.shared.append(
                    source: "dead-assets:delete", stream: .stderr,
                    text: "processGitDelete: commit failed for \(relPath) AND rollback (restorePathFromHEAD) also failed — the file may be missing from disk with no commit recording its removal. Manual recovery may be needed in \(projectRoot.path).")
            }
            return nil
        }
        return commit.oid.description
    }
    #else
    /// Stage-delete and commit exactly `relPath` on the current branch (`git rm` + `git commit`).
    /// Returns the new HEAD SHA, or nil on any failure (not a repo, dirty tree, rejecting hook,
    /// git missing, no HEAD copy) — best-effort, mirroring `processGitCommit`'s shape exactly.
    /// Git history is the sole undo/archive mechanism for this delete; there is no separate
    /// trash/archive path. Off-Darwin there's no App Sandbox to route around, so plain subprocess
    /// git remains correct here rather than a gap to fill.
    @Sendable public static func processGitDelete(_ projectRoot: URL, _ relPath: String, _ message: String) async -> String? {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        func run(_ args: [String]) async -> ProcessSupervisor.RunResult? {
            let result = try? await ProcessSupervisor.shared.run(executable: git, arguments: args, currentDirectoryURL: projectRoot)
            guard let result, result.exitCode == 0 else { return nil }
            return result
        }
        guard await run(["rev-parse", "--git-dir"]) != nil else { return nil }
        // Require a HEAD copy before touching anything: if `git commit` fails after `git rm`
        // already succeeds, the only safe rollback is `git checkout HEAD -- relPath`, which needs
        // HEAD to actually have the file. A staged-but-never-committed file (`git add`ed, no
        // commit yet) would otherwise risk ending up gone from both the index and the working
        // tree with no way back — refusing up front is a clean, side-effect-free failure instead.
        guard await run(["cat-file", "-e", "HEAD:" + relPath]) != nil else { return nil }
        guard await run(["rm", "--", relPath]) != nil else { return nil }
        guard await run(["commit", "-m", message, "--", relPath]) != nil else {
            // `git rm` already removed the file from the index and working tree before the
            // commit failed (no identity configured, a rejecting pre-commit hook, etc.) —
            // restore both from HEAD so a failed delete never leaves the file gone without a
            // commit. Same "never a raw non-git-recoverable delete" safety property the happy
            // path relies on, applied to the failure path too.
            // This second failure (the rollback itself also failing) has no regression test: by
            // this point the `cat-file -e HEAD:relPath` guard above has already confirmed HEAD
            // has the file, so `checkout HEAD --` failing here means something environmental went
            // wrong between that check and this line (disk full, permissions revoked mid-flight)
            // — genuinely hard to construct reliably/portably in a test, and narrower than it
            // looks since the precondition above already rules out the most common cause (no HEAD
            // copy). Logged rather than silently swallowed so it's at least diagnosable if it
            // ever fires for real.
            let restored = await run(["checkout", "HEAD", "--", relPath])
            if restored == nil {
                await LogCenter.shared.append(
                    source: "dead-assets:delete", stream: .stderr,
                    text: "processGitDelete: commit failed for \(relPath) AND rollback (git checkout HEAD --) also failed — the file may be missing from disk with no commit recording its removal. Manual recovery may be needed in \(projectRoot.path).")
            }
            return nil
        }
        guard let head = await run(["rev-parse", "HEAD"]) else { return nil }
        return head.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    #endif
}
