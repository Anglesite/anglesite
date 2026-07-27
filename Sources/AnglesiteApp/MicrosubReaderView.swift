import SwiftUI
import AppKit
import AnglesiteCore

/// Main-pane Reader surface (Website ▸ Reader…, V-4.3 #365): sign in, follow a feed, and read the
/// resulting timeline. Mirrors `ProjectCleanupView`'s wiring shape — a dedicated pane with its own
/// model, no in-content pane picker (#519's toolbar/View-menu switcher stays the only navigation).
struct MicrosubReaderView: View {
    @Bindable var reader: MicrosubReaderModel

    var body: some View {
        Group {
            switch reader.signInState {
            case .signedOut, .awaitingCallback:
                signInContent
            case .signedIn:
                readerContent
            }
        }
        .navigationSubtitle("Reader")
        .alert(
            "Reader error",
            isPresented: Binding(
                get: { reader.errorMessage != nil },
                set: { if !$0 { reader.errorMessage = nil } }),
            presenting: reader.errorMessage
        ) { _ in
            Button("OK", role: .cancel) { reader.errorMessage = nil }
        } message: { message in
            Text(message)
        }
    }

    @ViewBuilder
    private var signInContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign in to read your feeds")
                .font(.title2)
            Text("The Reader follows feeds and stores your timeline on this site's own Microsub endpoint — sign in as this site's owner to use it.")
                .foregroundStyle(.secondary)

            if reader.signInState == .awaitingCallback {
                Text("Approve sign-in in your browser, then copy the final URL from the address bar (it will fail to load — that's expected) and paste it here.")
                TextField("Pasted callback URL", text: $reader.pastedCallbackText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { reader.completeSignIn() }
                HStack {
                    Button("Complete Sign In") { reader.completeSignIn() }
                        .disabled(reader.pastedCallbackText.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Cancel", role: .cancel) { reader.cancelSignIn() }
                }
            } else {
                Button("Sign In…") { reader.startSignIn() }
                    .disabled(!reader.canStartSignIn)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var readerContent: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("Follow a feed or site URL…", text: $reader.followURLText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { reader.follow() }
                Button("Follow") { reader.follow() }
                    .disabled(reader.followURLText.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
                Button("Sign Out") { reader.signOut() }
            }
            .padding()

            if !reader.channels.isEmpty {
                Picker("Channel", selection: channelSelection) {
                    ForEach(reader.channels) { channel in
                        Text(channel.unread.map { $0 > 0 ? "\(channel.name) (\($0))" : channel.name } ?? channel.name)
                            .tag(channel.id)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(.horizontal)
            }

            List {
                if reader.timeline.isEmpty && !reader.isLoading {
                    Text("No entries yet — follow a feed above to get started.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(reader.timeline) { entry in
                        timelineRow(entry)
                    }
                }
            }
        }
        .task {
            if reader.channels.isEmpty { await reader.loadChannels() }
        }
    }

    private var channelSelection: Binding<String> {
        Binding(
            get: { reader.selectedChannelID ?? reader.channels.first?.id ?? "" },
            set: { reader.selectChannel($0) }
        )
    }

    @ViewBuilder
    private func timelineRow(_ entry: MicrosubTimelineEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.name ?? entry.summary ?? entry.content?.text ?? entry.url ?? "Untitled entry")
                .font(.headline)
                .lineLimit(2)
            HStack(spacing: 8) {
                if let author = entry.author?.name {
                    Text(author)
                }
                if let published = entry.published {
                    Text(published)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .contextMenu {
            if let urlString = entry.url, let url = URL(string: urlString) {
                Button("Open in Browser") { NSWorkspace.shared.open(url) }
            }
        }
    }
}
