// Sources/AnglesiteApp/ThemeApplyWizard.swift
import SwiftUI
import AnglesiteCore

struct ThemeApplyWizard: View {
    @Bindable var model: ThemeApplyWizardModel
    /// Called when the owner dismisses a finished wizard (the applying step's "Done" button).
    /// The caller nils its `.sheet(item:)` model, matching every other wizard/sheet in
    /// `SiteWindow` (`IntegrationWizard`'s `onClose`, `EmailSetupSheetView`'s `onDone`) rather
    /// than relying on `@Environment(\.dismiss)` to clear an item-bound sheet's identity.
    let onDone: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 140, maximum: 180), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Group {
                switch model.step {
                case .pickSource: pickSourceStep
                case .pickBuiltIn: pickBuiltInStep
                case .browseFreedesignmd: browseFreedesignmdStep
                case .review: reviewStep
                case .applying: applyingStep
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            HStack {
                if model.step != .pickSource, model.step != .applying {
                    Button("Back") { model.back() }
                }
                Spacer()
                if model.step == .review {
                    Button("Apply") { Task { await model.apply() } }
                        .buttonStyle(.borderedProminent)
                } else if model.step != .applying {
                    Button("Continue") { Task { await model.advance() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!model.canContinue)
                }
            }
        }
        .padding(20)
        .frame(width: 480, height: 420)
    }

    private var pickSourceStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Source", selection: Binding(get: { model.source }, set: { model.source = $0 })) {
                Text("Built-in themes").tag(ThemeApplyWizardModel.Source?.some(.builtIn))
                Text("Browse freedesignmd.com").tag(ThemeApplyWizardModel.Source?.some(.freedesignmd))
            }
            .pickerStyle(.radioGroup)
        }
    }

    private var pickBuiltInStep: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(model.catalog.themes) { theme in
                    themeCard(theme)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func themeCard(_ theme: Theme) -> some View {
        let isSelected = model.selectedBuiltInID == theme.id
        return Button {
            model.selectedBuiltInID = theme.id
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    ForEach(theme.swatch, id: \.self) { hex in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(hex: hex))
                            .frame(width: 24, height: 24)
                    }
                }
                Text(theme.name)
                    .font(.subheadline.bold())
                    .foregroundStyle(.primary)
                Text(theme.blurb)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isSelected ? Color.accentColor.opacity(0.15) : Color.gray.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }

    private var browseFreedesignmdStep: some View {
        Group {
            if let error = model.fetchError {
                Text(error).foregroundStyle(.secondary)
            } else if model.freedesignmdCandidates.isEmpty {
                ProgressView("Searching freedesignmd.com…")
            } else {
                List(model.freedesignmdCandidates, selection: Binding(
                    get: { model.selectedFreedesignmdSlug },
                    set: { model.selectedFreedesignmdSlug = $0 }
                )) { system in
                    Text(system.name).tag(system.slug)
                }
            }
        }
    }

    private var reviewStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch model.source {
            case .builtIn:
                if let theme = model.selectedBuiltInTheme {
                    Text(theme.name).font(.headline)
                    Text(theme.blurb).foregroundStyle(.secondary)
                }
            case .freedesignmd:
                if let slug = model.selectedFreedesignmdSlug {
                    Text(slug).font(.headline)
                }
            case nil: EmptyView()
            }
        }
    }

    private var applyingStep: some View {
        VStack(spacing: 12) {
            switch model.applyResult {
            case .none:
                ProgressView("Applying…")
            case .success:
                Label("Theme applied.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Button("Done") { onDone() }
            case .failure(let error):
                Label("Couldn't apply that theme: \(String(describing: error))", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }
        }
    }
}
