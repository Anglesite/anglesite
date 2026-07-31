import Foundation

/// A lean, test-enforced description of a Siri-facing Anglesite operation. Captures only what the
/// auto-derived system-MCP schema (`mcpbridge`) cannot express — side-effect level, confirmation,
/// cancellability, and a human-readable result label — so Siri, Shortcuts, and system MCP stay
/// consistent with the real intents without re-declaring parameters (those flow from `@Parameter` /
/// `@Property` via D.2). Spec: docs/superpowers/specs/2026-06-19-operation-descriptors-design.md.
public struct OperationDescriptor: Sendable, Equatable {
    /// Stable slug, e.g. "deploy-site". Unique across the registry.
    public let operationID: String
    /// Human-facing name; matches the intent's `title`, e.g. "Deploy Site".
    public let displayName: String
    /// The intent's Swift type name, e.g. "DeploySiteIntent". The coverage-anchor key; unique.
    public let intentTypeName: String
    /// How far the operation's writes reach — the axis confirmation and risk decisions key off.
    public let sideEffect: OperationSideEffect
    /// Whether the intent gates on a user confirmation before running. Declared here so tests can
    /// enforce that risky operations (deploy, DNS mutations) never silently drop their prompt.
    public let requiresConfirmation: Bool
    /// Whether a running invocation can be cancelled from the system UI. Mirrors the intent's
    /// `CancellableIntent` adoption, which the auto-derived schema can't express.
    public let isCancellable: Bool
    /// The shape of the value the intent returns, so agents know what they can chain into.
    public let resultShape: OperationResult
    /// The `mcpbridge`-assigned tool name, once Apple's naming convention is pinned (D.5/#166).
    /// `nil` for all current entries — forward-looking, not asserted by any test.
    public let mcpToolName: String?

    /// Memberwise initializer. Every field except `mcpToolName` is required so a new registry
    /// entry can't accidentally omit the metadata the coverage tests assert on.
    public init(
        operationID: String,
        displayName: String,
        intentTypeName: String,
        sideEffect: OperationSideEffect,
        requiresConfirmation: Bool,
        isCancellable: Bool,
        resultShape: OperationResult,
        mcpToolName: String? = nil
    ) {
        self.operationID = operationID
        self.displayName = displayName
        self.intentTypeName = intentTypeName
        self.sideEffect = sideEffect
        self.requiresConfirmation = requiresConfirmation
        self.isCancellable = isCancellable
        self.resultShape = resultShape
        self.mcpToolName = mcpToolName
    }
}

/// An operation's write reach — what drives confirmation and risk decisions. Operations that read
/// or spawn subprocesses but persist nothing to the site or its repository (audit, preview, status,
/// search) are `.readOnly`.
public enum OperationSideEffect: Sendable, Equatable {
    /// No persisted writes to the site or its repository.
    case readOnly
    /// Adds a new artifact without altering existing site source — a new page/post, or a backup
    /// commit/snapshot pushed to a draft branch. Additive and reversible.
    case createsContent
    /// Alters existing site source in place (edit).
    case modifiesContent
    /// Pushes the site outward to production (deploy).
    case publishes
}

/// The shape an agent gets back. The associated string is the entity type name.
public enum OperationResult: Sendable, Equatable {
    /// The operation returns only a dialog — nothing an agent can chain into a follow-up.
    case none
    /// A single entity of the named type (e.g. `"SiteEntity"`), chainable into another intent.
    case entity(String)
    /// A list of entities of the named type — search/find operations that fan out.
    case entities(String)
}

/// The canonical registry — the single source of truth for Siri-facing operation metadata.
public enum AnglesiteOperations {
    /// Every registered descriptor, one per Siri-facing intent. Coverage tests diff this list
    /// against the real intent types, so adding an intent without a descriptor (or vice versa)
    /// fails fast rather than shipping an operation the system MCP schema misrepresents.
    public static let all: [OperationDescriptor] = [
        OperationDescriptor(
            operationID: "deploy-site", displayName: "Deploy Site",
            intentTypeName: "DeploySiteIntent", sideEffect: .publishes,
            requiresConfirmation: true, isCancellable: true,
            resultShape: .entity("SiteEntity")
        ),
        OperationDescriptor(
            // `.createsContent`: backup is `git add -A` → commit → push to a draft branch — it
            // snapshots the working tree outward, it does not alter existing site source in place.
            operationID: "backup-site", displayName: "Back Up Site",
            intentTypeName: "BackupSiteIntent", sideEffect: .createsContent,
            requiresConfirmation: false, isCancellable: true,
            resultShape: .entity("SiteEntity")
        ),
        OperationDescriptor(
            operationID: "audit-site", displayName: "Check Site",
            intentTypeName: "AuditSiteIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: true,
            resultShape: .entity("SiteEntity")
        ),
        OperationDescriptor(
            operationID: "open-site", displayName: "Open Site",
            intentTypeName: "OpenSiteIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "search-content", displayName: "Search Site Content",
            intentTypeName: "SearchContentIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .entities("ContentMatchEntity")
        ),
        OperationDescriptor(
            operationID: "site-status", displayName: "Site Content Status",
            intentTypeName: "SiteStatusIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "find-content-by-type", displayName: "Find Content by Type",
            intentTypeName: "FindContentByTypeIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .entities("PostEntity")
        ),
        OperationDescriptor(
            operationID: "preview-site", displayName: "Preview Site",
            intentTypeName: "PreviewSiteIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            // `.readOnly`: like `preview-site`, this only opens/focuses the app to a conversation
            // surface — it persists nothing itself. The interview's eventual `confirmAndApply()`
            // write happens later, inside the GUI panel, not as part of this intent.
            operationID: "start-design-interview", displayName: "Start Design Interview",
            intentTypeName: "StartDesignInterviewIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "add-page", displayName: "Add Page",
            intentTypeName: "AddPageIntent", sideEffect: .createsContent,
            requiresConfirmation: false, isCancellable: true,
            resultShape: .entity("PageEntity")
        ),
        OperationDescriptor(
            operationID: "add-post", displayName: "Add Post",
            intentTypeName: "AddPostIntent", sideEffect: .createsContent,
            requiresConfirmation: false, isCancellable: true,
            resultShape: .entity("PostEntity")
        ),
        OperationDescriptor(
            // TODO(#239/#250): flip `requiresConfirmation` to true when the EditContentIntent
            // confirmation gate lands. Whichever of this PR and #250 merges second must update
            // this line and the `declaredFields` value table — the test passes on stale data.
            operationID: "edit-content", displayName: "Edit Content",
            intentTypeName: "EditContentIntent", sideEffect: .modifiesContent,
            requiresConfirmation: false, isCancellable: true,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "add-booking", displayName: "Add Booking",
            intentTypeName: "AddBookingIntent", sideEffect: .createsContent,
            requiresConfirmation: true, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "add-donations", displayName: "Add Donations",
            intentTypeName: "AddDonationsIntent", sideEffect: .createsContent,
            requiresConfirmation: true, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "add-comments", displayName: "Add Comments",
            intentTypeName: "AddGiscusIntent", sideEffect: .createsContent,
            requiresConfirmation: true, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "list-dns-records", displayName: "List DNS Records",
            intentTypeName: "ListDNSRecordsIntent", sideEffect: .readOnly,
            requiresConfirmation: false, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "add-dns-record", displayName: "Add DNS Record",
            intentTypeName: "AddDNSRecordIntent", sideEffect: .createsContent,
            requiresConfirmation: true, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            // `.modifiesContent`: extends the write-reach taxonomy from "site or its repository"
            // to a site's Cloudflare-managed DNS zone state — deleting a record alters standing
            // zone state rather than adding a new artifact the way `add-dns-record` does.
            operationID: "delete-dns-record", displayName: "Delete DNS Record",
            intentTypeName: "DeleteDNSRecordIntent", sideEffect: .modifiesContent,
            requiresConfirmation: true, isCancellable: false,
            resultShape: .none
        ),
        OperationDescriptor(
            operationID: "add-store", displayName: "Add Store",
            intentTypeName: "AddStoreIntent", sideEffect: .createsContent,
            requiresConfirmation: true, isCancellable: false,
            resultShape: .none
        ),
    ]

    /// Look up a descriptor by intent type name. `nil` if none registered.
    public static func descriptor(forIntentTypeName name: String) -> OperationDescriptor? {
        all.first { $0.intentTypeName == name }
    }
}
