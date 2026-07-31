/// One silently-appliable action from `TemplateScriptsSyncChecker` — no owner consent needed for
/// either case (design doc §Detection steps 1 and 4).
public enum TemplateScriptsSyncAction: Sendable, Equatable {
    /// The template has a file the site doesn't have yet (added since this site scaffolded).
    case create(relativePath: String)
    /// The site's file is unmodified since its last known-good baseline, and the template moved on.
    case refresh(relativePath: String)

    /// The affected file's template-relative path, regardless of case — both actions target
    /// exactly one path, so callers can group/sort a plan without switching.
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
    /// `Identifiable` via the path — at most one divergence per file per check pass, and stable
    /// ids keep the divergence sheet's SwiftUI rows from resetting between passes.
    public var id: String { relativePath }
    /// The divergent file's template-relative path.
    public let relativePath: String
    /// Hash of the template's current content — recorded so a "keep my version" decision can
    /// remember exactly which template revision was declined (and re-ask only when it changes).
    public let templateHash: String

    /// Creates a divergence record; normally only `TemplateScriptsSyncChecker` does.
    public init(relativePath: String, templateHash: String) {
        self.relativePath = relativePath
        self.templateHash = templateHash
    }
}

/// The full result of one `TemplateScriptsSyncChecker.check` pass.
public struct TemplateScriptsSyncPlan: Sendable, Equatable {
    /// Actions safe to apply silently, immediately, without asking the owner — the app knows the
    /// right answer for these (#1053).
    public let toApply: [TemplateScriptsSyncAction]
    /// Files needing an owner decision — each is surfaced through the divergence UX, never
    /// auto-resolved.
    public let divergences: [TemplateScriptsDivergence]

    /// Creates a plan; the all-empty default is the nothing-to-do result.
    public init(toApply: [TemplateScriptsSyncAction] = [], divergences: [TemplateScriptsDivergence] = []) {
        self.toApply = toApply
        self.divergences = divergences
    }
}
