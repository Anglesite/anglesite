import Foundation

/// What the bridge says back to the overlay after handling an `EditMessage`. The struct is
/// `Encodable` because it gets `JSONEncoder()`'d straight into a `evaluateJavaScript` call —
/// `window.anglesite?._handleReply?.(<this object>)` — for the JS side to correlate via `id`.
public struct EditReply: Sendable, Equatable, Encodable {
    /// Correlation ID echoed back from the originating ``EditMessage`` — the only thing the
    /// JS side uses to match a reply to its pending promise.
    public let id: String
    /// What happened to the edit; drives both the overlay's UI reaction and which of the
    /// optional fields below are meaningful.
    public let status: Status
    /// Human-readable detail. Always present for `.failed` / `.ambiguous`; optional for `.applied`.
    public let message: String?
    /// Source file the patch landed on (relative path within the site). Present on `.applied`
    /// when the plugin's structured reply included it; `nil` for `.failed` / `.ambiguous` and
    /// for replies the router couldn't parse as JSON.
    public let file: String?
    /// SHA of the commit on `refs/heads/anglesite/edits` that captures this edit. `nil` when
    /// the site isn't a git repo, or for non-`.applied` replies.
    public let commit: String?
    /// Op-scoped metadata. For `replace-image-src` carries `{ src, srcset? }`. `nil` for ops
    /// that don't surface overlay-side metadata.
    public let result: ImageResult?
    /// `extract-component`-scoped metadata — the project-relative path of the brand-new component
    /// file the op created (e.g. `src/components/Hero.astro`). A plain top-level string on the
    /// plugin's `edit-applied` body (sibling to `file`/`commit`, NOT nested under `result`).
    /// Present on the `.applied` reply for that op; `nil` for every other op. Kept as a simple
    /// additive optional alongside `commit`/`model`, matching this type's one-field-per-op-family
    /// convention.
    public let newFile: String?
    /// Preview-only: the source fragment before/after the would-be change (`.preview` status).
    public let before: String?
    /// Preview-only counterpart to ``before`` — the fragment as it would read after the change.
    public let after: String?
    /// The op the preview/apply was for (e.g. "edit-style"). `nil` outside preview.
    public let op: String?
    /// Piggybacked component model — present when the plugin's structured `.applied` reply
    /// included a `model` key (Component Editor CSS write ops), sparing the app a second
    /// `get_component_model` round-trip after the edit. `nil` otherwise.
    public let model: ComponentModel?
    /// Machine-readable refusal code from the plugin's `anglesite:edit-failed` body (e.g.
    /// `"stale"`, `"no-match"`, `"invalid-input"`) — present whenever the router could parse a
    /// structured failure. Callers that need to distinguish failure kinds (e.g. staleness vs. a
    /// routine refusal) should switch on this instead of substring-matching `message`, which is
    /// free-form prose the plugin is free to reword.
    public let reason: String?

    /// `replace-image-src` metadata: the final asset URLs the plugin wrote, which the overlay
    /// swaps into the live `<img>` so the page reflects the edit without a full reload.
    public struct ImageResult: Sendable, Equatable, Encodable {
        /// The rewritten `src` value.
        public let src: String
        /// The rewritten `srcset` value, when the plugin generated responsive variants;
        /// `nil` when the image has none.
        public let srcset: String?

        /// Memberwise initializer — normally built by the router from the plugin's structured
        /// reply.
        public init(src: String, srcset: String?) {
            self.src = src
            self.srcset = srcset
        }
    }

    /// Reply outcome. Raw values are the wire strings the overlay's `_handleReply` switches on.
    public enum Status: String, Sendable, Equatable, Encodable {
        /// The edit landed in source (and, when the site is a git repo, on the edits branch).
        case applied
        /// The edit was refused or errored; ``message`` (and ``reason``, when structured)
        /// says why.
        case failed
        /// The selector matched more than one element, so applying would risk editing the
        /// wrong one — the overlay should have the user disambiguate rather than guess.
        case ambiguous
        /// Dry-run result: nothing was written; ``before``/``after`` carry the would-be diff.
        case preview
    }

    /// Memberwise initializer. Every op-specific field defaults to `nil` so call sites only
    /// name the fields their op family actually produces.
    public init(
        id: String,
        status: Status,
        message: String?,
        file: String? = nil,
        commit: String? = nil,
        result: ImageResult? = nil,
        before: String? = nil,
        after: String? = nil,
        op: String? = nil,
        model: ComponentModel? = nil,
        reason: String? = nil,
        newFile: String? = nil
    ) {
        self.id = id
        self.status = status
        self.message = message
        self.file = file
        self.commit = commit
        self.result = result
        self.before = before
        self.after = after
        self.op = op
        self.model = model
        self.reason = reason
        self.newFile = newFile
    }
}

/// The seam between the JS bridge and whatever applies the edit. Phase 5 lands a real implementation
/// backed by `MCPClient` calling the plugin's `anglesite:apply-edit` tool; until then the wired
/// default is `LoggingEditRouter`.
public protocol EditRouter: Sendable {
    /// Applies (or previews, per `dryRun`) one edit and always produces a reply — the method
    /// doesn't throw, because the overlay is waiting on a correlated response either way;
    /// failures travel as ``EditReply/Status/failed`` rather than as errors that would leave
    /// the JS side hanging.
    func apply(_ message: EditMessage) async -> EditReply
}

/// Resolves an optional configured router to a router that's always safe to call —
/// falls back to `LoggingEditRouter` (fails safe, never silently drops an edit) when
/// nothing was wired. Named and tested separately from `ComponentCanvasView.makeNSView`
/// so the fallback behavior has coverage independent of the untestable NSViewRepresentable.
public func resolveEditRouter(_ configured: EditRouter?) -> EditRouter {
    configured ?? LoggingEditRouter()
}

/// Development default: logs the message to `LogCenter` (so it shows up in the Debug pane) and
/// replies `.failed` with a "not wired yet" hint. Lets `PreviewView` ship the bridge end-to-end
/// before the Phase 5 server-side patcher exists.
public struct LoggingEditRouter: EditRouter {
    private let logCenter: LogCenter

    /// Injectable log destination; the default is the app-wide shared `LogCenter` feeding the
    /// Debug pane.
    public init(logCenter: LogCenter = .shared) {
        self.logCenter = logCenter
    }

    /// Logs what *would* have been applied, then replies ``EditReply/Status/failed`` — never
    /// `.applied`, so no caller can mistake the stub for a real edit.
    public func apply(_ message: EditMessage) async -> EditReply {
        let target = message.selector.map { "\($0)" } ?? message.component.map { "\($0)" } ?? "?"
        await logCenter.append(
            source: "bridge",
            stream: .stdout,
            text: "(stub) would apply \(message.op) on \(target) at \(message.path) [id=\(message.id)]"
        )
        return EditReply(
            id: message.id,
            status: .failed,
            message: "apply-edit routing not yet wired — Phase 5 lands the server-side patcher"
        )
    }
}
