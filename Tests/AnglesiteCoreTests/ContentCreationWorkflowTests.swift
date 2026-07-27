import Foundation
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("ContentCreationWorkflow")
struct ContentCreationWorkflowTests {
    private static let siteID = "site-1"

    @Test("successful page create reloads content graph and emits for indexer")
    func createPageRefreshesGraph() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let graph = SiteContentGraph()
        let emissions = Emissions()
        await graph.setChangeHandler { siteID in await emissions.record(siteID) }
        let operations = FakeCreateOperations { _, _, _ in
            let relativePath = "src/pages/about.astro"
            let url = root.appendingPathComponent(relativePath)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try ContentScaffold.renderPage(
                title: "About",
                layoutImport: "../layouts/BaseLayout.astro"
            ).write(to: url, atomically: true, encoding: .utf8)
            return .created(filePath: relativePath, identifier: "/about")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root }
        )

        let result = await workflow.createPage(siteID: Self.siteID, name: "About", route: nil)

        #expect(result == .created(filePath: "src/pages/about.astro", identifier: "/about"))
        #expect(await graph.pages(for: Self.siteID).map(\.route) == ["/about"])
        #expect(await graph.pages(for: Self.siteID).first?.title == "About")
        #expect(await emissions.values == [Self.siteID])
    }

    @Test("failed create leaves graph unchanged and does not emit")
    func failedCreateDoesNotRefreshGraph() async throws {
        let root = try writeSiteTree(prefix: "content-workflow", [
            "src/pages/original.md": "---\ntitle: Original\n---\nBody",
        ])
        let graph = SiteContentGraph()
        await graph.load(
            siteID: Self.siteID,
            pages: ContentScanner.scan(projectRoot: root, siteID: Self.siteID).pages,
            posts: [],
            images: []
        )
        let emissions = Emissions()
        await graph.setChangeHandler { siteID in await emissions.record(siteID) }
        let operations = FakeCreateOperations { _, _, _ in
            try "new".write(
                to: root.appendingPathComponent("src/pages/new.md"),
                atomically: true,
                encoding: .utf8
            )
            return .failed(reason: "nope")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root }
        )

        let result = await workflow.createPage(siteID: Self.siteID, name: "New", route: nil)

        #expect(result == .failed(reason: "nope"))
        #expect(await graph.pages(for: Self.siteID).map(\.route) == ["/original"])
        #expect(await emissions.values.isEmpty)
    }

    @Test("successful post create reloads posts through the same workflow")
    func createPostRefreshesGraph() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let graph = SiteContentGraph()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            let relativePath = "src/content/posts/hello-world.md"
            let url = root.appendingPathComponent(relativePath)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try """
            ---
            title: Hello World
            draft: true
            tags: [intro]
            ---
            Body
            """.write(to: url, atomically: true, encoding: .utf8)
            return .created(filePath: relativePath, identifier: "hello-world")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root }
        )

        let result = await workflow.createPost(
            siteID: Self.siteID,
            title: "Hello World",
            collection: nil,
            slug: nil
        )

        #expect(result == .created(filePath: "src/content/posts/hello-world.md", identifier: "hello-world"))
        let posts = await graph.posts(for: Self.siteID)
        #expect(posts.map(\.slug) == ["hello-world"])
        #expect(posts.first?.title == "Hello World")
        #expect(posts.first?.draft == true)
        #expect(posts.first?.tags == ["intro"])
    }

    @Test("successful typed create refreshes graph and knowledge index")
    func createTypedRefreshesGraphAndKnowledgeIndex() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let graph = SiteContentGraph()
        let knowledgeIndex = SiteKnowledgeIndex()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, title, slug in
            let finalSlug = slug ?? "note"
            let relativePath = "src/content/notes/\(finalSlug).md"
            let url = root.appendingPathComponent(relativePath)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try """
            ---
            title: \(title)
            ---
            Body
            """.write(to: url, atomically: true, encoding: .utf8)
            return .created(filePath: relativePath, identifier: finalSlug)
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            knowledgeIndex: knowledgeIndex,
            siteDirectory: { _ in root },
            typedSlugCreator: { siteID, typeID, title, slug, _, _ in
                await operations.createTyped(siteID: siteID, typeID: typeID, title: title, slug: slug)
            }
        )

        let result = await workflow.createTyped(
            siteID: Self.siteID,
            typeID: "note",
            title: "Hello Typed",
            slug: "hello-typed"
        )

        #expect(result == .created(filePath: "src/content/notes/hello-typed.md", identifier: "hello-typed"))
        #expect(await graph.posts(for: Self.siteID).map(\.slug) == ["hello-typed"])
        let document = await knowledgeIndex.document(siteID: Self.siteID, relativePath: "src/content/notes/hello-typed.md")
        #expect(document?.title == "Hello Typed")
    }

    @Test("successful delete reloads content graph so the deleted page is gone")
    func deleteContentRefreshesGraph() async throws {
        let root = try writeSiteTree(prefix: "content-workflow", [
            "src/pages/about.astro": ContentScaffold.renderPage(title: "About", layoutImport: "../layouts/BaseLayout.astro"),
        ])
        let graph = SiteContentGraph()
        await graph.load(
            siteID: Self.siteID,
            pages: ContentScanner.scan(projectRoot: root, siteID: Self.siteID).pages,
            posts: [],
            images: []
        )
        #expect(await graph.pages(for: Self.siteID).count == 1)
        try FileManager.default.removeItem(at: root.appendingPathComponent("src/pages/about.astro"))

        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root },
            contentDeleter: { _, relPath in .deleted(filePath: relPath) }
        )

        let result = await workflow.deleteContent(siteID: Self.siteID, relativePath: "src/pages/about.astro")

        #expect(result == .deleted(filePath: "src/pages/about.astro"))
        #expect(await graph.pages(for: Self.siteID).isEmpty)
    }

    @Test("failed delete leaves content graph unchanged")
    func failedDeleteDoesNotRefreshGraph() async throws {
        let root = try writeSiteTree(prefix: "content-workflow", [
            "src/pages/about.astro": ContentScaffold.renderPage(title: "About", layoutImport: "../layouts/BaseLayout.astro"),
        ])
        let graph = SiteContentGraph()
        await graph.load(
            siteID: Self.siteID,
            pages: ContentScanner.scan(projectRoot: root, siteID: Self.siteID).pages,
            posts: [],
            images: []
        )
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root },
            contentDeleter: { _, _ in .failed(reason: "dirty tree") }
        )

        let result = await workflow.deleteContent(siteID: Self.siteID, relativePath: "src/pages/about.astro")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
        #expect(await graph.pages(for: Self.siteID).count == 1)
    }

    @Test("duplicatePage reloads content graph with the new page")
    func duplicatePageRefreshesGraph() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let graph = SiteContentGraph()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root },
            pageDuplicator: { _, _, _ in
                let relPath = "src/pages/about-copy.astro"
                let url = root.appendingPathComponent(relPath)
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? ContentScaffold.renderPage(title: "About Copy", layoutImport: "../layouts/BaseLayout.astro")
                    .write(to: url, atomically: true, encoding: .utf8)
                return .created(filePath: relPath, identifier: "/about-copy")
            }
        )

        let result = await workflow.duplicatePage(siteID: Self.siteID, relativePath: "src/pages/about.astro", title: "About")

        #expect(result == .created(filePath: "src/pages/about-copy.astro", identifier: "/about-copy"))
        #expect(await graph.pages(for: Self.siteID).map(\.route) == ["/about-copy"])
    }

    @Test("createComponent does not require content graph access and returns the operation's result")
    func createComponentPassesThrough() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: nil,
            siteDirectory: { _ in root },
            componentCreator: { _, name in .created(filePath: "src/components/\(name).astro", identifier: name) }
        )

        let result = await workflow.createComponent(siteID: Self.siteID, name: "Widget")

        #expect(result == .created(filePath: "src/components/Widget.astro", identifier: "Widget"))
    }

    @Test("duplicateComponent does not require content graph access and returns the operation's result")
    func duplicateComponentPassesThrough() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: nil,
            siteDirectory: { _ in root },
            componentDuplicator: { _, relativePath in .created(filePath: "src/components/WidgetCopy.astro", identifier: "WidgetCopy") }
        )

        let result = await workflow.duplicateComponent(siteID: Self.siteID, relativePath: "src/components/Widget.astro")

        #expect(result == .created(filePath: "src/components/WidgetCopy.astro", identifier: "WidgetCopy"))
    }

    @Test("duplicateComponent reports failed when the workflow has no componentDuplicator configured")
    func duplicateComponentUnconfigured() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(operations: operations, contentGraph: nil, siteDirectory: { _ in root })

        let result = await workflow.duplicateComponent(siteID: Self.siteID, relativePath: "src/components/Widget.astro")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("deleteContent reports failed when the workflow has no contentDeleter configured")
    func deleteContentUnconfigured() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(operations: operations, contentGraph: nil, siteDirectory: { _ in root })

        let result = await workflow.deleteContent(siteID: Self.siteID, relativePath: "src/pages/about.astro")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("successful restoreContent reloads content graph so the restored page reappears")
    func restoreContentRefreshesGraph() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let graph = SiteContentGraph()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root },
            contentRestorer: { _, relPath, contents in
                let url = root.appendingPathComponent(relPath)
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? contents.write(to: url, atomically: true, encoding: .utf8)
                return .created(filePath: relPath, identifier: "/about")
            }
        )

        let result = await workflow.restoreContent(
            siteID: Self.siteID, relativePath: "src/pages/about.astro",
            contents: ContentScaffold.renderPage(title: "About", layoutImport: "../layouts/BaseLayout.astro"))

        #expect(result == .created(filePath: "src/pages/about.astro", identifier: "/about"))
        #expect(await graph.pages(for: Self.siteID).map(\.route) == ["/about"])
    }

    @Test("failed restoreContent leaves content graph unchanged")
    func failedRestoreContentDoesNotRefreshGraph() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let graph = SiteContentGraph()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: graph,
            siteDirectory: { _ in root },
            contentRestorer: { _, _, _ in .failed(reason: "couldn't save it to your site's history") }
        )

        let result = await workflow.restoreContent(siteID: Self.siteID, relativePath: "src/pages/about.astro", contents: "x")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
        #expect(await graph.pages(for: Self.siteID).isEmpty)
    }

    @Test("restoreContent reports failed when the workflow has no contentRestorer configured")
    func restoreContentUnconfigured() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(operations: operations, contentGraph: nil, siteDirectory: { _ in root })

        let result = await workflow.restoreContent(siteID: Self.siteID, relativePath: "src/pages/about.astro", contents: "x")

        guard case .failed = result else { Issue.record("expected .failed, got \(result)"); return }
    }

    @Test("createTyped forwards fieldValues to the typed slug creator")
    func createTypedForwardsFieldValues() async throws {
        let root = try makeTempDir(prefix: "content-workflow")
        let seen = SeenFieldValues()
        let operations = FakeCreateOperations { _, _, _ in
            .failed(reason: "unexpected")
        } createPost: { _, _, _, _ in
            .failed(reason: "unexpected")
        } createTyped: { _, _, _, _ in
            .failed(reason: "unexpected")
        }
        let workflow = ContentCreationWorkflow(
            operations: operations,
            contentGraph: nil,
            siteDirectory: { _ in root },
            typedSlugCreator: { _, _, _, _, fieldValues, _ in
                await seen.record(fieldValues)
                return .created(filePath: "src/content/likes/x.md", identifier: "x")
            }
        )

        _ = await workflow.createTyped(
            siteID: Self.siteID, typeID: "like", title: "", slug: nil,
            fieldValues: ["likeOf": "https://example.com/post"])

        #expect(await seen.values == ["likeOf": "https://example.com/post"])
    }
}

private actor SeenFieldValues {
    private(set) var values: [String: String] = [:]
    func record(_ v: [String: String]) { values = v }
}

private struct FakeCreateOperations: ContentOperationsService {
    typealias PageCreate = @Sendable (String, String, String?) async throws -> ContentCreateResult
    typealias PostCreate = @Sendable (String, String, String?, String?) async throws -> ContentCreateResult
    typealias TypedCreate = @Sendable (String, String, String, String?) async throws -> ContentCreateResult

    let createPageHandler: PageCreate
    let createPostHandler: PostCreate
    let createTypedHandler: TypedCreate

    init(
        createPage: @escaping PageCreate,
        createPost: @escaping PostCreate,
        createTyped: @escaping TypedCreate
    ) {
        self.createPageHandler = createPage
        self.createPostHandler = createPost
        self.createTypedHandler = createTyped
    }

    func createPage(
        siteID: String,
        name: String,
        route: String?,
        onProgress: ProgressHandler?
    ) async -> ContentCreateResult {
        do {
            return try await createPageHandler(siteID, name, route)
        } catch {
            return .failed(reason: String(describing: error))
        }
    }

    func createPost(
        siteID: String,
        title: String,
        collection: String?,
        slug: String?,
        onProgress: ProgressHandler?
    ) async -> ContentCreateResult {
        do {
            return try await createPostHandler(siteID, title, collection, slug)
        } catch {
            return .failed(reason: String(describing: error))
        }
    }

    func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        onProgress: ProgressHandler?
    ) async -> ContentCreateResult {
        await createTyped(siteID: siteID, typeID: typeID, title: title, slug: nil)
    }

    func createTyped(
        siteID: String,
        typeID: String,
        title: String,
        slug: String?
    ) async -> ContentCreateResult {
        do {
            return try await createTypedHandler(siteID, typeID, title, slug)
        } catch {
            return .failed(reason: String(describing: error))
        }
    }
}

private actor Emissions {
    private var recorded: [String] = []

    var values: [String] { recorded }

    func record(_ value: String) {
        recorded.append(value)
    }
}

@Suite("ContentCreationWorkflow publish/unpublish")
struct ContentCreationWorkflowPublishTests {
    @Test("publish rescans the content graph on success")
    func publishRescans() async {
        let graph = SiteContentGraph()
        // No `generation:` here — it's guarded against `beginScan` tokens this test never claims;
        // omitting it (nil default) applies unconditionally, per `SiteContentGraph.load`'s own doc
        // comment and every other test in this file.
        await graph.load(siteID: "s1", pages: [], posts: [], images: [])
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        var publishCalls = 0
        let workflow = ContentCreationWorkflow(
            operations: NativeContentOperations(siteDirectory: { _ in root }),
            contentGraph: graph,
            siteDirectory: { _ in root },
            postPublisher: { _, relativePath, _ in
                publishCalls += 1
                return .created(filePath: relativePath, identifier: "my-note")
            }
        )

        let result = await workflow.publish(siteID: "s1", relativePath: "src/content/notes/my-note.md", collection: "notes")
        #expect(result == .created(filePath: "src/content/notes/my-note.md", identifier: "my-note"))
        #expect(publishCalls == 1)
    }

    @Test("publish reports .failed when the workflow has no publisher configured")
    func publishUnconfigured() async {
        let workflow = ContentCreationWorkflow(
            operations: NativeContentOperations(siteDirectory: { _ in nil }),
            contentGraph: nil,
            siteDirectory: { _ in nil }
        )
        let result = await workflow.publish(siteID: "s1", relativePath: "x.md", collection: "notes")
        #expect(result == .failed(reason: "Publish is not configured for this workflow"))
    }
}
