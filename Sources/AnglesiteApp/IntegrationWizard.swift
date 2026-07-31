// Sources/AnglesiteApp/IntegrationWizard.swift
import SwiftUI
import AnglesiteCore

struct IntegrationWizard: View {
    @Bindable var model: IntegrationWizardModel
    let onClose: () -> Void
    @State private var showingAddStore = false

    var body: some View {
        VStack(spacing: 0) {
            switch model.step {
            case .pickIntegration: pickIntegration
            case .pickProvider: pickProvider
            case .fields: fields
            case .review: review
            case .applying: applying
            }
            Divider()
            footer
        }
        .frame(minWidth: 520, idealWidth: 520, minHeight: 400, idealHeight: 500)
    }

    // MARK: Steps

    private var pickIntegration: some View {
        VStack(spacing: 0) {
            Button {
                showingAddStore = true
            } label: {
                HStack {
                    Image(systemName: "cart")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Add a Store").font(.headline)
                        Text("Answer a couple of questions and we'll pick the right commerce integration.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Divider()
            List(model.descriptorsForPicker, id: \.id,
                 selection: Binding(get: { model.selectedID }, set: { model.selectedID = $0 })) { d in
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.displayName).font(.headline)
                    Text(d.summary).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .sheet(isPresented: $showingAddStore) {
            AddStoreIntakeView { route in
                showingAddStore = false
                model.startFromRouter(route)
            }
        }
    }

    private var pickProvider: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Choose a provider").font(.headline).padding(.horizontal)
            Picker("Provider", selection: Binding(
                get: { model.answers["provider"] ?? "" },
                set: { model.answers["provider"] = $0 })) {
                ForEach(model.descriptor?.providers ?? [], id: \.id) { provider in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(provider.displayName)
                        if let note = provider.note {
                            Text(note).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .tag(provider.id)
                }
            }
            .pickerStyle(.inline)
            .padding(.horizontal)
            Spacer()
        }
        .padding(.top, 16)
    }

    private var fields: some View {
        Form {
            ForEach(model.visibleFields) { field in
                fieldRow(field)
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder private func fieldRow(_ field: Field) -> some View {
        let binding = Binding(
            get: { model.answers[field.key] ?? field.defaultValue ?? "" },
            set: { model.answers[field.key] = $0 }
        )
        switch field.kind {
        case .text, .email, .url, .path:
            LabeledContent(field.label) {
                TextField(field.label, text: binding)
                    .labelsHidden()
            }
        case .bool:
            Toggle(field.label, isOn: Binding(
                get: { binding.wrappedValue == "true" },
                set: { binding.wrappedValue = $0 ? "true" : "false" }
            ))
        case .choice(let choices):
            Picker(field.label, selection: binding) {
                ForEach(choices, id: \.value) { Text($0.label).tag($0.value) }
            }
        }
    }

    private var review: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let planError = model.planError {
                    Label(planError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .padding()
                } else {
                    Text(model.plan?.summary ?? "Preparing plan…")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            }
        }
    }

    private var applying: some View {
        VStack(spacing: 12) {
            if case .failed(_, let message) = model.progress.last {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
                Text("Couldn't finish setup").font(.headline)
                Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Back") { model.back() }
            } else {
                ProgressView()
                Text("Setting up…").foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: Footer

    @ViewBuilder private var footer: some View {
        HStack {
            if model.step != .pickIntegration && model.step != .applying {
                Button("Back") { model.back() }
            }
            Spacer()
            Button("Cancel") { onClose() }
            switch model.step {
            case .review:
                Button("Set Up") {
                    Task {
                        await model.apply()
                        if case .done = model.progress.last { onClose() }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canContinue)
            case .applying:
                EmptyView()
            default:
                Button("Continue") {
                    Task { await model.advance() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canContinue)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
