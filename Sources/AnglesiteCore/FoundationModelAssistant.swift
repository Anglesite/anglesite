import Foundation

/// Which Apple model substrate a `FoundationModelAssistant` targets.
///
/// Declared *outside* the `#if compiler(>=6.4)` gate because it has no `FoundationModels`
/// dependency and can be referenced from package code compiled on older CI toolchains.
///
/// - Important: A 2026-07-10 feasibility spike
///   (`docs/specs/2026-07-10-pcc-escalation-spike-notes.md`) found that a real, public
///   `PrivateCloudComputeLanguageModel` API exists in the macOS 27 SDK's `FoundationModels`
///   framework, conforming to `LanguageModel` and usable via `LanguageModelSession(model:)` —
///   it is not aspirational or SPI. However, using it requires a manually-requested Apple
///   developer entitlement this project has not yet obtained, plus undesigned quota- and
///   availability-fallback handling (the type carries its own `QuotaUsage`/`Availability`
///   states). `.privateCloudCompute` remains backed by the on-device session until that
///   entitlement is granted and the integration is designed — this is a deliberate near-term
///   scope choice, not an API limitation. The only observable difference today is the
///   advertised ``AssistantCapabilities``.
public enum FoundationModelTier: String, Sendable, Equatable, CaseIterable {
    /// `SystemLanguageModel.default` — the ~3B on-device model. Free, no network.
    case onDevice            = "onDevice"
    /// Reserved. Backed by the on-device session in v1 (see type note); advertises a larger
    /// context window via capabilities.
    case privateCloudCompute = "privateCloudCompute"
}

/// Deterministic context-budget helpers, usable without `FoundationModels`. Declared as a
/// standalone type (not an extension on `FoundationModelAssistant`) because that actor is
/// declared inside the `#if compiler(>=6.4)` gate below and is therefore unavailable at this
/// point in the file on older toolchains — extending it here would break compilation on CI's
/// pre-6.4 `swift test` runners (#128).
///
/// Per the 2026-07-10 spike (see ``FoundationModelTier``'s doc comment), real PCC escalation is
/// not yet wired up, so "escalation" here means the caller (e.g. the design-interview
/// conversation) should chunk or summarize a prompt deterministically before it overruns the
/// on-device context window — there is no larger-model request to make yet.
public enum FoundationModelContextBudget {
    /// Conservative characters-per-token proxy (~4 chars/token for English), matching the
    /// existing character-based approach in `maxPageContentCharacters` — no on-device tokenizer
    /// is available to measure the real count.
    public static let onDeviceTokenBudget = 4_096
    private static let charsPerTokenEstimate = 4

    public static func estimatedTokens(for text: String) -> Int {
        text.count / charsPerTokenEstimate
    }

    /// Whether a prompt is estimated to exceed the on-device context budget.
    ///
    /// - Note: this is currently unconsumed scaffolding — `DesignInterviewModel`/
    ///   `DesignInterviewPrompts` don't call it yet; they apply their own independent, smaller
    ///   character cap directly on the user's raw message instead (see
    ///   `DesignInterviewPrompts.truncatedUserMessage`). Wiring this budget check into the actual
    ///   conversation flow is tracked alongside design-interview's other app-integration gaps in
    ///   Anglesite#631.
    public static func shouldEscalate(prompt: String) -> Bool {
        estimatedTokens(for: prompt) > onDeviceTokenBudget
    }
}

// Gated to the Xcode-27 toolchain — FoundationModels is absent at runtime on CI (#128) — and to
// canImport for genuine off-Darwin portability (cross-platform port design §5). See
// ContentAssistant.swift for the same pattern.
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
import CoreSpotlight
import OSLog

/// A ``ContentAssistant`` backed by Apple's on-device `FoundationModels`. Streams free-form text
/// and produces `Generable` structured output via guided generation.
///
/// Compiled into AnglesiteCore on both build targets; it needs no subprocess, so it is the
/// on-device path usable from the sandboxed MAS build.
public actor FoundationModelAssistant: ConversationalAssistant {
    // TODO(#623): this hardcoded mangled-symbol check is a workaround for a beta Xcode/macOS SDK-OS
    // skew (#541). Verified still live 2026-07-09 (#618, Xcode 27A5209h / macOS 26A5378j): the OS
    // now exports this same initializer under a *different* mangling (the extension signature's
    // Copyable requirement marker was dropped, `Rszrl` → `Rszl`), while the SDK still emits — and
    // this binary therefore still references — the old one. The hardcoded name must track what the
    // SDK emits, not what the OS exports; #623 has the re-sync recipe and the exit condition for
    // deleting this guard plus the weak-link settings in Package.swift/project.yml.
    /// Whether `Attachment(imageURL:orientation:)` actually resolves on this host. FoundationModels
    /// is weak-linked (#541), so a mangled name the installed OS doesn't export binds to a NULL
    /// pointer rather than failing to load — `dlsym` against the already-loaded image is the way to
    /// tell the two cases apart before calling through it.
    private static let imageAttachmentInitializerIsAvailable: Bool = {
        dlsym(
            dlopen(nil, RTLD_NOW),
            "_$s16FoundationModels10AttachmentVA2A05ImageC7ContentVRszrlE8imageURL11orientationACyAEG0A00G0V_So26CGImagePropertyOrientationVSgtcfC"
        ) != nil
    }()

    private let tier: FoundationModelTier
    private let editBridge: IntentEditBridge?
    private let contentGraph: SiteContentGraph?
    private let knowledgeIndex: SiteKnowledgeIndex?
    private let semanticRanker: SemanticRanker?
    private let integrationService: (any IntegrationOperationsService)?
    private let conventionsEngine: ProjectConventionsEngine?
    private let conventionsStore: ProjectConventionsStore?
    private let copyEditAuditor: (any CopyEditAuditing)?
    private let socialMediaPlanner: (any SocialMediaPlanning)?
    private let postRepurposer: (any PostRepurposing)?
    /// Builds a fresh ``DesignInterviewModel`` for the chat front door (#665). Infallible —
    /// distinct from ``DesignInterviewTool/ModelProvider``, which may throw when its backing
    /// state is gone. Named so the app-side wiring and this actor spell one type.
    public typealias DesignInterviewModelFactory = @Sendable () async -> DesignInterviewModel

    private let themeCatalog: ThemeCatalog?
    private let designInterviewFactory: DesignInterviewModelFactory?
    /// The chat session's design interview, built lazily by ``currentDesignInterviewModel()`` on
    /// the tool's first call. One interview per chat session: unlike every other tool dependency
    /// on this actor (window-lifetime, stateless), the interview is conversation-lifetime mutable
    /// state (#665) — it survives session trims (``trimSessionIfNeeded(current:context:)`` must
    /// not reset an in-flight interview) and is cleared only by ``resetSession()``. Deliberately
    /// a *separate* instance from the GUI sheet's `SiteWindowModel.designInterviewModel`: each
    /// front door owns its own conversation, and sharing would pop the sheet from a chat turn.
    private var designInterviewModel: DesignInterviewModel?
    private let logger = Logger(subsystem: "io.dwk.anglesite", category: "FoundationModelAssistant")
    /// The current conversational turn's consumer-facing ``TurnRelay``, retained so ``cancel()`` can
    /// wind it down. Cancelling stops *delivery* only — it never cancels the model stream, because
    /// cancelling Apple's on-device `streamResponse` mid-iteration traps the process (see ``converse``).
    private var activeRelay: TurnRelay?
    /// How many background drain tasks are still iterating a `streamResponse` to completion. The
    /// cached ``session`` is single-flight, so while any drain is in flight a new turn must open a
    /// fresh session rather than reuse a busy one (a cancelled turn keeps draining in the background).
    private var activeDrains = 0
    /// Cached session for the multi-turn ``converse(prompt:context:)`` path, so the on-device model
    /// retains conversation history across turns. Created lazily on the first turn and cleared by
    /// ``resetSession()``. The one-shot ``generate(prompt:context:)`` path deliberately bypasses it.
    private var session: LanguageModelSession?
    /// How many user turns (`Transcript.Entry.prompt` entries) the cached ``session`` retains
    /// before it's rebuilt from a trimmed window (#456). Apple's session accumulates the full
    /// prompt/response/tool-call transcript internally with no built-in compaction, and
    /// `maxContextTokens` (4,096 on-device) is only an advertised capability — nothing enforces it
    /// against the growing session, so a long-running chat can silently exceed the window. A
    /// heuristic turn count rather than an exact token budget: FoundationModels exposes no token
    /// accounting on `Transcript`, so this trades precision for something that's at least bounded.
    private let maxRetainedTurns: Int

    /// The multi-turn ``converse(prompt:context:)`` session attaches Apple's `SpotlightSearchTool`
    /// (budget-fit `.focused(.items)`/`.compact` config) for local RAG over indexed site content,
    /// so ``capabilities`` always advertises `supportsTools` (C.8, #158). When **both** `editBridge`
    /// and `contentGraph` are supplied, ``ApplyEditTool`` + ``SearchContentTool`` are added too. The
    /// one-shot `generate`/`generateStructured` paths carry no Spotlight tool, preserving their
    /// full context budget for generation.
    public init(
        tier: FoundationModelTier = .onDevice,
        editBridge: IntentEditBridge? = nil,
        contentGraph: SiteContentGraph? = nil,
        knowledgeIndex: SiteKnowledgeIndex? = nil,
        semanticRanker: SemanticRanker? = nil,
        integrationService: (any IntegrationOperationsService)? = nil,
        conventionsEngine: ProjectConventionsEngine? = nil,
        conventionsStore: ProjectConventionsStore? = nil,
        copyEditAuditor: (any CopyEditAuditing)? = nil,
        socialMediaPlanner: (any SocialMediaPlanning)? = nil,
        postRepurposer: (any PostRepurposing)? = nil,
        themeCatalog: ThemeCatalog? = nil,
        designInterviewFactory: DesignInterviewModelFactory? = nil,
        maxRetainedTurns: Int = 12
    ) {
        self.tier = tier
        self.editBridge = editBridge
        self.contentGraph = contentGraph
        self.knowledgeIndex = knowledgeIndex
        self.semanticRanker = semanticRanker
        self.integrationService = integrationService
        self.conventionsEngine = conventionsEngine
        self.conventionsStore = conventionsStore
        self.copyEditAuditor = copyEditAuditor
        self.socialMediaPlanner = socialMediaPlanner
        self.postRepurposer = postRepurposer
        self.themeCatalog = themeCatalog
        self.designInterviewFactory = designInterviewFactory
        // `trimSessionIfNeeded`'s cutoff indexing (`promptIndices.count - maxRetainedTurns`) assumes
        // at least 1: `<= 0` would index at or past the end of `promptIndices` and crash. Clamp
        // rather than crash so a caller passing e.g. `0` ("keep no history") degrades to the
        // smallest valid window instead of trapping.
        self.maxRetainedTurns = max(1, maxRetainedTurns)
        if tier == .privateCloudCompute {
            // v1 has no separate PCC session; fall back to on-device with a logged warning so the
            // requested tier degrades gracefully rather than erroring (see spec / #155).
            logger.warning("privateCloudCompute tier requested; v1 backs it with the on-device session")
        }
    }

    public nonisolated var capabilities: AssistantCapabilities {
        AssistantCapabilities(
            supportsStreaming: true,
            supportsStructuredOutput: true,
            supportsVision: true,  // macOS 27 on-device model accepts image attachments (C.7, #157)
            // The converse session always carries SpotlightSearchTool (C.8, #158). This advertises
            // that the tool is *attached*, not that every query succeeds: on MAS, converse runs the
            // on-device backend under App Sandbox (#159), and whether the Spotlight CSSearchableIndex
            // query needs an extra entitlement there is unverified until the MAS smoke (#81, Task 11).
            // Attachment and construction are sandbox-independent, so `true` is accurate regardless.
            supportsTools: true,
            maxContextTokens: tier == .privateCloudCompute ? 32_768 : 4_096,
            providerName: tier == .privateCloudCompute ? "Private Cloud Compute" : "On-Device"
        )
    }

    // MARK: ContentAssistant

    public func generate(
        prompt: String,
        context: AssistantContext
    ) async throws -> AsyncThrowingStream<String, Error> {
        // One-shot: a fresh session per call keeps independent `generate`/`generateStructured`
        // invocations (tool calls, alt-text, summaries) from bleeding history into one another. The
        // multi-turn `converse` path deliberately does the opposite — see `conversationSession`.
        let session = try makeSession(context: context)
        return Self.textStream(from: session, prompt: prompt)
    }

    /// Streams a session's response as incremental text deltas. `streamResponse` yields *cumulative*
    /// snapshots, so we diff against the prior prefix to emit only newly-appended text (matching the
    /// ``ContentAssistant`` per-chunk contract). Backs the one-shot `generate` path; `converse` runs
    /// its own ``TurnRelay`` drain over the cached session for the multi-turn `AssistantEvent` stream.
    private static func textStream(from session: LanguageModelSession, prompt: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let relay = TextStreamRelay(continuation)
            // Drain to completion on a task we never cancel — cancelling `streamResponse`
            // mid-iteration traps the process (`brk 1`, #200/#201). If the consumer drops the stream
            // early the drain keeps running and its chunks are discarded (the session is per-call and
            // unreferenced afterwards), mirroring `converse`'s drain-and-detach.
            Task {
                do {
                    var previous = ""
                    for try await snapshot in session.streamResponse(to: prompt) {
                        let full = snapshot.content
                        if full.hasPrefix(previous) {
                            // Confirmed cumulative prefix — emit only the newly-appended tail.
                            relay.deliver(String(full.dropFirst(previous.count)))
                        } else {
                            // The model revised earlier text (same or different length), so the
                            // snapshot isn't an extension of `previous`; yield it whole.
                            relay.deliver(full)
                        }
                        previous = full
                    }
                    relay.complete()
                } catch {
                    relay.fail(error)
                }
            }
            // Consumer dropped the stream: stop delivering, but keep draining (we never cancel the model).
            continuation.onTermination = { _ in relay.detach() }
        }
    }

    public func generateStructured<T: Generable & Sendable>(
        prompt: String,
        context: AssistantContext,
        resultType: T.Type
    ) async throws -> T {
        // One-shot, like `generate`: a fresh session, never the cached conversational one.
        let oneShotSession = try makeSession(context: context)
        return try await oneShotSession.respond(to: prompt, generating: T.self).content
    }

    /// Vision variant of ``generateStructured(prompt:context:resultType:)``: attaches the image at
    /// `imageURL` to the prompt so the macOS 27 on-device model can describe it (alt text, OCR,
    /// screenshot analysis). One-shot — a fresh session per call. Throws
    /// ``AssistantError/unavailable(_:)`` when the on-device model can't run on this host.
    public func generateStructured<T: Generable & Sendable>(
        prompt: String,
        imageURL: URL,
        context: AssistantContext,
        resultType: T.Type
    ) async throws -> T {
        // #541: FoundationModels is weak-linked (Package.swift/project.yml) so an Xcode SDK ahead of
        // the installed OS beta seed can't abort dyld at launch. `Attachment(imageURL:)` is the one
        // symbol in this file that skew has actually broken — a weakly-linked symbol the OS doesn't
        // export binds to NULL, so calling it directly would still crash. Guard with dlsym so a
        // mismatched pair degrades to `.unavailable` instead.
        guard Self.imageAttachmentInitializerIsAvailable else {
            // Expected on a skewed beta host (#541); if this fires on a matched SDK/OS pair the
            // hardcoded mangled symbol has gone stale and needs re-verifying against the current SDK.
            logger.error("Attachment(imageURL:orientation:) unresolved at runtime — vision path degraded to .unavailable (#541)")
            throw AssistantError.unavailable("FoundationModels vision API unavailable on this OS/SDK pair")
        }
        let oneShotSession = try makeSession(context: context)
        let image = Attachment(imageURL: imageURL)
        return try await oneShotSession.respond(generating: T.self) {
            prompt
            image
        }.content
    }

    // MARK: ConversationalAssistant

    /// Streams a full conversational turn as ``AssistantEvent`` values: `.started` →
    /// `.textDelta`* → `.turnComplete(nil)`. A mid-stream throw becomes `.failed`; cancellation
    /// becomes `.cancelled`. Setup failure (model unavailable) propagates as a thrown error *before*
    /// the turn opens.
    ///
    /// Unlike ``generate(prompt:context:)``, this reuses a **cached** `LanguageModelSession` across
    /// turns so the on-device model remembers the conversation — without it, every message would hit
    /// a memoryless session and the chat would be a one-shot query box. The first turn fixes the
    /// session's instructions from its `context`; later context changes don't retroactively rewrite
    /// that system prompt (an accepted V1 limitation). The
    /// on-device model exposes no discrete tool-use or token-usage telemetry, so tool invocations run
    /// opaquely inside the session and turns carry no usage.
    public func converse(prompt: String, context: AssistantContext) async throws -> AsyncStream<AssistantEvent> {
        // A new turn supersedes the prior one for the consumer (its stream ends `.cancelled`); the
        // prior drain is left to finish.
        activeRelay?.cancel()
        // The cached session is single-flight: reusing it while a drain still runs throws "session
        // busy", so open a fresh one. (Once drained it holds the full response, so later turns reuse
        // it and keep history.)
        if activeDrains > 0 { session = nil }

        // Proactively trim *before* this turn extends the transcript further — a heavy attached
        // tool set (#657) can already have pushed the cached session within reach of the on-device
        // budget even though `maxRetainedTurns` hasn't been crossed, and the existing post-turn,
        // turn-count-only trim below only protects *future* turns, not the one about to run.
        let session = sessionFittingBudget(try conversationSession(for: context), context: context)
        self.session = session
        let providerName = capabilities.providerName
        let toolNames = attachedToolNames

        let (stream, continuation) = AsyncStream.makeStream(of: AssistantEvent.self)
        let relay = TurnRelay(continuation)
        activeRelay = relay
        relay.deliver(.started(model: providerName, toolNames: toolNames))

        // Drain to completion on a task we never cancel — cancelling `streamResponse` mid-iteration
        // traps the process (`brk 1`); `cancel()` stops delivery via the relay instead.
        activeDrains += 1
        // Unstructured `Task` in an actor inherits the actor's isolation (Swift 6), so these
        // `activeDrains` mutations are actor-safe — keep it `Task`, not `Task.detached`.
        // Route/content ride along on the prompt itself, not the session's fixed instructions
        // (#457) — so each turn reflects the page the user is *currently* viewing, not whatever it
        // was when the cached session was first created.
        let turnPrompt = Self.turnPrompt(for: prompt, context: context)
        Task {
            defer { activeDrains -= 1 }
            do {
                var previous = ""
                for try await snapshot in session.streamResponse(to: turnPrompt) {
                    // `streamResponse` yields cumulative snapshots; emit only the newly-appended tail.
                    let full = snapshot.content
                    if full.hasPrefix(previous) {
                        relay.deliver(.textDelta(String(full.dropFirst(previous.count))))
                    } else {
                        logger.warning("streamResponse snapshot not cumulative — emitting full content as delta")
                        relay.deliver(.textDelta(full))
                    }
                    previous = full
                }
                relay.complete(.turnComplete(nil))
            } catch {
                relay.complete(.failed(message: error.localizedDescription))
            }
            trimSessionIfNeeded(current: session, context: context)
        }

        // Consumer dropped the stream: stop delivering, but keep draining (we never cancel the model).
        continuation.onTermination = { _ in relay.detach() }
        return stream
    }

    /// Winds down the in-flight ``converse(prompt:context:)`` turn for the consumer: the event stream
    /// ends promptly with `.cancelled`. The underlying model stream is **not** cancelled — it drains
    /// to completion in the background (cancelling it mid-flight traps the process), leaving the
    /// cached session coherent so the conversation can continue. Use ``resetSession()`` to forget it.
    public func cancel() async {
        activeRelay?.cancel()
        activeRelay = nil
    }

    /// Discards the cached `LanguageModelSession` (and winds down any in-flight turn) so the next
    /// ``converse(prompt:context:)`` opens a fresh conversation with no memory of prior turns. A
    /// still-running background drain holds its own session reference and finishes harmlessly.
    public func resetSession() async {
        activeRelay?.cancel()
        activeRelay = nil
        session = nil
        // Resetting the chat also starts a fresh design interview (#665) — the interview is
        // conversation-lifetime state, and "reset" means the whole conversation to the user.
        designInterviewModel = nil
    }

    /// Returns the chat session's ``DesignInterviewModel``, lazily building it via the injected
    /// `designInterviewFactory` on first use, or `nil` when no factory was supplied. Cached so
    /// every ``DesignInterviewTool`` call within one chat session continues the same interview;
    /// ``resetSession()`` clears it. See `designInterviewModel`'s doc comment for the lifetime
    /// rationale (#665).
    func currentDesignInterviewModel() async -> DesignInterviewModel? {
        guard let designInterviewFactory else { return nil }
        if let designInterviewModel { return designInterviewModel }
        let created = await designInterviewFactory()
        // Actor reentrancy: a concurrent tool call may have built one while the factory ran —
        // first writer wins so both calls continue the same interview. The losing build is
        // discarded outright; that's intentional and cheap while `DesignInterviewModel.init` is
        // plain property assignment — keep the factory free of heavy work (I/O is fine, it's
        // rare) or add dedup before the `await` if that ever changes.
        if let existing = designInterviewModel { return existing }
        designInterviewModel = created
        return created
    }

    /// Test-only: the clamped ``maxRetainedTurns`` actually stored, so tests can assert `init`
    /// clamps non-positive values rather than crashing later in ``trimSessionIfNeeded``.
    nonisolated var maxRetainedTurnsForTesting: Int { maxRetainedTurns }

    /// Test-only: number of `.prompt` entries in the cached session's transcript, or `nil` if no
    /// session is cached. Exercises ``trimSessionIfNeeded(current:context:)`` (#456) without a
    /// public surface.
    var promptCountForTesting: Int? {
        session?.transcript.reduce(into: 0) { count, entry in
            if case .prompt = entry { count += 1 }
        }
    }

    /// Display label for `SpotlightSearchTool` in the `.started` event. `SpotlightSearchTool`
    /// exposes no public `toolName` (unlike `ApplyEditTool`/`SearchContentTool`), so this is a
    /// fixed local label — update it here if a future SDK adds a public name to bind to.
    private static let spotlightToolDisplayName = "spotlightSearch"

    /// Tool names for the `.started` event (emitted only on the `converse` path) so the chat UI can
    /// reflect what's wired. Never empty — the conversational session always carries
    /// `SpotlightSearchTool`; the edit/search pair is added only when both deps are present;
    /// `SetupIntegrationTool` is added when an `integrationService` is provided; `SaveBrandVoiceTool`
    /// is added when both a `conventionsEngine` and a `conventionsStore` are provided;
    /// `ReviewCopyTool` is added when a `copyEditAuditor` is provided. `PlanSocialMediaTool` is
    /// added when a `socialMediaPlanner` is provided. `RepurposePostTool`/`SaveSyndicationTool` are
    /// added together when a `postRepurposer` is provided. `SetupThemeTool` is added when a
    /// `themeCatalog` is provided. `DesignInterviewTool` is added when a
    /// `designInterviewFactory` is provided (#665).
    private var attachedToolNames: [String] {
        var names = [Self.spotlightToolDisplayName]
        if editBridge != nil && contentGraph != nil {
            names += [ApplyEditTool.toolName, SearchContentTool.toolName]
        }
        if knowledgeIndex != nil {
            names.append(SearchKnowledgeTool.toolName)
            names.append(SuggestLinksTool.toolName)
            names.append(FindLinkOpportunitiesTool.toolName)
        }
        if integrationService != nil {
            names.append(SetupIntegrationTool.toolName)
        }
        if conventionsEngine != nil, conventionsStore != nil {
            names.append(SaveBrandVoiceTool.toolName)
        }
        if copyEditAuditor != nil {
            names.append(ReviewCopyTool.toolName)
        }
        if socialMediaPlanner != nil {
            names.append(PlanSocialMediaTool.toolName)
        }
        if postRepurposer != nil {
            names.append(RepurposePostTool.toolName)
            names.append(SaveSyndicationTool.toolName)
        }
        if themeCatalog != nil {
            names.append(SetupThemeTool.toolName)
        }
        if designInterviewFactory != nil {
            names.append(DesignInterviewTool.toolName)
        }
        return names
    }

    /// Test-only: exposes ``attachedToolNames`` so tests can assert optional-tool advertising
    /// without a live model turn (the production surface is the `.started` event).
    var attachedToolNamesForTesting: [String] { attachedToolNames }

    /// Test-only: exposes ``conversationTools(for:includeSpotlight:)`` so tests can assert which
    /// tool types a conversational session would carry without constructing a live session.
    func conversationToolsForTesting(for context: AssistantContext) -> [any Tool] {
        conversationTools(for: context, includeSpotlight: false)
    }

    /// Returns the cached conversational session, lazily creating it from `context` on first use.
    /// The session persists across turns to retain history; ``resetSession()`` clears it.
    private func conversationSession(for context: AssistantContext) throws -> LanguageModelSession {
        if let session { return session }
        let created = try makeSession(context: context, includeSpotlight: true)
        session = created
        return created
    }

    // MARK: Session

    /// Builds a fresh session for `context`, throwing ``AssistantError/unavailable(_:)`` when the
    /// on-device model can't be used on this host. Callers decide lifetime: ``generate`` /
    /// ``generateStructured`` build one per call (one-shot, no history bleed); ``converse`` builds one
    /// and caches it (multi-turn history). The instructions fold in the context's route/content at
    /// construction time, so a cached session keeps the first turn's system prompt.
    private func makeSession(context: AssistantContext,
                             includeSpotlight: Bool = false) throws -> LanguageModelSession {
        switch SystemLanguageModel.default.availability {
        case .available:
            break
        case .unavailable:
            throw AssistantError.unavailable(
                "Apple Intelligence isn't available. Enable it in System Settings → Apple Intelligence & Siri, then try again."
            )
        @unknown default:
            throw AssistantError.unavailable("The on-device model is unavailable on this device.")
        }
        // Conversational sessions (`includeSpotlight: true`, i.e. built via `conversationSession`)
        // keep minimal, stable instructions — page route/content is folded into each turn's prompt
        // by `turnPrompt(for:context:)` instead, so a cached session doesn't bake in whatever page
        // the user was viewing when the conversation started and never update it (#457). One-shot
        // `generate`/`generateStructured` build a fresh session per call, so there's no staleness
        // risk there — they keep the fuller instructions (`FoundationModelEditInterpreter` and
        // `AltTextGenerator` both rely on `currentPageRoute` reaching the model this way).
        let instructions = Self.instructions(for: context, includePageContext: !includeSpotlight)
        let tools = conversationTools(for: context, includeSpotlight: includeSpotlight)
        // `tools` is empty only on the one-shot paths (`includeSpotlight: false`) with no
        // editBridge/contentGraph; the converse path always appends Spotlight, so its session is
        // never tool-less. The empty branch preserves the prior tool-less one-shot behavior.
        return tools.isEmpty
            ? LanguageModelSession(instructions: instructions)
            : LanguageModelSession(tools: tools, instructions: instructions)
    }

    /// Builds the tool set for `context`. Shared by ``makeSession(context:includeSpotlight:)`` and
    /// ``trimSessionIfNeeded(current:context:)`` so a rebuilt (trimmed) conversational session gets
    /// the same tools a freshly-created one would.
    private func conversationTools(for context: AssistantContext, includeSpotlight: Bool) -> [any Tool] {
        var tools: [any Tool] = []
        // The iOS *simulator* SDK doesn't vend `SpotlightSearchTool` (device and macOS SDKs do),
        // so the append compiles out there — simulators have no Apple Intelligence session to
        // reach the tool anyway.
        #if !targetEnvironment(simulator)
        if includeSpotlight {
            // Default GuidanceLevel.complete injects a ~13k-token query manual that exceeds the
            // on-device 4,096-token window. .focused(.items) scopes guidance to our page/post
            // text domain and .compact trims output — measured to fit (C.8, #158).
            tools.append(SpotlightSearchTool(configuration: .init(
                sources: [.coreSpotlight],
                guide: .init(level: .focused(.items), format: .compact))))
        }
        #endif
        if let editBridge, let contentGraph {
            tools.append(ApplyEditTool(
                bridge: editBridge,
                siteID: context.siteID,
                contextSelector: context.selectedElementSelector
            ))
            tools.append(SearchContentTool(contentGraph: contentGraph, siteID: context.siteID))
        }
        if let knowledgeIndex {
            tools.append(SearchKnowledgeTool(index: knowledgeIndex, siteID: context.siteID, ranker: semanticRanker))
            tools.append(SuggestLinksTool(index: knowledgeIndex, siteID: context.siteID, ranker: semanticRanker))
            tools.append(FindLinkOpportunitiesTool(index: knowledgeIndex, siteID: context.siteID))
        }
        if let integrationService {
            tools.append(SetupIntegrationTool(service: integrationService, siteID: context.siteID))
        }
        if let conventionsEngine, let conventionsStore {
            tools.append(SaveBrandVoiceTool(engine: conventionsEngine, store: conventionsStore, siteID: context.siteID))
        }
        if let copyEditAuditor {
            tools.append(ReviewCopyTool(
                auditor: copyEditAuditor, conventionsStore: conventionsStore,
                siteID: context.siteID, siteDirectory: context.siteDirectory))
        }
        if let socialMediaPlanner {
            tools.append(PlanSocialMediaTool(
                planner: socialMediaPlanner, conventionsStore: conventionsStore,
                siteID: context.siteID, siteDirectory: context.siteDirectory))
        }
        if let postRepurposer {
            tools.append(RepurposePostTool(
                repurposer: postRepurposer, conventionsStore: conventionsStore,
                siteID: context.siteID, siteDirectory: context.siteDirectory))
            tools.append(SaveSyndicationTool(siteDirectory: context.siteDirectory))
        }
        if let themeCatalog {
            tools.append(SetupThemeTool(catalog: themeCatalog, sourceDirectory: context.siteDirectory))
        }
        if designInterviewFactory != nil {
            // The provider routes through the actor's cache so every call in this chat session
            // continues one interview (#665). `[weak self]` because the actor retains the
            // session, the session retains its tools, and a strong capture would close a
            // self-retain cycle. A nil `self` means the tool outlived its actor — unreachable
            // today (the session's lifetime is bounded by the actor's); fail the call loudly
            // rather than silently fabricating an uncached interview with no history.
            tools.append(DesignInterviewTool(provider: { [weak self] in
                guard let self, let model = await self.currentDesignInterviewModel() else {
                    throw CancellationError()
                }
                return model
            }))
        }
        return tools
    }

    /// Rebuilds the cached ``session`` from a trimmed suffix of its transcript once it holds more
    /// than ``maxRetainedTurns`` turns — the only lever available since FoundationModels exposes no
    /// compaction API (#456). Runs after each turn drains so the *next* turn (not the one that just
    /// finished) benefits from the smaller transcript. `current === session` guards against
    /// clobbering a session a newer turn already replaced while this drain was still in flight (see
    /// `activeDrains` in ``converse(prompt:context:)``). Pure turn-count: the pre-turn
    /// ``sessionFittingBudget(_:context:)`` check (#657) is what protects the turn about to run
    /// from a heavy tool set overflowing the budget before this ceiling is even crossed.
    private func trimSessionIfNeeded(current: LanguageModelSession, context: AssistantContext) {
        guard session === current else { return }
        guard let trimmed = Self.trimmedTranscript(current.transcript, retaining: maxRetainedTurns) else { return }
        let tools = conversationTools(for: context, includeSpotlight: true)
        session = LanguageModelSession(tools: tools, transcript: trimmed)
    }

    /// Rebuilds `transcript` keeping only its most recent `turns` `.prompt` entries (and everything
    /// after the cutoff), plus the leading `.instructions` entry if present — so a trimmed session
    /// still carries the route/page context and tool schemas it was created with. Returns `nil` when
    /// `transcript` doesn't hold more than `turns` prompts (nothing to trim). Shared by the
    /// turn-count trim (``trimSessionIfNeeded(current:context:)``) and the token-budget trim
    /// (``sessionFittingBudget(_:context:)``, #657) so both rebuild a session identically.
    private static func trimmedTranscript(_ transcript: Transcript, retaining turns: Int) -> Transcript? {
        let promptIndices = transcript.indices.filter {
            if case .prompt = transcript[$0] { return true }
            return false
        }
        guard promptIndices.count > turns else { return nil }
        let cutoff = promptIndices[promptIndices.count - turns]
        var retained = Array(transcript[cutoff...])
        if let first = transcript.first, case .instructions = first {
            retained.insert(first, at: 0)
        }
        return Transcript(entries: retained)
    }

    /// Estimated token weight of a transcript's entries, including tool schemas baked into a
    /// leading `.instructions` entry — `Transcript.Entry` is `CustomStringConvertible`, so its
    /// `description` captures the actual segments/tool definitions sent to the model, letting this
    /// reuse ``FoundationModelContextBudget``'s character-based token proxy rather than needing a
    /// real on-device tokenizer.
    private static func estimatedTranscriptTokens(_ transcript: Transcript) -> Int {
        transcript.reduce(into: 0) { total, entry in
            total += FoundationModelContextBudget.estimatedTokens(for: String(describing: entry))
        }
    }

    /// Fraction of ``FoundationModelContextBudget/onDeviceTokenBudget`` the cached session is
    /// allowed to reach before a turn proactively trims it further — kept below 1.0 so trimming
    /// leaves headroom for the turn about to run (its own prompt plus the model's response),
    /// rather than reacting only once the budget is already blown.
    private static let transcriptBudgetHeadroom = 0.7

    /// Token ceiling a candidate transcript must fit under, derived from
    /// ``transcriptBudgetHeadroom``.
    private static var transcriptBudgetThreshold: Int {
        Int(Double(FoundationModelContextBudget.onDeviceTokenBudget) * transcriptBudgetHeadroom)
    }

    /// Proactively shrinks `session`'s retained-turn window below ``maxRetainedTurns`` when its
    /// estimated token weight is already within reach of the on-device budget (#657). A heavy
    /// attached tool set (11 tools, per the chat front door) can push a cached session's estimated
    /// weight over budget well before ``maxRetainedTurns`` prompts accumulate — the existing
    /// post-turn, count-only ``trimSessionIfNeeded(current:context:)`` can't prevent that, since it
    /// only ever protects the turn *after* the one that overflowed. Shrinks the window one turn at a
    /// time (rather than jumping straight to ``trimmedTranscript(_:retaining:)``'s single-shot cut)
    /// so it stops as soon as the transcript fits, instead of over-trimming history that wasn't the
    /// problem. Returns `session` unchanged once it fits, or once shrunk to a single retained turn —
    /// the smallest useful window, past which the tool schemas (not history) are what dominate.
    private func sessionFittingBudget(_ session: LanguageModelSession, context: AssistantContext) -> LanguageModelSession {
        guard Self.estimatedTranscriptTokens(session.transcript) > Self.transcriptBudgetThreshold else {
            return session
        }
        var window = maxRetainedTurns
        while window > 1 {
            window -= 1
            guard let candidate = Self.trimmedTranscript(session.transcript, retaining: window) else { continue }
            if window == 1 || Self.estimatedTranscriptTokens(candidate) <= Self.transcriptBudgetThreshold {
                let tools = conversationTools(for: context, includeSpotlight: true)
                return LanguageModelSession(tools: tools, transcript: candidate)
            }
        }
        return session
    }

    /// Character cap on how much of ``AssistantContext/currentPageContent`` is folded into a
    /// prompt (#457). No on-device tokenizer is available to measure the real 4,096-token budget,
    /// so this is a conservative character-based proxy — chosen so a caller passing e.g. raw page
    /// HTML can't single-handedly crowd out the user's own prompt and the rest of the
    /// conversation. Applies to both ``instructions(for:includePageContext:)`` (one-shot paths) and
    /// ``turnPrompt(for:context:)`` (the conversational path).
    static let maxPageContentCharacters = 2_000

    /// Truncates `content` to ``maxPageContentCharacters``, operating on whatever text the caller
    /// passed — extracted text is expected, not raw HTML (no HTML-extraction utility exists yet in
    /// `AnglesiteCore`; that's separate, larger work, out of scope here).
    static func truncatedPageContent(_ content: String) -> String {
        guard content.count > maxPageContentCharacters else { return content }
        return String(content.prefix(maxPageContentCharacters)) + "…"
    }

    /// Folds the situational ``AssistantContext`` into session instructions. `includePageContext`
    /// is false for the conversational session, whose instructions must stay stable across turns —
    /// see the call site in ``makeSession(context:includeSpotlight:)``.
    static func instructions(for context: AssistantContext, includePageContext: Bool) -> String {
        var lines = ["You are an assistant helping edit and improve a website."]
        if includePageContext {
            if let route = context.currentPageRoute { lines.append("The user is viewing the page at \(route).") }
            if let content = context.currentPageContent {
                lines.append("Current page content:\n\(truncatedPageContent(content))")
            }
        }
        return lines.joined(separator: "\n")
    }

    /// Composes a conversational turn's actual prompt: the current page's route/content (truncated,
    /// #457) prepended to the user's message. Used only by ``converse(prompt:context:)`` — the
    /// session's instructions stay minimal and stable (see ``instructions(for:includePageContext:)``),
    /// so per-turn context reaches the model without rebuilding the session or leaving it stale when
    /// the user navigates mid-conversation.
    static func turnPrompt(for prompt: String, context: AssistantContext) -> String {
        var lines: [String] = []
        if let route = context.currentPageRoute { lines.append("The user is viewing the page at \(route).") }
        if let content = context.currentPageContent {
            lines.append("Current page content:\n\(truncatedPageContent(content))")
        }
        lines.append(prompt)
        return lines.joined(separator: "\n")
    }
}
#endif
