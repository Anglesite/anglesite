import Foundation

/// Pure dialog/summary strings shared by the content-help App Intents and GUI (#465), kept in
/// Core (pattern: `IntegrationDialogs`) so CI unit-tests them without the AppIntents runtime.
public enum ContentHelpDialogs {
    /// Result summary for a copy-review run. Zero findings is a distinct "all clear" sentence
    /// (not "found 0 suggestions"), and the skipped-pages tail only appears when something was
    /// actually skipped — Siri reads these aloud, so every clause has to earn its place.
    public static func copyReview(findingCount: Int, pageCount: Int, skippedCount: Int, siteName: String) -> String {
        var d: String
        if findingCount == 0 {
            d = "I found no copy issues across \(pageCount) page\(pageCount == 1 ? "" : "s") on \(siteName)."
        } else {
            d = "I found \(findingCount) copy suggestion\(findingCount == 1 ? "" : "s") across \(pageCount) page\(pageCount == 1 ? "" : "s") on \(siteName). Open Review Copy in Anglesite to apply them."
        }
        if skippedCount > 0 { d += " \(skippedCount) page\(skippedCount == 1 ? "" : "s") couldn't be reviewed." }
        return d
    }

    /// Fallback line for any content-help entry point when `ContentAssistantFactory` returns no
    /// backend. Parameterized on the feature name so one string serves every intent.
    public static func assistantUnavailable(feature: String) -> String {
        "\(feature) needs Apple Intelligence, which isn't available on this Mac right now."
    }

    /// Confirmation for a saved social-media plan. Names the on-disk destination
    /// (`docs/social-calendar.md`) so the owner can find the file outside the app — git is the
    /// source of truth, and the plan is theirs to edit anywhere.
    public static func socialPlanSaved(weeks: Int, siteName: String) -> String {
        "Saved a \(weeks)-week social media plan for \(siteName) to docs/social-calendar.md."
    }

    /// Summary for a repurpose-post run: platform drafts written, plus — only when nonzero — how
    /// many platforms couldn't fit their length limit, so a partial success reads as such rather
    /// than a silent one.
    public static func repurposeSummary(postTitle: String, platformCount: Int, failedCount: Int) -> String {
        var d = "Drafted \(platformCount) platform post\(platformCount == 1 ? "" : "s") for \"\(postTitle)\"."
        if failedCount > 0 { d += " \(failedCount) platform\(failedCount == 1 ? "" : "s") couldn't fit their length limit." }
        return d
    }
}
