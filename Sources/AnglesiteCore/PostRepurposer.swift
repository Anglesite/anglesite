import Foundation

/// One platform's repurposed post: `text` on success, `failure` (user-facing) when the model
/// couldn't satisfy the platform's hard limit after a retry — never silently truncated.
public struct PlatformPostVariant: Sendable, Equatable {
    /// The target platform, matching the ``PlatformPostSpec/platform`` it was generated for.
    public let platform: String
    /// The generated post text, or `nil` when generation failed — see ``failure``.
    public let text: String?
    /// User-facing explanation when ``text`` is `nil`; shown on the post card in place of a
    /// truncated or empty result.
    public let failure: String?

    /// Memberwise initializer. Callers set exactly one of `text`/`failure`.
    public init(platform: String, text: String?, failure: String?) {
        self.platform = platform
        self.text = text
        self.failure = failure
    }
}

/// Pure prompt builder for one platform variant — non-gated for CI tests.
public enum RepurposePrompt {
    /// Assembles the generation prompt from the spec's constraints (limit, URL policy,
    /// hashtags, style) plus the post's title/summary/body. `preamble` is the site's optional
    /// brand-voice guidance, prepended so it frames the whole request; nil just drops the
    /// section.
    public static func build(post: PostSource, postURL: String, spec: PlatformPostSpec,
                             preamble: String?) -> String {
        var rules: [String] = []
        rules.append("Hard limit: \(spec.charLimit) characters total — shorter is better.")
        rules.append(spec.includesURL
            ? "End with the post's link: \(postURL)"
            : "Do not include any URL (\(spec.platform) strips links); say 'link in bio' instead.")
        rules.append(spec.allowsHashtags
            ? "A few relevant hashtags are welcome."
            : "No hashtags.")
        rules.append("Style: \(spec.styleHint).")
        let sections = [
            preamble,
            """
            Write a \(spec.platform) post that shares this blog post with the owner's followers.
            \(rules.joined(separator: "\n"))

            Blog post title: \(post.title)
            \(post.description.map { "Summary: \($0)" } ?? "")
            Blog post text:
            \(post.body)
            """,
        ]
        return sections.compactMap { $0 }.joined(separator: "\n\n")
    }
}

/// Seam between the repurpose UI and the model backend, so the UI compiles and tests without
/// FoundationModels (which is toolchain- and platform-gated below).
public protocol PostRepurposing: Sendable {
    /// Generates one variant per spec, in order. Non-throwing by contract: a failed platform
    /// comes back as a ``PlatformPostVariant`` with ``PlatformPostVariant/failure`` set, so one
    /// bad generation never hides the others' results. `siteID`/`siteDirectory` scope the
    /// assistant's context to the site being worked on.
    func variants(post: PostSource, postURL: String, specs: [PlatformPostSpec], preamble: String?,
                  siteID: String, siteDirectory: URL) async -> [PlatformPostVariant]
}

/// Builds the production ``PostRepurposing`` backend, hiding the compiler/platform gate from
/// callers.
public enum PostRepurposerFactory {
    /// The FoundationModels-backed `FoundationModelPostRepurposer` on an Xcode-27+ toolchain
    /// where the framework imports, else `nil` — callers treat `nil` as "repurposing
    /// unavailable" rather than compiling their own gate.
    public static func makeDefault() -> (any PostRepurposing)? {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return FoundationModelPostRepurposer()
        #else
        return nil
        #endif
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// The production `PostRepurposing` backend: on-device/PCC generation via `ContentAssistant`,
/// with the char-limit validation and retry loop implemented in Swift (spec §5.3) — the model
/// is never trusted to respect a platform's hard limit on its own.
public struct FoundationModelPostRepurposer: PostRepurposing {
    /// Stateless — the assistant session is created per `variants` call, not held here.
    public init() {}

    /// Generates the variants serially (one shared assistant context) rather than in parallel;
    /// if the assistant tier is unavailable, every spec gets the same user-facing
    /// "unavailable" failure rather than an error.
    public func variants(post: PostSource, postURL: String, specs: [PlatformPostSpec], preamble: String?,
                         siteID: String, siteDirectory: URL) async -> [PlatformPostVariant] {
        guard let assistant = ContentAssistantFactory.make(tier: .privateCloudCompute) else {
            return specs.map { PlatformPostVariant(
                platform: $0.platform, text: nil,
                failure: ContentHelpDialogs.assistantUnavailable(feature: "Repurposing")) }
        }
        let context = AssistantContext(siteID: siteID, siteDirectory: siteDirectory)
        var out: [PlatformPostVariant] = []
        for spec in specs {
            out.append(await variant(for: spec, post: post, postURL: postURL, preamble: preamble,
                                     assistant: assistant, context: context))
        }
        return out
    }

    /// Spec §5.3: validate in Swift → one retry with the measured overshoot → fail with a message.
    private func variant(for spec: PlatformPostSpec, post: PostSource, postURL: String,
                         preamble: String?, assistant: any ContentAssistant,
                         context: AssistantContext) async -> PlatformPostVariant {
        let prompt = RepurposePrompt.build(post: post, postURL: postURL, spec: spec, preamble: preamble)
        let first: GeneratedPlatformPost
        do {
            first = try await assistant.generateStructured(
                prompt: prompt, context: context, resultType: GeneratedPlatformPost.self)
        } catch AssistantError.unavailable(let message) {
            let unavailableMessage = message.isEmpty
                ? ContentHelpDialogs.assistantUnavailable(feature: "Repurposing")
                : message
            return PlatformPostVariant(platform: spec.platform, text: nil, failure: unavailableMessage)
        } catch {
            return PlatformPostVariant(platform: spec.platform, text: nil,
                                       failure: "Couldn't generate a \(spec.platform) post.")
        }
        // `fits` alone would accept an empty string (0 <= charLimit) as a successful variant —
        // treat empty/whitespace-only text the same as an over-limit result: one retry, then an
        // explicit failure rather than an empty post card.
        let firstEmpty = first.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if !firstEmpty, RepurposePlatformSpecs.fits(first.text, spec: spec) {
            return PlatformPostVariant(platform: spec.platform, text: first.text, failure: nil)
        }
        let retryPrompt = firstEmpty
            ? prompt + "\n\nYour previous attempt was empty. Write the post's full text."
            : prompt + "\n\nYour previous attempt was \(first.text.count) characters — over the \(spec.charLimit)-character limit. Rewrite it well under \(spec.charLimit) characters."
        if let second = try? await assistant.generateStructured(
            prompt: retryPrompt, context: context, resultType: GeneratedPlatformPost.self),
           !second.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           RepurposePlatformSpecs.fits(second.text, spec: spec) {
            return PlatformPostVariant(platform: spec.platform, text: second.text, failure: nil)
        }
        return PlatformPostVariant(platform: spec.platform, text: nil,
                                   failure: firstEmpty
                                       ? "Couldn't generate a \(spec.platform) post."
                                       : "Couldn't fit \(spec.platform)'s \(spec.charLimit)-character limit.")
    }
}
#endif
