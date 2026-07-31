// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import Foundation
import FoundationModels

/// Structured output the on-device model fills in guided generation. Mapped to the
/// FM-independent `InterpretedEdit` so op-routing stays CI-testable without the live model.
@Generable
public struct GeneratedInterpretedEdit: Equatable, Sendable {
    /// Which of the three edit shapes the model chose. Discriminates which of the fields
    /// below are meaningful — the others are empty-string sentinels.
    @Guide(description: "The kind of change: text (replace the element's visible text), attribute (set an HTML attribute like alt or href), or style (a CSS property like color or font-size).")
    public var kind: InterpretedEditKindGen

    /// Replacement text for a `.text` edit. Non-optional with an empty-string sentinel
    /// (like every kind-specific field here) because guided generation fills every field;
    /// the mapping in ``FoundationModelEditInterpreter/interpret(instruction:element:)``
    /// converts empties back to `nil`.
    @Guide(description: "For a text edit: the full new visible text. Empty otherwise.")
    public var newText: String

    /// Attribute name for an `.attribute` edit; empty-string sentinel otherwise.
    @Guide(description: "For an attribute edit: the attribute name (e.g. alt, href). Empty otherwise.")
    public var attributeName: String

    /// Attribute value for an `.attribute` edit; empty-string sentinel otherwise.
    @Guide(description: "For an attribute edit: the new attribute value. Empty otherwise.")
    public var attributeValue: String

    /// CSS property for a `.style` edit; empty-string sentinel otherwise.
    @Guide(description: "For a style edit: the CSS property (e.g. color, font-size). Empty otherwise.")
    public var styleProperty: String

    /// CSS value for a `.style` edit; empty-string sentinel otherwise.
    @Guide(description: "For a style edit: the CSS value (e.g. teal, 2rem). Empty otherwise.")
    public var styleValue: String

    /// User-facing one-sentence description of the change — this is what the confirmation
    /// UI shows before the edit is applied, so the model is asked to keep it short.
    @Guide(description: "One short sentence describing the change, shown to the user before they confirm.")
    public var summary: String
}

/// `@Generable` mirror of `InterpretedEditKind`. Kept separate so the FM dependency doesn't
/// bleed into the plain model type used by CI-testable op-routing.
@Generable
public enum InterpretedEditKindGen: String, Equatable, Sendable {
    /// Replace the element's visible text content.
    case text
    /// Set an HTML attribute (e.g. `alt`, `href`) on the element.
    case attribute
    /// Set a CSS property (e.g. `color`, `font-size`) on the element.
    case style
}

/// FM-backed `EditInterpreting`. The `generate` closure is injected so unit tests can supply a
/// canned `GeneratedInterpretedEdit` without the live model; the production initializer wires it
/// to `FoundationModelAssistant.generateStructured` and maps model-unavailability to
/// `EditInterpretationError.unavailable`.
public struct FoundationModelEditInterpreter: EditInterpreting {
    /// The injectable generation seam: everything the live model does, reduced to one
    /// closure so tests can return a canned ``GeneratedInterpretedEdit`` and exercise the
    /// mapping logic without Apple Intelligence being available.
    public typealias Generate = @Sendable (
        _ instruction: String,
        _ element: InterpretedElementContext
    ) async throws -> GeneratedInterpretedEdit

    private let generate: Generate

    /// Testable initializer — inject a canned `generate` closure instead of the live model.
    public init(generate: @escaping Generate) {
        self.generate = generate
    }

    /// App-wide production wiring. Builds a prompt from the instruction and element context,
    /// resolves `siteID` and `siteDirectory` from the element context (threaded through by
    /// `perform()` from the `ElementEntity`), and calls
    /// `FoundationModelAssistant.generateStructured`. Surfaces `AssistantError.unavailable`
    /// as `EditInterpretationError.unavailable`.
    ///
    /// This initializer carries no per-site state — it is safe to register once at app startup
    /// via `AppDependencyManager` and reuse across all edits.
    public init(assistant: FoundationModelAssistant) {
        self.generate = { instruction, element in
            guard let siteID = element.siteID, let siteDirectory = element.siteDirectory else {
                throw EditInterpretationError.siteUnavailable("siteID/siteDirectory not provided in element context")
            }
            let prompt = Self.buildPrompt(instruction: instruction, element: element)
            let context = AssistantContext(
                siteID: siteID,
                siteDirectory: siteDirectory,
                currentPageRoute: element.pagePath
            )
            do {
                return try await assistant.generateStructured(
                    prompt: prompt,
                    context: context,
                    resultType: GeneratedInterpretedEdit.self
                )
            } catch let e as AssistantError {
                throw EditInterpretationError.unavailable(String(describing: e))
            }
        }
    }

    // MARK: EditInterpreting

    /// Runs the instruction through the injected generator and maps the guided-generation
    /// result to the FM-independent `InterpretedEdit`, converting the empty-string
    /// sentinels back to `nil` so downstream op-routing sees a conventional optional model.
    public func interpret(instruction: String, element: InterpretedElementContext) async throws -> InterpretedEdit {
        let g = try await generate(instruction, element)
        let kind: InterpretedEditKind = switch g.kind {
        case .text: .text
        case .attribute: .attribute
        case .style: .style
        }
        return InterpretedEdit(
            kind: kind,
            newText: g.newText.isEmpty ? nil : g.newText,
            attributeName: g.attributeName.isEmpty ? nil : g.attributeName,
            attributeValue: g.attributeValue.isEmpty ? nil : g.attributeValue,
            styleProperty: g.styleProperty.isEmpty ? nil : g.styleProperty,
            styleValue: g.styleValue.isEmpty ? nil : g.styleValue,
            summary: g.summary
        )
    }

    // MARK: Private

    static func buildPrompt(instruction: String, element: InterpretedElementContext) -> String {
        let lines = [
            "Interpret this edit instruction for a website element.",
            "Element: <\(element.tag)>" + (element.currentText.map { " with text \"\($0)\"" } ?? ""),
            "Page: \(element.pagePath)",
            "Instruction: \(instruction)",
            "Choose exactly one kind (text / attribute / style) and fill only that kind's fields.",
        ]
        return lines.joined(separator: "\n")
    }
}
#endif
