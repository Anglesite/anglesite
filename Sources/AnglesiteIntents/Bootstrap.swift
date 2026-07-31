import AppIntents
import AnglesiteCore
import OSLog

private let log = Logger(subsystem: "io.dwk.anglesite", category: "spotlight-indexer")
private let contentLog = Logger(subsystem: "io.dwk.anglesite", category: "content-spotlight-indexer")
private let relevantLog = Logger(subsystem: "io.dwk.anglesite", category: "relevant-entities")

/// Fallback interpreter used when the Xcode-27 / `FoundationModels` toolchain is absent (CI).
/// Always throws `.unavailable` so the intent's catch path surfaces the "needs Apple Intelligence"
/// dialog rather than a fatalError from the missing `@Dependency` factory.
private struct UnavailableEditInterpreter: EditInterpreting {
    func interpret(instruction: String, element: InterpretedElementContext) async throws -> InterpretedEdit {
        throw EditInterpretationError.unavailable("FoundationModels not available on this toolchain")
    }
}

/// Namespace for the intents-side process setup. Caseless — there is no instance state; all
/// the wiring lands in `AppDependencyManager` registrations and the long-lived change handlers
/// installed by ``bootstrap(contentGraph:)``.
public enum AnglesiteIntents {
    /// Public entry point that registers production dependencies with `AppDependencyManager` and
    /// hooks the Spotlight indexer to `SiteStore.shared`.
    ///
    /// Async so the call site can await handler installation before driving any `SiteStore`
    /// mutations — that way a caller in an async context (e.g. #101's system MCP entry from a
    /// non-UI process) gets the indexer reliably set up before they touch the store.
    ///
    /// `contentGraph` is the single, app-lifetime `SiteContentGraph` instance the app owns and
    /// passes in. We register it with `AppDependencyManager` so `@Dependency private var graph:
    /// SiteContentGraph` resolves to the same instance in every ``PageEntityQuery`` /
    /// ``PostEntityQuery`` / ``ImageEntityQuery`` instantiation by the AppIntents runtime. A.1's
    /// design explicitly rules out a process-wide `SiteContentGraph.shared` — ownership stays
    /// with the app, threaded through here.
    ///
    /// The kicker `try await SiteStore.shared.load()` inside is belt-and-suspenders for the
    /// SwiftUI case: `AppDelegate.applicationDidFinishLaunching` can only fire-and-forget us in a
    /// `Task`, which races with the launcher view's own `task` modifier. The handler is registered
    /// before the load here, so the load *will* emit even if the launcher already raced ahead and
    /// missed it — emission is idempotent (the indexer dedups by id set).
    ///
    /// - Returns: The ``ContentSpotlightIndexer`` wired to `contentGraph`, so the app can hand it
    ///   to surfaces that probe index state (the Siri-readiness checks in `SiteWindowModel`).
    ///   Discardable for callers that only need the side-effectful registrations.
    @discardableResult
    public static func bootstrap(contentGraph: SiteContentGraph) async -> ContentSpotlightIndexer {
        // Singleton-factory: the closure always returns the same pre-constructed `contentGraph`
        // instance. `AppDependencyManager.add` accepts a factory because dependencies may be
        // per-resolution, but our graph is process-wide, so we capture and re-yield.
        AppDependencyManager.shared.add { () -> SiteContentGraph in contentGraph }
        AppDependencyManager.shared.add { () -> any SiteOperationsService in
            SiteOperations(factory: LiveCommandFactory())
        }
        // Content create intents (A.5 #139) now use native in-process scaffolding (Bucket 1,
        // Slice 2). Replaces the MCP-routed ContentOperations; the Node create_page/create_post
        // tools are retired in the roadmap's cleanup slice.
        AppDependencyManager.shared.add { () -> any ContentOperationsService in
            let siteDirectory: ContentCreationWorkflow.SiteDirectoryResolver = { id in
                await SiteStore.shared.find(id: id)?.sourceDirectory
            }
            return ContentCreationWorkflow.native(
                contentGraph: contentGraph,
                siteDirectory: siteDirectory
            )
        }
        AppDependencyManager.shared.add { () -> any IntegrationOperationsService in
            IntegrationOperations.live()
        }
        AppDependencyManager.shared.add { () -> any DomainOperationsService in
            DomainOperations()
        }
        // `ApplyThemeIntent` (ThemeIntents.swift) resolves `@Dependency private var catalog:
        // ThemeCatalog` against whatever is registered here. `ThemeCatalog.load` decodes the
        // bundled template's scripts/themes.json and can throw (missing/unreadable template),
        // so — matching `SitesLauncherView.presentNewSite()`'s handling of the same call —
        // fall back to an empty catalog rather than letting bootstrap throw or the intent trap
        // on an unregistered dependency. `perform()` already has a "I don't recognize that
        // theme" reply path for an empty/mismatched catalog.
        let themeResolution = TemplateRuntime.resolve()
        let themeCatalog: ThemeCatalog
        if let templateURL = themeResolution.url, let loaded = try? ThemeCatalog.load(templateURL: templateURL) {
            themeCatalog = loaded
        } else {
            log.error("ThemeCatalog load failed at bootstrap; ApplyThemeIntent will report no themes available")
            themeCatalog = ThemeCatalog(themes: [])
        }
        AppDependencyManager.shared.add { () -> ThemeCatalog in themeCatalog }
        // `EditContentIntent` (B.5 / #149) routes natural-language edits through
        // `IntentEditBridge`, which asks `EditRouterRegistry.shared` for the live edit router of
        // the requested site. The registry is populated by `PreviewModel.open()` and cleared by
        // `PreviewModel.close()` — so an edit from Siri only resolves while the site's window
        // is open. The headless fallback is deferred (out of scope for B.5).
        let editBridge = IntentEditBridge(
            routerProvider: { siteID in await EditRouterRegistry.shared.router(for: siteID) }
        )
        AppDependencyManager.shared.add { () -> IntentEditBridge in editBridge }
        // FM-backed edit interpreter for `EditContentIntent` (B.6 / #251). Gated behind the
        // Xcode-27 compiler so `AnglesiteIntents` still builds on CI's older toolchain (#128).
        // The interpreter is app-wide (no per-site state); siteID/siteDirectory are threaded
        // through `InterpretedElementContext` by `perform()` at interpret time.
        #if compiler(>=6.4)
        let fmAssistant = FoundationModelAssistant()
        let editInterpreter: any EditInterpreting = FoundationModelEditInterpreter(assistant: fmAssistant)
        #else
        let editInterpreter: any EditInterpreting = UnavailableEditInterpreter()
        #endif
        AppDependencyManager.shared.add { () -> any EditInterpreting in editInterpreter }

        await SiteStore.shared.setChangeHandler { sites in
            do {
                let outcome = try await SpotlightIndexer.shared.reindex(sites)
                log.info("indexed=\(outcome.indexed, privacy: .public) removed=\(outcome.removed, privacy: .public)")
            } catch {
                log.error("reindex failed: \(error.localizedDescription, privacy: .public)")
            }
        }

        // Mirror the content graph (pages/posts/images) into the Spotlight semantic index the same
        // way (A.3, #144). The handler fires per-siteID after every graph mutation — load on site
        // open, upsert/remove on file-watch, unload on site close — and the indexer diffs that
        // site's current snapshot against what it last published.
        let contentIndexer = ContentSpotlightIndexer(graph: contentGraph, backend: LiveContentSpotlightBackend())
        await contentGraph.setChangeHandler { siteID in
            do {
                let outcome = try await contentIndexer.reindex(siteID: siteID)
                contentLog.info("indexed=\(outcome.indexed, privacy: .public) removed=\(outcome.removed, privacy: .public)")
            } catch {
                contentLog.error("reindex failed: \(error.localizedDescription, privacy: .public)")
            }
        }
        // Surface the top-N most-recently-used sites to macOS 27's Siri/Spotlight "relevant
        // entities" suggestions (B.1 / #124). Driven off `changeStream()` rather than the
        // Spotlight `changeHandler` because relevance must track MRU *reordering* (site opens
        // bump order via `touch()`, which the data-only `changeHandler` deliberately skips —
        // SiteStore.swift). `changeStream()` yields the current snapshot on subscribe, on data
        // changes, and on reorders, so the initial set publishes without a separate kick.
        let relevant = RelevantEntitiesUpdater.shared
        // Intentionally app-lifetime and never cancelled: the handle is discarded and the
        // `for await` holds the stream open for the life of the process (matching the
        // long-lived `setChangeHandler` closures above). `bootstrap` runs once per app launch.
        Task {
            for await sites in SiteStore.shared.changeStream() {
                do {
                    let outcome = try await relevant.refresh(sites)
                    relevantLog.info("relevant count=\(outcome.count, privacy: .public) skipped=\(outcome.skipped, privacy: .public)")
                } catch {
                    relevantLog.error("relevant refresh failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }

        do {
            try await SiteStore.shared.load()
        } catch {
            log.error("initial load failed: \(error.localizedDescription, privacy: .public)")
        }
        return contentIndexer
    }
}
