import Foundation

// `FoundationModels` ships in the macOS 26 SDK but is absent from GitHub's `macos-15`
// runner at *runtime* — linking it into the package makes the whole test bundle fail to
// `dlopen`. Gate it behind the Xcode-27 toolchain (Swift 6.4) so CI on Xcode 26.3 builds
// and loads the reduced surface, while production (always Xcode 27) gets the full protocol.
// Also gate on canImport for genuine off-Darwin portability (cross-platform port design §5).
// Same pattern + tracking as the long-running-intent guards — see #128.
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
#endif

/// Provider-agnostic surface for LLM-backed content assistance.
///
/// Conformers wrap a concrete backend behind one streaming + structured API so callers
/// (`ChatModel`, the on-device feature tools) don't depend on a concrete implementation.
///
/// - Note: ``generate(prompt:context:)`` yields **plain text** chunks. Conversational callers use
///   ``ConversationalAssistant`` when they need a richer event stream.
public protocol ContentAssistant: Sendable {
    /// Streams a free-form text response for `prompt`, one chunk at a time.
    ///
    /// The outer `async throws` covers setup failures (model unavailable, context too large);
    /// per-chunk failures surface as a thrown error inside the stream.
    func generate(
        prompt: String,
        context: AssistantContext
    ) async throws -> AsyncThrowingStream<String, Error>

    /// Produces a guided-generation result conforming to `Generable` — the structured-output
    /// path used for edit commands, page metadata, alt text, summaries, and classification.
    ///
    /// - Note: Requires `FoundationModels`, so it's gated to the Xcode-27 toolchain (#128).
    ///   Production builds always have it; CI on Xcode 26.3 sees the streaming surface only.
    /// - Note: `T` is constrained to `Sendable` so actor-isolated conformers can return it across this
    ///   `nonisolated` boundary without a data-race warning. Tightening a `public` requirement is
    ///   technically source-breaking for out-of-module conformers, but every conformer is internal
    ///   to this app, and all `@Generable` result types already conform to `Sendable`.
    #if compiler(>=6.4) && canImport(FoundationModels)
    func generateStructured<T: Generable & Sendable>(
        prompt: String,
        context: AssistantContext,
        resultType: T.Type
    ) async throws -> T
    #endif

    /// Static description of what this backend can do. Callers gate UI and routing on this
    /// rather than type-checking the concrete conformer.
    var capabilities: AssistantCapabilities { get }
}

/// The situational context handed to a ``ContentAssistant`` for a single request: which site,
/// where it lives on disk, what the user is currently looking at, and the conversation so far.
public struct AssistantContext: Sendable {
    /// Stable id of the site this request concerns.
    public let siteID: String
    /// Root of the site's on-disk source, for backends that read files directly
    /// (RAG enrichment, page lookups).
    public let siteDirectory: URL
    /// Route of the page currently shown in the preview pane, if any (e.g. `/about`).
    public let currentPageRoute: String?
    /// Source content of the current page, if the caller has it loaded.
    public let currentPageContent: String?
    /// Structured `ElementInfo` (a `JSONValue` object, e.g. `{"tag":"h1","index":0}`) for the
    /// element the user selected in the overlay, if any. Matches `EditMessage.selector` /
    /// `IntentEditBridge` so a conformer can route an edit without re-deriving a selector — the
    /// plugin's `server/selector.mjs` builds the CSS string server-side. See #18.
    public let selectedElementSelector: JSONValue?
    /// Prior turns, oldest first.
    public let conversationHistory: [AssistantMessage]
    /// Optional kind filter for RAG retrieval. When non-nil, only documents matching these kinds
    /// are considered during the pre-prompt enrichment search.
    public let searchOptions: SiteKnowledgeIndex.SearchOptions

    /// Memberwise initializer. Everything beyond the site identity defaults to empty/absent, so
    /// one-shot feature calls (alt text, summaries) stay terse while conversational callers layer
    /// on history and selection.
    public init(
        siteID: String,
        siteDirectory: URL,
        currentPageRoute: String? = nil,
        currentPageContent: String? = nil,
        selectedElementSelector: JSONValue? = nil,
        conversationHistory: [AssistantMessage] = [],
        searchOptions: SiteKnowledgeIndex.SearchOptions = .init()
    ) {
        self.siteID = siteID
        self.siteDirectory = siteDirectory
        self.currentPageRoute = currentPageRoute
        self.currentPageContent = currentPageContent
        self.selectedElementSelector = selectedElementSelector
        self.conversationHistory = conversationHistory
        self.searchOptions = searchOptions
    }
}

/// One turn in a ``AssistantContext/conversationHistory``.
public struct AssistantMessage: Sendable, Equatable {
    /// Who produced this turn.
    public let role: Role
    /// The turn's plain-text body.
    public let content: String

    /// Speaker of a conversation turn — the conventional chat-completion role triple, so
    /// history round-trips to any backend without translation.
    public enum Role: Sendable, Equatable {
        /// The site owner's message.
        case user
        /// A prior model reply.
        case assistant
        /// App-injected instructions or framing, not authored by the user.
        case system
    }

    /// Memberwise initializer.
    public init(role: Role, content: String) {
        self.role = role
        self.content = content
    }
}

/// Static capability descriptor for a ``ContentAssistant`` backend. Used to gate features
/// (vision, tools) and route requests by tier.
public struct AssistantCapabilities: Sendable, Equatable {
    /// `true` when the backend delivers incremental chunks (vs. buffering a full reply into a
    /// single yield).
    public let supportsStreaming: Bool
    /// Whether the guided-generation path is available — callers gate structured features on
    /// this, not on toolchain conditionals.
    public let supportsStructuredOutput: Bool
    /// Whether the backend accepts image input.
    public let supportsVision: Bool
    /// Whether the backend can invoke tools during generation.
    public let supportsTools: Bool
    /// Maximum input context window in tokens, or `nil` when the backend doesn't expose one.
    public let maxContextTokens: Int?
    /// Human-readable provider label, e.g. "On-Device" or "Private Cloud Compute".
    public let providerName: String

    /// Memberwise initializer. Every field is required — a new backend must decide each
    /// capability explicitly rather than inheriting silent defaults.
    public init(
        supportsStreaming: Bool,
        supportsStructuredOutput: Bool,
        supportsVision: Bool,
        supportsTools: Bool,
        maxContextTokens: Int?,
        providerName: String
    ) {
        self.supportsStreaming = supportsStreaming
        self.supportsStructuredOutput = supportsStructuredOutput
        self.supportsVision = supportsVision
        self.supportsTools = supportsTools
        self.maxContextTokens = maxContextTokens
        self.providerName = providerName
    }
}
