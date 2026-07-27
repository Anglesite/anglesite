import SwiftUI
import AnglesiteCore

/// Per-file sync conflict resolution sheet (#881, design doc §3): keep this Mac's / keep the
/// other's / open both, for every path `SyncModel.conflictedFiles` lists, plus the quarantined
/// `Config/conflicts/` working-tree copies in the same sheet. "Apply" is disabled until every
/// conflicted path has a choice — a partial resolution can't produce a valid merge commit
/// (`SyncConflictResolver.resolve` itself refuses one).
///
/// Mac-assed-app-spec compliance: standard sheet chrome (Cancel/Apply in the standard toolbar
/// placements — Esc and ⌘. both dismiss via Cancel, ⌘Return activates Apply), VoiceOver labels on
/// every control, and no state is silently discarded — Cancel leaves the conflict exactly as it
/// was; nothing here writes to the repo until Apply succeeds.
struct SyncConflictResolutionSheetView: View {
    @Bindable var model: SyncModel
    let siteName: String

    @State private var choices: [String: SyncConflictResolver.Choice] = [:]

    var body: some View {
        NavigationStack {
            List {
                if !model.conflictedFiles.isEmpty {
                    Section("Files edited on both Macs") {
                        ForEach(model.conflictedFiles) { file in
                            conflictedFileRow(file)
                        }
                    }
                }
                if !model.quarantinedFiles.isEmpty {
                    Section("Quarantined copies") {
                        ForEach(model.quarantinedFiles, id: \.self) { url in
                            quarantinedFileRow(url)
                        }
                    }
                    .accessibilityLabel("Files iCloud saved as separate conflict copies. Their content already exists in this site's history; you can discard them.")
                }
                if let error = model.resolutionError {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .accessibilityLabel("Error: \(error)")
                    }
                }
            }
            .navigationTitle("Resolve Sync Conflict")
            .navigationSubtitle(siteName)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.dismissResolutionSheet() }
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        model.resolve(choices: choices)
                    } label: {
                        if model.isResolving {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Apply")
                        }
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!isEveryConflictedFileResolved || model.isResolving)
                }
            }
        }
        .frame(minWidth: 520, minHeight: 360)
        // Esc's default sheet-dismiss behavior is exactly Cancel here — resolving nothing is
        // always safe (the site stays editable, per the design doc; only pushing this branch
        // stays paused), so no `.interactiveDismissDisabled()` is needed.
    }

    private var isEveryConflictedFileResolved: Bool {
        !model.conflictedFiles.isEmpty && model.conflictedFiles.allSatisfy { choices[$0.path] != nil }
    }

    @ViewBuilder
    private func conflictedFileRow(_ file: SyncConflictResolver.ConflictedFile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(file.path)
                .font(.callout.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)

            Picker("Keep which version", selection: Binding<SyncConflictResolver.Choice?>(
                get: { choices[file.path] },
                set: { choices[file.path] = $0 }
            )) {
                Text("This Mac").tag(Optional(SyncConflictResolver.Choice.keepMine))
                Text("Other Mac").tag(Optional(SyncConflictResolver.Choice.keepTheirs))
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityLabel("Keep which version of \(file.path)")

            Button("Open Both…") {
                model.openBothVersions(for: file)
            }
            .buttonStyle(.link)
            .font(.caption)
            .disabled(file.oursText == nil && file.theirsText == nil)
            .accessibilityHint("Opens both versions of \(file.path) in Finder to compare before choosing")
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func quarantinedFileRow(_ url: URL) -> some View {
        HStack {
            Image(systemName: "doc.on.doc")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(url.lastPathComponent)
                .font(.callout.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Button("Reveal") { model.revealQuarantinedFile(url) }
                .buttonStyle(.link)
                .font(.caption)
                .accessibilityLabel("Reveal \(url.lastPathComponent) in Finder")
            Button("Discard", role: .destructive) { model.deleteQuarantinedFile(url) }
                .buttonStyle(.link)
                .font(.caption)
                .accessibilityLabel("Discard \(url.lastPathComponent)")
                .accessibilityHint("This copy's content already exists in this site's git history")
        }
    }
}
