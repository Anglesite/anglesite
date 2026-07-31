import Foundation

/// Deterministic grounding-prompt builders for the design-interview conversation, one per
/// ``ConversationStage``. Follows ``SiteGraphExplainPrompt``'s pattern: facts are assembled from
/// typed data, never invented, and every prompt caps its own size to stay well under the
/// on-device 4,096-token budget.
public enum DesignInterviewPrompts {
    /// Caps how much of the raw user message gets interpolated into a prompt template, mirroring
    /// ``FoundationModelAssistant/maxPageContentCharacters``'s character-based proxy for the
    /// on-device token budget (no on-device tokenizer is available to measure it directly).
    static let maxUserMessageCharacters = 1_000

    /// Truncates `message` to ``maxUserMessageCharacters``, appending "…" when truncated — same
    /// shape as ``FoundationModelAssistant/truncatedPageContent(_:)``.
    static func truncatedUserMessage(_ message: String) -> String {
        guard message.count > maxUserMessageCharacters else { return message }
        return String(message.prefix(maxUserMessageCharacters)) + "…"
    }

    /// Builds the grounding prompt for `stage`, folding the (truncated) owner message and the
    /// draft's current facts into that stage's template. At ``ConversationStage/done`` there is
    /// no stage left to ground, so the raw message passes through unchanged.
    public static func prompt(for stage: ConversationStage, draft: DesignInterviewDraft, userMessage: String) -> String {
        switch stage {
        case .intent: return intentPrompt(draft: draft, userMessage: userMessage)
        case .mood: return moodPrompt(draft: draft, userMessage: userMessage)
        case .brandAnchor: return brandAnchorPrompt(draft: draft, userMessage: userMessage)
        case .axisConfirmation: return axisConfirmationPrompt(draft: draft, userMessage: userMessage)
        case .done: return userMessage
        }
    }

    private static func intentPrompt(draft: DesignInterviewDraft, userMessage: String) -> String {
        let userMessage = truncatedUserMessage(userMessage)
        return """
        You are interviewing the owner of a \(draft.businessType) website about what the site is \
        for and who it's for. Ask one short, warm follow-up question to understand their intent — \
        don't move to visual style yet. Owner said: "\(userMessage)"
        """
    }

    private static func moodPrompt(draft: DesignInterviewDraft, userMessage: String) -> String {
        let userMessage = truncatedUserMessage(userMessage)
        return """
        You are helping the owner of a \(draft.businessType) website describe its visual mood. \
        Current design axes (each 0 to 1): temperature \(draft.axes.temperature) (cool<->warm), \
        weight \(draft.axes.weight) (airy<->dense), register \(draft.axes.register) \
        (playful<->authoritative), time \(draft.axes.time) (classic<->contemporary), voice \
        \(draft.axes.voice) (subtle<->bold). The owner described the mood they want as: \
        "\(userMessage)". In one short sentence, reflect back how that mood shifts these axes.
        """
    }

    private static func brandAnchorPrompt(draft: DesignInterviewDraft, userMessage: String) -> String {
        let userMessage = truncatedUserMessage(userMessage)
        return """
        Ask the owner of a \(draft.businessType) website if they have an existing brand color \
        (hex code) or a reference site/brand whose look they like. Owner said: "\(userMessage)". \
        If they gave a hex color or a clear reference, acknowledge it in one short sentence.
        """
    }

    private static func axisConfirmationPrompt(draft: DesignInterviewDraft, userMessage: String) -> String {
        let userMessage = truncatedUserMessage(userMessage)
        return """
        Summarize this design in plain language for the owner of a \(draft.businessType) website, \
        then ask them to confirm or adjust: temperature \(draft.axes.temperature), weight \
        \(draft.axes.weight), register \(draft.axes.register), time \(draft.axes.time), voice \
        \(draft.axes.voice). Owner's response: "\(userMessage)".
        """
    }
}
