import Foundation

/// Pure reply strings for the brand-voice tool, non-gated for CI tests.
public enum SaveBrandVoiceReply {
    /// The tool's user-visible reply, listing exactly which answer categories were captured so
    /// the owner can spot (and correct) a field the model dropped during the interview. When
    /// every field is empty it returns the "didn't save" message instead — mirroring the
    /// ``BrandVoiceWriter/hasContent(_:)`` guard the tool applies before writing, so the reply
    /// never claims a save that didn't happen.
    public static func confirmation(for answers: BrandVoiceAnswers) -> String {
        var saved: [String] = []
        if !answers.audience.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { saved.append("audience") }
        if !answers.toneWords.isEmpty { saved.append("tone") }
        if !answers.brandTerms.isEmpty { saved.append("brand terms") }
        if !answers.avoidPhrases.isEmpty { saved.append("phrases to avoid") }
        guard !saved.isEmpty else {
            return "I didn't save anything — I need at least one answer (audience, tone words, brand terms, or phrases to avoid)."
        }
        return "Saved this site's brand voice (\(saved.joined(separator: ", "))). Future copy suggestions will match it."
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Chat front-door for the brand-voice interview (#465): the model interviews the owner in
/// conversation, then calls this once with the collected answers. Writes `.userOverride`
/// entries through the shared `ProjectConventionsEngine` (via `BrandVoiceWriter`) — the same
/// engine `ProjectConventionsModel`'s Style Guide sheet writes through — so a chat-driven save
/// can't be silently reverted by a later GUI override write persisting a stale engine snapshot.
public struct SaveBrandVoiceTool: Tool, Sendable {
    /// The tool's stable name. Exposed statically so callers (e.g. `FoundationModelAssistant`'s
    /// `.started` event) can report the attached tools without constructing an instance.
    public static let toolName = "saveBrandVoice"
    /// `Tool` conformance — always ``SaveBrandVoiceTool/toolName``.
    public let name = SaveBrandVoiceTool.toolName
    /// The tool card the model reads. Front-loads the interview protocol (one question at a
    /// time, four specific questions) because the on-device model has no other channel for
    /// learning how this tool expects to be driven.
    public let description = "Save the site's brand voice after interviewing the owner. Before calling, ask the owner (one question at a time): who the site speaks to, three personality words for the tone, brand/product terms with exact capitalization, and words or phrases to avoid."

    /// The interview answers as the model collected them. Every field is optional so a partial
    /// interview still saves what was gathered instead of failing outright.
    @Generable
    public struct Arguments {
        /// Who the site speaks to, in the owner's own words. `nil`/empty saves nothing for
        /// this field.
        @Guide(description: "Who the site speaks to, in the owner's words.")
        public var audience: String?
        /// Comma-separated personality words; split by `BrandVoiceInterview.list` before saving.
        @Guide(description: "About three personality words, comma-separated (e.g. 'warm, expert, playful').")
        public var toneWords: String?
        /// Comma-separated brand/product terms, capitalization preserved exactly — the point of
        /// collecting them is to stop copy suggestions from re-casing them.
        @Guide(description: "Brand/product terms with their exact capitalization, comma-separated.")
        public var brandTerms: String?
        /// Comma-separated words or phrases the owner never wants used.
        @Guide(description: "Words or phrases the owner never wants used, comma-separated.")
        public var avoidPhrases: String?
    }

    private let engine: ProjectConventionsEngine
    private let store: ProjectConventionsStore
    private let siteID: String

    /// Binds the tool to one site's conventions engine and store. Pass the *shared* engine —
    /// the same instance `ProjectConventionsModel`'s Style Guide sheet uses — or a chat-driven
    /// save can be silently reverted by a later GUI write persisting a stale engine snapshot
    /// (see the type doc).
    public init(engine: ProjectConventionsEngine, store: ProjectConventionsStore, siteID: String) {
        self.engine = engine
        self.store = store
        self.siteID = siteID
    }

    /// Saves the collected answers (only when at least one field has content) and returns the
    /// ``SaveBrandVoiceReply/confirmation(for:)`` string, so the reply's saved-category list and
    /// the write are derived from the same normalized ``BrandVoiceAnswers`` and can't disagree.
    public func call(arguments: Arguments) async throws -> String {
        let answers = BrandVoiceAnswers(
            audience: arguments.audience ?? "",
            toneWords: BrandVoiceInterview.list(arguments.toneWords),
            brandTerms: BrandVoiceInterview.list(arguments.brandTerms),
            avoidPhrases: BrandVoiceInterview.list(arguments.avoidPhrases)
        )
        let reply = SaveBrandVoiceReply.confirmation(for: answers)
        if BrandVoiceWriter.hasContent(answers) {
            await BrandVoiceWriter.save(answers, engine: engine, store: store, siteID: siteID)
        }
        return reply
    }
}
#endif
