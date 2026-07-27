// Sources/AnglesiteApp/CommunitiesView.swift
import SwiftUI
import AppKit
import AnglesiteCore

/// Main-pane Communities surface (Website ▸ Communities…, V-5.1a #368): join/leave fediverse
/// Group actors and read a per-group timeline. Mirrors `FollowersView`/`MicrosubReaderView`'s
/// wiring shape — a dedicated pane with its own model, no in-content pane picker.
struct CommunitiesView: View {
    @Bindable var communities: CommunitiesModel

    var body: some View {
        HSplitView {
            sidebar
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            timelinePane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationSubtitle("Communities")
        .alert(
            "Communities error",
            isPresented: Binding(
                get: { communities.errorMessage != nil },
                set: { if !$0 { communities.errorMessage = nil } }),
            presenting: communities.errorMessage
        ) { _ in
            Button("OK", role: .cancel) { communities.errorMessage = nil }
        } message: { message in
            Text(message)
        }
        .alert(
            "Leave this community?",
            isPresented: Binding(
                get: { communities.leaveConfirmation != nil },
                set: { if !$0 { communities.cancelLeave() } }),
            presenting: communities.leaveConfirmation
        ) { community in
            Button("Leave", role: .destructive) { Task { await communities.confirmLeave() } }
            Button("Cancel", role: .cancel) { communities.cancelLeave() }
        } message: { community in
            Text("This site will stop receiving posts from \(community.displayName ?? community.id).")
        }
    }

    @ViewBuilder
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TextField("!community@instance or URL", text: $communities.joinHandleText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await communities.join() } }
                Button("Join") { Task { await communities.join() } }
                    .disabled(communities.joinHandleText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding()

            if communities.joined.isEmpty {
                Text("No communities joined yet — enter a handle above, like !birding@lemmy.ml.")
                    .foregroundStyle(.secondary)
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                List(selection: Binding(
                    get: { communities.selectedCommunityID },
                    set: { if let id = $0 { communities.selectCommunity(id) } }
                )) {
                    ForEach(communities.joined) { community in
                        communityRow(community).tag(community.id)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func communityRow(_ community: JoinedCommunity) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(community.displayName ?? community.handle ?? community.actorID.absoluteString)
                .font(.headline)
                .lineLimit(1)
            if let handle = community.handle {
                Text(handle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button("Leave…", role: .destructive) { communities.requestLeave(community) }
        }
    }

    @ViewBuilder
    private var timelinePane: some View {
        if communities.selectedCommunityID == nil {
            Text("Select a community to see its timeline.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if communities.isLoadingTimeline {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if communities.timeline.isEmpty {
            Text("No posts yet.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(communities.timeline) { post in
                timelineRow(post)
            }
        }
    }

    @ViewBuilder
    private func timelineRow(_ post: GroupPost) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(post.title ?? post.contentHTML ?? post.id)
                .font(.headline)
                .lineLimit(2)
            if let author = post.authorName {
                Text(author).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .contextMenu {
            if let url = post.url {
                Button("Open in Browser") { NSWorkspace.shared.open(url) }
            }
        }
    }
}
