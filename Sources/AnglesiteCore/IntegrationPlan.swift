/// The wizard's collected inputs: field key → value, with the chosen provider under the
/// reserved `"provider"` key. Deliberately stringly-typed — answers flow into ``Template``
/// token resolution and `.site-config` values, both strings end-to-end, so a richer type would
/// just be converted away at every boundary.
public typealias Answers = [String: String]

/// One concrete, condition-free write produced by lowering an ``Operation`` against the
/// answers. Everything is resolved to literal strings here, so a plan can be shown for review
/// and applied later without re-consulting the descriptor, the template, or the answers.
public enum PlannedStep: Sendable, Equatable {
    /// Write `contents` at `relativePath` under the site's `Source/` (from
    /// `copyFile`/`copyTemplatedFile`; templated contents are already resolved).
    case createFile(relativePath: String, contents: String)
    /// Set the given keys in `.site-config`, replacing any existing values.
    case upsertConfig([ConfigKV])
    /// Insert `snippet` at `anchor` in `relativeFile`, delimited under `id` so a re-run
    /// replaces the same block in place (`MarkerInjector`) instead of stacking duplicates.
    case injectAnchor(relativeFile: String, anchor: String, id: String, snippet: String, style: MarkerInjector.CommentStyle)
    /// Allow these domains in the site's generated Content-Security-Policy.
    case addCSP([String])
    /// Append `line` to `relativePath`, creating the file if needed. Duplicate detection
    /// already happened at plan time (``IntegrationError/duplicateLine(file:)``), so applying
    /// is a plain append.
    case appendLine(relativePath: String, line: String)
}

/// A fully resolved `.site-config` key/value pair — ``ConfigEntry`` after its value
/// ``Template`` has been resolved, so applying needs no further context.
public struct ConfigKV: Sendable, Equatable {
    /// The `.site-config` key.
    public let key: String
    /// The final literal value to write.
    public let value: String
    /// Pairs a resolved key and value.
    public init(key: String, value: String) { self.key = key; self.value = value }
}

/// A non-fatal, user-facing note attached to a plan (a fallback brand color, a not-green host,
/// …). The wizard's review step renders these; they never block applying the plan.
public struct PlanWarning: Sendable, Equatable {
    /// The user-facing warning text, already phrased for the site owner.
    public let message: String
    /// Wraps the warning text.
    public init(_ message: String) { self.message = message }
}

/// The reviewable unit of integration setup: every write that will happen, in order, plus any
/// warnings. Pure `Equatable` data so the wizard can show it before anything touches the site
/// and tests can assert on exact plans — the plan/apply split is what guarantees a reviewed
/// plan is applied verbatim.
public struct OperationPlan: Sendable, Equatable {
    /// Which integration this plan installs.
    public let integrationID: IntegrationID
    /// The concrete writes, in application order.
    public let steps: [PlannedStep]
    /// Non-fatal notes for the review step; never block applying.
    public let warnings: [PlanWarning]
    /// Memberwise initializer (also used to re-wrap a plan with extra warnings, as the
    /// greenHostCheck flow does).
    public init(integrationID: IntegrationID, steps: [PlannedStep], warnings: [PlanWarning]) {
        self.integrationID = integrationID; self.steps = steps; self.warnings = warnings
    }
    /// One plain-language line per step (plus one per warning) for the wizard's review screen —
    /// what will happen to the site, not the raw operation data.
    public var summary: String {
        var lines: [String] = []
        for step in steps {
            switch step {
            case .createFile(let path, _): lines.append("Create \(path)")
            case .upsertConfig(let kvs): lines.append("Set \(kvs.count) config key\(kvs.count == 1 ? "" : "s")")
            case .injectAnchor(let file, _, _, _, _): lines.append("Add a component to \(file)")
            case .addCSP(let domains): lines.append("Allow \(domains.count) domain\(domains.count == 1 ? "" : "s") in the site's security policy")
            case .appendLine(let path, _): lines.append("Append a line to \(path)")
            }
        }
        for w in warnings { lines.append("Warning: \(w.message)") }
        return lines.joined(separator: "\n")
    }
}

/// Why planning an integration failed. All validation happens at plan time so
/// ``IntegrationOperationsService/apply(_:siteID:)`` starts from a plan that already passed
/// every one of these checks.
public enum IntegrationError: Error, Equatable, Sendable {
    /// A required, currently *visible* field has no answer and no default — hidden fields are
    /// never required, so switching provider can't strand an invisible requirement.
    case missingRequiredField(key: String)
    /// An answer failed its ``FieldKind`` validation; `reason` is already user-facing.
    case invalidValue(key: String, reason: String)
    /// The `"provider"` answer names an id not in the descriptor's providers.
    case unknownProvider(String)
    /// The descriptor offers providers but no `"provider"` answer was given.
    case providerRequired
    /// The site id didn't resolve to a known site (e.g. it was removed from the recents
    /// registry since the wizard opened).
    case siteNotFound
    /// The website template root couldn't be resolved (`TemplateRuntime`), so there are no
    /// staged assets to copy from.
    case templateUnavailable
    /// A staged asset the descriptor copies is absent from the template — a hard error, since
    /// proceeding would inject an `import` for a file that was never written.
    case missingTemplateAsset(path: String)
    /// An `.appendLine` operation's resolved line already exists verbatim in the target file —
    /// e.g. reopening the redirects wizard with the same answers twice. Unlike `.copyFile`
    /// (idempotent by construction — same content in, same content out), `.appendLine`
    /// accumulates, so without this check a repeat run would duplicate the line.
    case duplicateLine(file: String)
    /// The site has never been deployed and has no known deploy host yet (`DeployCoordinator
    /// .resolveSiteURL` returned nil) — greenHostCheck needs a live host to query.
    case deployRequired
    /// An external API call an integration depends on during planning (greenHostCheck's TGWF
    /// lookup) failed — network failure or a non-2xx/unparseable response. The message is
    /// already user-facing, classified by the caller (e.g. `GreenHostChecker`).
    case externalCheckFailed(String)
}
