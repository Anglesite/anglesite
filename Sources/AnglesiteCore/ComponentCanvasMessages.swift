import Foundation

/// JS → native messages from the component-harness canvas overlay module.
/// Wire shapes are defined in JS/edit-overlay/src/component-canvas.ts.
public enum ComponentCanvasDecodeError: Error, Equatable {
    /// The body's `type` field named a different message — "not mine", so the dispatcher can
    /// keep routing, as opposed to ``malformed``, which means the right message arrived broken.
    case wrongType
    /// The `type` matched but a required field was missing or mistyped — a real wire-format
    /// mismatch worth surfacing, not just a message meant for another decoder.
    case malformed
}

/// The canvas overlay reporting a click on a rendered element, carrying the element's
/// `data-astro-source-loc` annotation so the outline can highlight the matching node (via
/// ``ComponentOutline/node(atLine:column:in:)`` — see its doc for why line matches exactly but
/// column doesn't). All fields optional: a click can land on chrome with no source annotation,
/// and that's still a selection worth reporting (it clears the outline highlight).
public struct CanvasSelectionMessage: Sendable, Equatable {
    /// The wire `type` discriminator `AnglesiteMessageDispatcher` routes on.
    public static let messageType = "anglesite:canvas-selection"

    /// The clicked element's source file as Astro stamps it (vite-rooted, e.g.
    /// `/src/components/Card.astro`) — match it via ``ComponentOutline/fileMatches(_:relativePath:)``,
    /// not string equality.
    public let file: String?
    /// 1-based source line from the `data-astro-source-loc` annotation.
    public let line: Int?
    /// Column from the annotation — the END of the element's opening tag, not its start (see
    /// ``ComponentOutline/node(atLine:column:in:)``).
    public let column: Int?

    /// Memberwise initializer — public for tests; production instances come from
    /// ``decode(from:)`` on the script-message body.
    public init(file: String?, line: Int?, column: Int?) {
        self.file = file
        self.line = line
        self.column = column
    }

    /// Decodes a `WKScriptMessage` body. Returns `.failure(.wrongType)` for another message's
    /// body so the dispatcher can try the next decoder; missing fields are *not* an error here
    /// (every field is optional by design), so this never returns `.malformed`.
    public static func decode(from body: Any) -> Result<CanvasSelectionMessage, ComponentCanvasDecodeError> {
        guard let dict = body as? [String: Any], dict["type"] as? String == messageType else {
            return .failure(.wrongType)
        }
        return .success(CanvasSelectionMessage(
            file: dict["file"] as? String,
            line: dict["line"] as? Int,
            column: dict["column"] as? Int
        ))
    }
}

/// The canvas overlay reporting the selected element's resolved CSS — what the browser actually
/// computed, so the style inspector can show effective values (inherited, cascaded, defaulted)
/// rather than only the declarations present in the component's own `<style>` block.
public struct ComputedStylesReport: Sendable, Equatable {
    /// The wire `type` discriminator `AnglesiteMessageDispatcher` routes on.
    public static let messageType = "anglesite:computed-styles"

    /// Computed property → value pairs, exactly as the overlay read them from
    /// `getComputedStyle` (the overlay chooses which properties to report).
    public let styles: [String: String]

    /// Memberwise initializer — public for tests; production instances come from
    /// ``decode(from:)`` on the script-message body.
    public init(styles: [String: String]) {
        self.styles = styles
    }

    /// Decodes a `WKScriptMessage` body. Returns `.failure(.wrongType)` for another message's
    /// body so the dispatcher can try the next decoder; unlike ``CanvasSelectionMessage``, the
    /// `styles` map is required, so a matching-type body without it is `.malformed`.
    public static func decode(from body: Any) -> Result<ComputedStylesReport, ComponentCanvasDecodeError> {
        guard let dict = body as? [String: Any], dict["type"] as? String == messageType else {
            return .failure(.wrongType)
        }
        guard let styles = dict["styles"] as? [String: String] else {
            return .failure(.malformed)
        }
        return .success(ComputedStylesReport(styles: styles))
    }
}
