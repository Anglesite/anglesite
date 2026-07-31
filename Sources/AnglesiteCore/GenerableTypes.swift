import Foundation

// `FoundationModels` ships in the macOS 26 SDK but is absent from GitHub's `macos-15`
// runner at *runtime* — linking it into the package makes the whole test bundle fail to
// `dlopen`. Gate it behind the Xcode-27 toolchain (Swift 6.4) so CI on Xcode 26.3 builds
// without it, while production (always Xcode 27) gets these types. Also gate on canImport
// for genuine off-Darwin portability (cross-platform port design §5). See #128 and
// ContentAssistant.swift for the same pattern.
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// The kind of mutation a ``GeneratedEditCommand`` performs. The cases correspond 1:1 to
/// `EditMessage.Op` (see `EditMessage.swift`) — the operation vocabulary of the app's edit
/// pipeline (string forms `replace-text`, `replace-attr`, `replace-image-src`,
/// `apply-instruction`) — so a generated command maps onto a real edit without re-deriving the op.
///
/// - Note: This enum carries no `rawValue`; the case→string-constant bridge lives with the
///   consumer. TODO(#156): `ApplyEditTool` maps these onto `EditMessage.Op` when it lands.
@Generable
public enum EditOperation: Equatable, Sendable {
    /// Set the element's text content (`"replace-text"`).
    case replaceText
    /// Set an attribute such as `href` or `alt` (`"replace-attr"`).
    case replaceAttr
    /// Swap an image source (`"replace-image-src"`).
    case replaceImageSrc
    /// Forward a natural-language edit to the plugin to resolve (`"apply-instruction"`).
    case applyInstruction
}

/// A structured edit the on-device model proposes for a single element. Consumed by the
/// (future) `ApplyEditTool` (#156); `selector` matches the overlay/`IntentEditBridge` selector form.
@Generable
public struct GeneratedEditCommand: Equatable, Sendable {
    /// Site-root-relative path of the source file to edit (e.g. `src/pages/about.md`).
    @Guide(description: "Path to the source file to edit, relative to the site root, e.g. 'src/pages/about.md'.")
    public var filePath: String

    /// CSS selector identifying the target element, in the same form the edit overlay and
    /// `IntentEditBridge` use — so the generated command plugs into the existing edit pipeline
    /// without translation.
    @Guide(description: "CSS selector or element reference identifying what to edit, e.g. 'h1' or 'p:nth-of-type(2)'.")
    public var selector: String

    /// Which kind of mutation to perform; determines how ``value`` is interpreted.
    @Guide(description: "The kind of edit: replaceText sets element text, replaceAttr sets an attribute, replaceImageSrc swaps an image source, applyInstruction forwards a natural-language change to the plugin.")
    public var operation: EditOperation

    /// The edit's payload, interpreted per ``operation``: replacement text, attribute value,
    /// image source, or a natural-language instruction.
    @Guide(description: "The replacement text, attribute value, image source, or natural-language instruction to apply, appropriate to the operation.")
    public var value: String

    /// One-sentence rationale surfaced to the user *before* the edit applies — generated edits
    /// are confirm-first, never silently applied.
    @Guide(description: "One short sentence explaining the change, shown to the user before they confirm it.")
    public var explanation: String
}

/// SEO/page metadata generated for a page from its content. Consumed by `new-page` flows and #157.
@Generable
public struct GeneratedPageMeta: Equatable, Sendable {
    /// Page title, targeted under 60 characters so search results don't truncate it.
    @Guide(description: "A concise, descriptive page title under 60 characters.")
    public var title: String

    /// Meta description, targeted at 150–160 characters — the length search engines display in
    /// full.
    @Guide(description: "A meta description summarizing the page in 150-160 characters.")
    public var description: String

    /// URL slug in lowercase kebab-case. Model output is a *suggestion*; callers remain
    /// responsible for filesystem/route validity.
    @Guide(description: "A URL-safe slug in lowercase kebab-case, e.g. 'about-our-team'.")
    public var slug: String

    /// Lowercase topic tags (three to six) for the page's frontmatter.
    @Guide(description: "Three to six lowercase topic tags describing the page.")
    public var tags: [String]
}

/// Alt text generated for an image, plus whether the image is purely decorative.
@Generable
public struct GeneratedAltText: Equatable, Sendable {
    /// Descriptive alt text, targeted under 125 characters. Empty when ``isDecorative`` is
    /// `true` — an empty `alt=""` is the accessibility-correct markup for decorative images,
    /// not missing data.
    @Guide(description: "Descriptive alt text under 125 characters. Use an empty string when the image is decorative (and set isDecorative to true).")
    public var altText: String

    /// Whether the image is purely decorative. Carried as an explicit flag so callers can
    /// distinguish "deliberately empty alt" from a generation that produced nothing.
    @Guide(description: "True if the image is purely decorative and should have empty alt text.")
    public var isDecorative: Bool
}

/// A summary of a piece of content with reading metadata.
@Generable
public struct ContentSummary: Equatable, Sendable {
    /// Two-to-three sentence prose summary of the content.
    @Guide(description: "A two-to-three sentence summary of the content.")
    public var summary: String

    /// Approximate word count as estimated by the model — display-grade, not an exact count.
    @Guide(description: "Approximate word count of the source content.")
    public var wordCount: Int

    /// Estimated reading time in whole minutes, at the conventional ~200 words per minute.
    @Guide(description: "Estimated reading time in whole minutes (assume ~200 words per minute).")
    public var readingTimeMinutes: Int

    /// Three to five key topics, as short phrases.
    @Guide(description: "Three to five key topics covered, as short phrases.")
    public var topics: [String]
}

/// What kind of page a piece of content is. Drives layout/metadata defaults.
@Generable
public enum ContentClassification: Equatable, Sendable {
    /// A dated article-style post (blog collection defaults).
    case blogPost
    /// A marketing/conversion page (hero-first layout defaults).
    case landingPage
    /// Reference or how-to material (docs layout defaults).
    case documentation
    /// A work-showcase page (gallery/project layout defaults).
    case portfolio
    /// Anything the model couldn't place in the fixed cases; the payload is its free-text
    /// label, so an unanticipated content kind is surfaced rather than force-fitted.
    case other(String)
}

/// On-device guided-generation result for a failed deploy. Mapped to the non-gated
/// `DeployFailureSummary` before it crosses the FoundationModels gate.
@Generable
public struct GeneratedDeployFailureSummary: Equatable, Sendable {
    /// One or two plain-language sentences on what went wrong — written for the site owner,
    /// not a developer reading build logs.
    @Guide(description: "One or two plain-language sentences explaining what went wrong with the deploy.")
    public var summary: String

    /// The single most likely root cause, in one sentence.
    @Guide(description: "The single most likely root cause of the failure, in one sentence.")
    public var likelyCause: String

    /// A concrete next step the owner can take; empty when none is clear (empty-string rather
    /// than optional, because guided generation requires every field be produced).
    @Guide(description: "A concrete next step the site owner can take to fix it. Empty string if none is clear.")
    public var suggestedFix: String
}

/// On-device guided-generation result for a new page/post's short copy. Mapped to the
/// non-gated `PageCopySuggestion` before it crosses the FoundationModels gate.
@Generable
public struct GeneratedPageCopySuggestion: Equatable, Sendable {
    /// One SEO meta-description sentence, under 160 characters and deliberately not a verbatim
    /// echo of the page title (a repeated title wastes the search-snippet slot).
    @Guide(description: "A single concise SEO meta description sentence, under 160 characters, that does not repeat the title verbatim.")
    public var description: String
}

/// On-device guided-generation result for the throttled project-conventions enrichment pass
/// (tone/brand-term fields the deterministic extractor can't compute from text alone).
@Generable
public struct GeneratedProjectConventions: Equatable, Sendable {
    /// Three to five adjectives describing the site's writing tone — the judgment call a
    /// deterministic text scan can't make.
    @Guide(description: "Three to five adjectives describing this site's writing tone, e.g. ['concise', 'playful', 'technical'].")
    public var toneDescriptors: [String]

    /// Up to five brand/product terms with their canonical capitalization as actually used in
    /// the site's text, so later generation preserves the owner's spelling.
    @Guide(description: "Up to five brand or product terms with their canonical capitalization as used in the text, e.g. ['Anglesite', 'Astro'].")
    public var brandTerms: [String]
}

/// On-device guided-generation result for a single copy-edit checklist finding (#465). Mapped to
/// the non-gated `CopyFindingDraft` before it crosses the FoundationModels gate.
@Generable
public struct GeneratedCopyFinding: Equatable, Sendable {
    /// Checklist category token (`clarity`, `benefits`, `voice`, `cta`, `scannability`,
    /// `reader-focus`, `jargon`, `social-proof`, `missing-info`, or `mobile`). Kept as a string
    /// rather than an enum so an off-vocabulary answer degrades to display text instead of a
    /// decode failure.
    @Guide(description: "Checklist category: clarity, benefits, voice, cta, scannability, reader-focus, jargon, social-proof, missing-info, or mobile.")
    public var category: String
    /// Severity token: `high`, `medium`, or `low`.
    @Guide(description: "Severity: high, medium, or low.")
    public var severity: String
    /// Verbatim excerpt of the problematic copy — exact characters matter, because the finding
    /// is verified by substring-matching this against the page text (a paraphrased excerpt is
    /// discarded as a hallucination) and `CopyRewriteApplier` locates the copy by the same match.
    @Guide(description: "Short excerpt of the problematic copy, quoted verbatim from the page text — exact characters, no paraphrase.")
    public var excerpt: String
    /// One plain-language sentence describing what's wrong.
    @Guide(description: "One-sentence plain-language description of the issue.")
    public var issue: String
    /// Suggested replacement copy, written in the site's own voice.
    @Guide(description: "Suggested replacement copy in the site's voice.")
    public var suggestedRewrite: String
}

/// On-device guided-generation result for a whole page's copy-edit audit (#465): up to 5
/// highest-impact findings, per `CopyEditPrompt`.
@Generable
public struct GeneratedPageCopyFindings: Equatable, Sendable {
    /// Up to 5 highest-impact findings; empty means the copy is strong — a valid answer, not a
    /// failed generation.
    @Guide(description: "Up to 5 highest-impact findings for this page. Empty when the copy is strong.")
    public var findings: [GeneratedCopyFinding]
}

/// On-device guided-generation result for a single social platform bio (#465). Mapped to
/// `SocialMediaPlan.bios` before it crosses the FoundationModels gate.
@Generable
public struct GeneratedSocialBio: Equatable, Sendable {
    /// The profile bio text. The platform's character limit is stated in the prompt, but not
    /// trusted: length enforcement stays in Swift, like every other char-limit policy in the
    /// social pipeline.
    @Guide(description: "The profile bio text, within the stated character limit. No hashtags unless the platform calls for them.")
    public var bio: String
}

/// On-device guided-generation result for a single social content pillar (#465). Mapped to
/// the non-gated `SocialPillar` before it crosses the FoundationModels gate.
@Generable
public struct GeneratedSocialPillar: Equatable, Sendable {
    /// Short pillar name (e.g. "Behind the scenes") — later calendar entries reference pillars
    /// by this name, so it doubles as the pillar's identifier within a plan.
    @Guide(description: "Short pillar name, e.g. 'Behind the scenes'.")
    public var name: String
    /// One sentence on what the pillar covers and why followers care.
    @Guide(description: "One sentence on what this pillar covers and why followers care.")
    public var detail: String
}

/// On-device guided-generation result for the full set of social content pillars (#465).
@Generable
public struct GeneratedSocialPillars: Equatable, Sendable {
    /// The 3–5 pillars, balanced roughly 80% value/story to 20% promotional — the strategy
    /// ratio the social-media skill prescribes.
    @Guide(description: "3 to 5 content pillars. Roughly 80% value/story content, 20% promotional.")
    public var pillars: [GeneratedSocialPillar]
}

/// On-device guided-generation result for a single social calendar entry (#465). Mapped to
/// the non-gated `SocialCalendarEntry` before it crosses the FoundationModels gate.
@Generable
public struct GeneratedSocialWeekEntry: Equatable, Sendable {
    /// Day-of-week label (e.g. "Monday").
    @Guide(description: "Day of week, e.g. 'Monday'.")
    public var day: String
    /// Platform name, echoed exactly as the prompt supplied it so the entry joins back to the
    /// owner's chosen platform list without fuzzy matching.
    @Guide(description: "Platform name, exactly as given in the prompt.")
    public var platform: String
    /// Pillar name, echoed exactly as the prompt supplied it (see ``GeneratedSocialPillar/name``).
    @Guide(description: "Pillar name, exactly as given in the prompt.")
    public var pillar: String
    /// One concrete, shootable/writable post idea for that day.
    @Guide(description: "One concrete post idea the owner could shoot/write that day.")
    public var idea: String
}

/// On-device guided-generation result for one week's social calendar (#465), one call per week
/// (chunk-first — see `SocialPlanPrompt`).
@Generable
public struct GeneratedSocialWeek: Equatable, Sendable {
    /// The week's post schedule, respecting each platform's posts-per-week cadence from the
    /// prompt.
    @Guide(description: "The week's post schedule, respecting each platform's posts-per-week cadence.")
    public var entries: [GeneratedSocialWeekEntry]
}

/// On-device guided-generation result for one platform's repurposed blog-post copy (#465).
/// Mapped to the non-gated `PlatformPostVariant` before it crosses the FoundationModels gate;
/// the char-limit policy (spec §5.3) is enforced in Swift, never trusted to the model.
@Generable
public struct GeneratedPlatformPost: Equatable, Sendable {
    /// The complete, copy-paste-ready post text. The character limit lives in the prompt as a
    /// request only — the Swift side re-checks length and retries/omits rather than truncating
    /// (see the type-level note).
    @Guide(description: "The complete post text for the platform, within the stated character limit, ready to copy-paste.")
    public var text: String
}
#endif
