import Foundation

/// Pure, non-gated helpers for the FM tool, so the parse/reply logic is unit-testable on CI.
public enum SetupIntegrationArguments {
    /// Parses the model's `key=value,key=value` config string into ``Answers``. Lenient by
    /// design — malformed pairs are skipped rather than failing the call, because the planning
    /// layer already reports missing/invalid fields with a better, user-facing message.
    public static func parseConfig(_ raw: String?) -> Answers {
        guard let raw, !raw.isEmpty else { return [:] }
        var out: Answers = [:]
        for pair in raw.split(separator: ",") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2 else { continue }
            out[kv[0].trimmingCharacters(in: .whitespaces)] = kv[1].trimmingCharacters(in: .whitespaces)
        }
        return out
    }

    /// Maps the model's free-text integration type onto a known `IntegrationID`, or `nil` for
    /// anything unrecognized — the tool answers that with the menu of valid options instead of
    /// guessing.
    public static func id(for type: String) -> IntegrationID? { IntegrationID(rawValue: type) }

    /// Turn a plan result into a chat reply: re-prompt on missing field, else a confirm-before-apply summary.
    /// Appends a hint instructing the model to call again with `apply: true` once the user confirms.
    public static func reply(for result: Result<OperationPlan, IntegrationError>,
                             descriptor: IntegrationDescriptor) -> String {
        switch result {
        case .success(let plan):
            return "Here's what I'll set up:\n\(plan.summary)\n\nConfirm to apply, or tell me what to change. When the user confirms, call this tool again with apply: true."
        case .failure(.missingRequiredField(let key)):
            let label = descriptor.fields.first { $0.key == key }?.label ?? key
            return "I need the \(label) to continue."
        case .failure(.providerRequired):
            let names = descriptor.providers.map(\.displayName).joined(separator: ", ")
            return "Which provider would you like? Options: \(names)."
        case .failure(.unknownProvider(let p)):
            return "I don't recognize the provider \"\(p)\"."
        case .failure(.invalidValue(let key, let reason)):
            let label = descriptor.fields.first { $0.key == key }?.label ?? key
            return "The \(label) looks off — \(reason)."
        case .failure(.siteNotFound):
            return "I couldn't find that site."
        case .failure(.templateUnavailable):
            return "The site template isn't available right now."
        case .failure(.missingTemplateAsset):
            // The missing path is carried on the error value for logging; keep the user-facing
            // message generic, matching `.templateUnavailable` (this is a packaging failure, not
            // actionable user input).
            return "The site template is incomplete — a required component is missing. Please reinstall Anglesite."
        case .failure(.duplicateLine):
            return "That's already there — nothing to add."
        case .failure(.deployRequired):
            return "This site hasn't been deployed yet, so there's no host to check. Deploy it first, then try again."
        case .failure(.externalCheckFailed(let message)):
            return message
        }
    }

    /// Map the terminal apply step to a short user-facing string.
    public static func applyReply(for step: IntegrationScaffolder.SetupStep) -> String {
        switch step {
        case .done(let id): return "Set up \(id)."
        case .failed(_, let message): return "Setup failed: \(message)."
        default: return "Setup finished."
        }
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Chat front-door for the integration wizard. Plans first, applies only on a second call with
/// `apply: true` — the plan/confirm/apply split keeps a single model call from mutating the
/// site before the owner has said yes.
public struct SetupIntegrationTool: Tool, Sendable {
    /// Stable wire name, kept as a static so registration/telemetry sites can reference it
    /// without constructing the tool.
    public static let toolName = "setupIntegration"
    /// `Tool` conformance: the name the model calls this tool by.
    public let name = SetupIntegrationTool.toolName
    /// `Tool` conformance: model-facing usage guidance, including the confirm-before-apply
    /// contract.
    public let description = "Set up a website integration (booking, contact form, donations, giscus comments, or newsletter). Returns a plan to confirm before applying."

    /// Model-generated arguments; the `@Guide` text is what steers the model, this is just
    /// its shape.
    @Generable
    public struct Arguments {
        /// Which integration to add, matched against `IntegrationID` raw values.
        @Guide(description: "Integration to add: 'booking', 'contact', 'donations', 'giscus', or 'newsletter'.")
        public var integrationType: String
        /// Provider id for integrations offering a choice; merged into the answers under the
        /// `"provider"` key.
        @Guide(description: "Provider id when the integration needs one (e.g. 'cal', 'calendly', 'stripe').")
        public var provider: String?
        /// Field values as comma-separated `key=value` pairs, parsed leniently by
        /// `SetupIntegrationArguments.parseConfig`.
        @Guide(description: "Field values as key=value pairs, comma-separated (e.g. 'username=jane,style=inline').")
        public var config: String?
        /// The confirm-before-apply gate: `true` only after the owner has confirmed the plan;
        /// anything else re-plans without touching the site.
        @Guide(description: "Set to true ONLY after the user has confirmed they want these changes applied.")
        public var apply: Bool?
    }

    private let service: any IntegrationOperationsService
    private let siteID: String
    /// Creates the tool over the injected operations service (the seam tests fake) for one site.
    public init(service: any IntegrationOperationsService, siteID: String) {
        self.service = service; self.siteID = siteID
    }

    /// Plans the integration and replies with a confirm-before-apply summary; applies only when
    /// `apply == true`. Re-planning before every apply is deliberate — the plan is recomputed
    /// from the latest answers, so a stale earlier plan can never be the one applied. Failures
    /// are conversational strings (re-prompts), not thrown errors.
    public func call(arguments: Arguments) async throws -> String {
        guard let id = SetupIntegrationArguments.id(for: arguments.integrationType) else {
            return "I can set up booking, a contact form, donations, giscus comments, or a newsletter. Which one?"
        }
        var answers = SetupIntegrationArguments.parseConfig(arguments.config)
        if let p = arguments.provider { answers["provider"] = p }
        let descriptor = IntegrationCatalog.descriptor(for: id)
        let result = await service.plan(integrationID: id, answers: answers, siteID: siteID)
        guard case .success(let plan) = result else {
            return SetupIntegrationArguments.reply(for: result, descriptor: descriptor)
        }
        if arguments.apply == true {
            let terminal = await service.apply(plan, siteID: siteID)
            return SetupIntegrationArguments.applyReply(for: terminal)
        }
        return SetupIntegrationArguments.reply(for: .success(plan), descriptor: descriptor)
    }
}
#endif
