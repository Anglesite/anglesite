import Foundation

/// App-facing content creation workflow.
///
/// Owns the full post-create lifecycle: delegate the write to the selected
/// `ContentOperationsService`, then rescan and publish the site's content graph after a successful
/// create. `SiteContentGraph.load` emits the graph change that drives the semantic indexer, so UI
/// and App Intent callers get the same refresh behavior.
public struct ContentCreationWorkflow: ContentOperationsService {
    public typealias SiteDirectoryResolver = @Sendable (_ siteID: String) async -> URL?
    public typealias PageTemplateCreator = @Sendable (
        _ siteID: String,
        _ title: String,
        _ route: String?,
        _ template: ContentScaffold.PageTemplate,
        _ onProgress: ProgressHandler?
    ) async -> ContentCreateResult
    public typealias TypedSlugCreator = @Sendable (
        _ siteID: String,
        _ typeID: String,
        _ title: String,
        _ slug: String?,
        _ fieldValues: [String: String],
        _ onProgress: ProgressHandler?
    ) async -> ContentCreateResult
    public typealias ContentDeleter = @Sendable (_ siteID: String, _ relativePath: String) async -> ContentDeleteResult
    public typealias ContentRestorer = @Sendable (_ siteID: String, _ relativePath: String, _ contents: String) async -> ContentCreateResult
    public typealias PageDuplicator = @Sendable (_ siteID: String, _ relativePath: String, _ title: String) async -> ContentCreateResult
    public typealias PostDuplicator = @Sendable (_ siteID: String, _ relativePath: String, _ collection: String, _ title: String) async -> ContentCreateResult
    public typealias PostPublisher = @Sendable (_ siteID: String, _ relativePath: String, _ collection: String) async -> ContentCreateResult
    public typealias PostUnpublisher = @Sendable (_ siteID: String, _ relativePath: String, _ collection: String) async -> ContentCreateResult
    public typealias ComponentCreator = @Sendable (_ siteID: String, _ name: String) async -> ContentCreateResult
    public typealias ComponentDuplicator = @Sendable (_ siteID: String, _ relativePath: String) async -> ContentCreateResult

    private let operations: any ContentOperationsService
    private let contentGraph: SiteContentGraph?
    private let knowledgeIndex: SiteKnowledgeIndex?
    private let siteDirectory: SiteDirectoryResolver
    private let pageTemplateCreator: PageTemplateCreator?
    private let typedSlugCreator: TypedSlugCreator?
    private let contentDeleter: ContentDeleter?
    private let contentRestorer: ContentRestorer?
    private let pageDuplicator: PageDuplicator?
    private let postDuplicator: PostDuplicator?
    private let postPublisher: PostPublisher?
    private let postUnpublisher: PostUnpublisher?
    private let componentCreator: ComponentCreator?
    private let componentDuplicator: ComponentDuplicator?

    public init(
        operations: any ContentOperationsService,
        contentGraph: SiteContentGraph?,
        knowledgeIndex: SiteKnowledgeIndex? = nil,
        siteDirectory: @escaping SiteDirectoryResolver,
        pageTemplateCreator: PageTemplateCreator? = nil,
        typedSlugCreator: TypedSlugCreator? = nil,
        contentDeleter: ContentDeleter? = nil,
        contentRestorer: ContentRestorer? = nil,
        pageDuplicator: PageDuplicator? = nil,
        postDuplicator: PostDuplicator? = nil,
        postPublisher: PostPublisher? = nil,
        postUnpublisher: PostUnpublisher? = nil,
        componentCreator: ComponentCreator? = nil,
        componentDuplicator: ComponentDuplicator? = nil
    ) {
        self.operations = operations
        self.contentGraph = contentGraph
        self.knowledgeIndex = knowledgeIndex
        self.siteDirectory = siteDirectory
        self.pageTemplateCreator = pageTemplateCreator
        self.typedSlugCreator = typedSlugCreator
        self.contentDeleter = contentDeleter
        self.contentRestorer = contentRestorer
        self.pageDuplicator = pageDuplicator
        self.postDuplicator = postDuplicator
        self.postPublisher = postPublisher
        self.postUnpublisher = postUnpublisher
        self.componentCreator = componentCreator
        self.componentDuplicator = componentDuplicator
    }

    public static func native(
        contentGraph: SiteContentGraph?,
        knowledgeIndex: SiteKnowledgeIndex? = nil,
        siteDirectory: @escaping SiteDirectoryResolver
    ) -> ContentCreationWorkflow {
        let copyGenerator = SettingsGatedPageCopyGenerator(
            isEnabled: { AppSettings.shared.autoGeneratePageCopy },
            base: PageCopyGeneratorFactory.makeDefault()
        )
        let native = NativeContentOperations(siteDirectory: siteDirectory, copyGenerator: copyGenerator)
        return ContentCreationWorkflow(
            operations: native,
            contentGraph: contentGraph,
            knowledgeIndex: knowledgeIndex,
            siteDirectory: siteDirectory,
            pageTemplateCreator: { siteID, title, route, template, onProgress in
                await native.createPage(
                    siteID: siteID,
                    name: title,
                    route: route,
                    template: template,
                    onProgress: onProgress
                )
            },
            typedSlugCreator: { siteID, typeID, title, slug, fieldValues, onProgress in
                await native.createTyped(
                    siteID: siteID,
                    typeID: typeID,
                    title: title,
                    slug: slug,
                    fieldValues: fieldValues,
                    onProgress: onProgress
                )
            },
            contentDeleter: { siteID, relativePath in
                await native.deleteContent(siteID: siteID, relativePath: relativePath)
            },
            contentRestorer: { siteID, relativePath, contents in
                await native.restoreContent(siteID: siteID, relativePath: relativePath, contents: contents)
            },
            pageDuplicator: { siteID, relativePath, title in
                await native.duplicatePage(siteID: siteID, relativePath: relativePath, title: title)
            },
            postDuplicator: { siteID, relativePath, collection, title in
                await native.duplicatePost(siteID: siteID, relativePath: relativePath, collection: collection, title: title)
            },
            postPublisher: { siteID, relativePath, collection in
                await native.publish(siteID: siteID, relativePath: relativePath, collection: collection)
            },
            postUnpublisher: { siteID, relativePath, collection in
                await native.unpublish(siteID: siteID, relativePath: relativePath, collection: collection)
            },
            componentCreator: { siteID, name in
                await native.createComponent(siteID: siteID, name: name)
            },
            componentDuplicator: { siteID, relativePath in
                await native.duplicateComponent(siteID: siteID, relativePath: relativePath)
            }
        )
    }

    public func createPage(
        siteID: String,
        name: String,
        route: String?,
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result = await operations.createPage(
            siteID: siteID,
            name: name,
            route: route,
            onProgress: onProgress
        )
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func createPage(
        siteID: String,
        title: String,
        route: String?,
        template: ContentScaffold.PageTemplate,
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result: ContentCreateResult
        if let pageTemplateCreator {
            result = await pageTemplateCreator(siteID, title, route, template, onProgress)
        } else {
            result = await operations.createPage(
                siteID: siteID,
                name: title,
                route: route,
                onProgress: onProgress
            )
        }
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func createPost(
        siteID: String,
        title: String,
        collection: String?,
        slug: String?,
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result = await operations.createPost(
            siteID: siteID,
            title: title,
            collection: collection,
            slug: slug,
            onProgress: onProgress
        )
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result = await operations.createTyped(
            siteID: siteID,
            typeID: typeID,
            title: title,
            onProgress: onProgress
        )
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    /// `fieldValues` carries values collected before the write (required `.url` fields — #916). It
    /// reaches `NativeContentOperations` only through `typedSlugCreator`; the `operations` fallback
    /// is the title-only `ContentOperationsService` witness and necessarily drops them.
    public func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?,
        fieldValues: [String: String] = [:],
        onProgress: ProgressHandler? = nil
    ) async -> ContentCreateResult {
        let result: ContentCreateResult
        if let typedSlugCreator {
            result = await typedSlugCreator(siteID, typeID, title, slug, fieldValues, onProgress)
        } else {
            result = await operations.createTyped(
                siteID: siteID,
                typeID: typeID,
                title: title,
                onProgress: onProgress
            )
        }
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    private func refreshContentGraphIfCreated(_ result: ContentCreateResult, siteID: String) async {
        guard case let .created(filePath, _) = result else { return }
        await refreshContentGraph(siteID: siteID, indexFilePath: filePath)
    }

    /// Rescan and publish the site's content graph. Shared by every successful create *and*
    /// `deleteContent` — a delete has no `filePath` to index (nothing to add to the knowledge
    /// index for a file that's gone), so `indexFilePath` is optional and only creates pass it.
    private func refreshContentGraph(siteID: String, indexFilePath: String? = nil) async {
        guard let root = await siteDirectory(siteID) else { return }
        if let contentGraph {
            // Claim a scan generation (#666) before the filesystem walk starts, so a slower
            // rescan racing against a faster, newer one — e.g. the site-open scan in
            // `SiteContentGraph.rescan` — never clobbers the newer result.
            let generation = await contentGraph.beginScan(siteID: siteID)
            let listing = await Task.detached(priority: .utility) {
                ContentScanner.scan(projectRoot: root, siteID: siteID)
            }.value
            await contentGraph.load(
                siteID: siteID,
                pages: listing.pages,
                posts: listing.posts,
                images: listing.images,
                generation: generation
            )
        }
        if let indexFilePath {
            await knowledgeIndex?.upsertFile(siteID: siteID, projectRoot: root, relativePath: indexFilePath)
        }
    }

    public func deleteContent(siteID: String, relativePath: String) async -> ContentDeleteResult {
        guard let contentDeleter else { return .failed(reason: "Delete is not configured for this workflow") }
        let result = await contentDeleter(siteID, relativePath)
        if case .deleted = result {
            await refreshContentGraph(siteID: siteID)
        }
        return result
    }

    /// Undo half of `deleteContent` (#586) — re-writes previously-captured contents and rescans the
    /// graph on success, same as every other successful create.
    public func restoreContent(siteID: String, relativePath: String, contents: String) async -> ContentCreateResult {
        guard let contentRestorer else { return .failed(reason: "Restore is not configured for this workflow") }
        let result = await contentRestorer(siteID, relativePath, contents)
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func duplicatePage(siteID: String, relativePath: String, title: String) async -> ContentCreateResult {
        guard let pageDuplicator else { return .failed(reason: "Duplicate is not configured for this workflow") }
        let result = await pageDuplicator(siteID, relativePath, title)
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func duplicatePost(siteID: String, relativePath: String, collection: String, title: String) async -> ContentCreateResult {
        guard let postDuplicator else { return .failed(reason: "Duplicate is not configured for this workflow") }
        let result = await postDuplicator(siteID, relativePath, collection, title)
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func publish(siteID: String, relativePath: String, collection: String) async -> ContentCreateResult {
        guard let postPublisher else { return .failed(reason: "Publish is not configured for this workflow") }
        let result = await postPublisher(siteID, relativePath, collection)
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    public func unpublish(siteID: String, relativePath: String, collection: String) async -> ContentCreateResult {
        guard let postUnpublisher else { return .failed(reason: "Unpublish is not configured for this workflow") }
        let result = await postUnpublisher(siteID, relativePath, collection)
        await refreshContentGraphIfCreated(result, siteID: siteID)
        return result
    }

    /// Components aren't part of `SiteContentGraph` (pages/posts/images only), so — matching the
    /// existing precedent for dead-asset Cleanup deletes, which also don't touch the graph — no
    /// graph refresh happens here. The app-layer caller is responsible for refreshing the
    /// Navigator's filesystem-backed sections (`SiteNavigatorModel.refreshNow()`).
    public func createComponent(siteID: String, name: String) async -> ContentCreateResult {
        guard let componentCreator else { return .failed(reason: "Component creation is not configured for this workflow") }
        return await componentCreator(siteID, name)
    }

    /// Mirrors `createComponent`'s no-graph-refresh precedent (components aren't part of
    /// `SiteContentGraph`) — the app-layer caller refreshes the Navigator itself.
    public func duplicateComponent(siteID: String, relativePath: String) async -> ContentCreateResult {
        guard let componentDuplicator else { return .failed(reason: "Duplicate is not configured for this workflow") }
        return await componentDuplicator(siteID, relativePath)
    }
}
