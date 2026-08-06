import SwiftUI
import AnglesiteCore

/// UI for `ExperimentStatsModel` (#769): owner types in each variant's impression/conversion
/// counts, gets `ExperimentStats`' exact Bayesian analysis back in plain language, plus the
/// default test-idea playbook for owners who haven't started a test yet.
struct ExperimentStatsSheetView: View {
    @Bindable var model: ExperimentStatsModel
    var onDone: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Experiment") {
                    TextField("What are you testing? (optional)", text: $model.experimentName)
                }
                variantSection(
                    title: "Original (control)", name: $model.controlName,
                    impressions: $model.controlImpressions, conversions: $model.controlConversions)
                variantSection(
                    title: "Variant (treatment)", name: $model.treatmentName,
                    impressions: $model.treatmentImpressions, conversions: $model.treatmentConversions)

                Section {
                    Button("Analyze") {
                        model.analyze()
                    }
                    .disabled(!model.canAnalyze)
                }

                if let result = model.result {
                    resultSection(result)
                }

                Section("Test ideas") {
                    ForEach(model.suggestions, id: \.title) { suggestion in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(suggestion.title).font(.callout.weight(.medium))
                            Text(suggestion.rationale).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Experiment Results")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onDone() }
                }
            }
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 480, idealHeight: 620)
    }

    private func variantSection(
        title: String, name: Binding<String>, impressions: Binding<Int>, conversions: Binding<Int>
    ) -> some View {
        Section(title) {
            TextField("Name", text: name)
            TextField("Visitors", value: impressions, format: .number)
            TextField("Conversions", value: conversions, format: .number)
        }
    }

    private func resultSection(_ result: ExperimentStats.Result) -> some View {
        Section("Result") {
            if let summary = model.summary {
                Text(summary).font(.callout).textSelection(.enabled)
            }
            LabeledContent("Control rate", value: percent(result.controlRate))
            LabeledContent("Variant rate", value: percent(result.treatmentRate))
            LabeledContent("Probability variant wins", value: percent(result.probabilityTreatmentBeatsControl))
            if !model.hasSufficientData {
                Label(
                    "Not enough traffic yet — the retired skill's rule of thumb is 30+ days or 500+ visitors per variant before trusting an inconclusive result.",
                    systemImage: "clock")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if model.sampleRatioMismatch {
                Label(
                    "The traffic split looks off from what you'd expect — check your test setup before trusting these numbers.",
                    systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange)
            }
            Button("Edit and re-analyze") { model.editAgain() }
        }
    }

    private func percent(_ value: Double) -> String {
        String(format: "%.1f%%", value * 100)
    }
}
