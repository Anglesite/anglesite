import AppIntents
import AnglesiteCore
import Foundation

/// Siri/Shortcuts front-door for `ExperimentStats` (#769) — "How is my test going?". Pure
/// computation, no site/network dependency: the retired plugin's edge A/B machinery (variant
/// assignment, an analytics pipeline reporting counts back to the app) was never rebuilt after
/// #466 (follow-up: #1270), so — like the Experiment Results sheet (`ExperimentStatsSheetView`) —
/// this intent takes each variant's impression/conversion counts as parameters rather than
/// reading them from a stored experiment config.
///
/// Not registered in AnglesiteShortcuts: same phrase-budget reasoning as `ReviewCopyIntent` (the
/// 10-phrase cap is already spent) — stays discoverable via the Shortcuts app.
public struct AnalyzeExperimentIntent: AppIntent {
    /// Action name in the Shortcuts library.
    public static let title: LocalizedStringResource = "Analyze Experiment"
    /// Shortcuts-editor blurb.
    public static let description = IntentDescription(
        "Compare two variants' visitor and conversion counts and report whether either is winning.")

    /// Optional label for the dialog, e.g. "Hero headline test". Purely cosmetic.
    @Parameter(title: "Experiment Name", default: "")
    public var experimentName: String
    @Parameter(title: "Original Name", default: "Original")
    public var controlName: String
    @Parameter(title: "Original Visitors") public var controlImpressions: Int
    @Parameter(title: "Original Conversions") public var controlConversions: Int
    @Parameter(title: "Variant Name", default: "Variant")
    public var treatmentName: String
    @Parameter(title: "Variant Visitors") public var treatmentImpressions: Int
    @Parameter(title: "Variant Conversions") public var treatmentConversions: Int

    /// Required by the AppIntents runtime; parameters are populated after init.
    public init() {}

    /// Shortcuts-editor sentence: "Analyze (name) with (control) vs (variant)".
    public static var parameterSummary: some ParameterSummary {
        Summary("Analyze \(\.$experimentName)") {
            \.$controlName
            \.$controlImpressions
            \.$controlConversions
            \.$treatmentName
            \.$treatmentImpressions
            \.$treatmentConversions
        }
    }

    /// No side effects and nothing to confirm — reads no state, writes nothing.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: run()))
    }

    private func run() -> String {
        let control = ExperimentStats.Variant(
            name: controlName.isEmpty ? "Original" : controlName,
            impressions: controlImpressions, conversions: controlConversions)
        let treatment = ExperimentStats.Variant(
            name: treatmentName.isEmpty ? "Variant" : treatmentName,
            impressions: treatmentImpressions, conversions: treatmentConversions)
        let result = ExperimentStats.analyze(control: control, treatment: treatment)
        let name = experimentName.isEmpty ? "This experiment" : experimentName
        var reply = ExperimentStats.formatSummary(experimentName: name, result: result)
        if !ExperimentStats.hasSufficientData(control: control, treatment: treatment) {
            reply += "\nNot much traffic yet — the usual rule of thumb is 30+ days or 500+ visitors per variant."
        }
        if ExperimentStats.hasSampleRatioMismatch(control: control, treatment: treatment) {
            reply += "\nThe traffic split looks off from what you'd expect — check your test setup."
        }
        return reply
    }
}

// MARK: - Test-only helpers

extension AnalyzeExperimentIntent {
    /// Drives `perform`'s dialog logic directly, bypassing the AppIntents runtime — see
    /// `ReviewCopyIntent.performForTesting()`. Safe here since `run()` has no runtime
    /// dependency at all (no `@Dependency`, no confirmation).
    func performForTesting() -> String {
        run()
    }
}
