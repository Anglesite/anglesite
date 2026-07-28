/// One silently-appliable action from `TemplateScriptsSyncChecker` — no owner consent needed for
/// either case (design doc §Detection steps 1 and 4).
public enum TemplateScriptsSyncAction: Sendable, Equatable {
    /// The template has a file the site doesn't have yet (added since this site scaffolded).
    case create(relativePath: String)
    /// The site's file is unmodified since its last known-good baseline, and the template moved on.
    case refresh(relativePath: String)

    public var relativePath: String {
        switch self {
        case .create(let path), .refresh(let path): return path
        }
    }
}

/// A `scripts/` file the owner has customized, where the template has also moved on past the
/// content the owner customized from — the one case this mechanism can't silently resolve
/// (design doc §Divergence UX).
public struct TemplateScriptsDivergence: Sendable, Equatable, Identifiable {
    public var id: String { relativePath }
    public let relativePath: String
    public let templateHash: String

    public init(relativePath: String, templateHash: String) {
        self.relativePath = relativePath
        self.templateHash = templateHash
    }
}

/// The full result of one `TemplateScriptsSyncChecker.check` pass.
public struct TemplateScriptsSyncPlan: Sendable, Equatable {
    public let toApply: [TemplateScriptsSyncAction]
    public let divergences: [TemplateScriptsDivergence]

    public init(toApply: [TemplateScriptsSyncAction] = [], divergences: [TemplateScriptsDivergence] = []) {
        self.toApply = toApply
        self.divergences = divergences
    }
}
