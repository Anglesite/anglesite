import SwiftUI
import AppKit
import AnglesiteCore

/// Main-pane Followers surface (Website ▸ Followers…, V-4.2 #364): who follows this site in the
/// Fediverse. Mirrors `MicrosubReaderView`'s wiring shape — a dedicated pane with its own model,
/// no in-content pane picker.
///
/// View-only: `@dwk/activitypub` exposes no way to remove or block a follower
/// (davidwkeith/workers#447).
struct FollowersView: View {
    @Bindable var followers: FollowersModel

    var body: some View {
        Group {
            switch followers.state {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                loadedContent
            case .noSiteURL:
                message(
                    "This site hasn't been published yet",
                    detail: "Publish it at least once, then followers will appear here.")
            case .notActivated:
                message(
                    "ActivityPub isn't turned on for this site",
                    detail: "Turn on ActivityPub in Settings ▸ Workers, then publish again.")
            case .unreachable(let reason):
                message("Couldn't reach this site", detail: reason)
            }
        }
        .navigationSubtitle("Followers")
        .task { if followers.state == .idle { await followers.load() } }
        .onDisappear { followers.saveCacheNow() }
    }

    @ViewBuilder
    private var loadedContent: some View {
        if followers.rows.isEmpty {
            emptyState
        } else {
            VStack(spacing: 0) {
                // Refresh lives inline rather than in the window toolbar, matching
                // `MicrosubReaderView`'s inline "Sign Out" — the customizable toolbar (#518) is
                // owned by the window, and a pane-scoped item doesn't belong in it.
                HStack {
                    Text("\(followers.totalItems) followers").font(.headline)
                    Spacer()
                    Button("Refresh", systemImage: "arrow.clockwise") {
                        Task { await followers.refresh() }
                    }
                }
                .padding()

                List {
                    ForEach(followers.rows) { row in
                        followerRow(row)
                    }
                    if followers.canLoadMore {
                        Button("Load More") { Task { await followers.loadMore() } }
                    }
                }
            }
        }
    }

    /// Doubles as discovery guidance: until WebFinger ships (#366), pasting the actor URL into
    /// Mastodon's search is the only way anyone can find this site.
    @ViewBuilder
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No followers yet").font(.title2)
            if let actorURL = followers.actorURL {
                Text("Anyone on Mastodon can follow this site by pasting its address into search:")
                    .foregroundStyle(.secondary)
                HStack {
                    Text(actorURL.absoluteString)
                        .textSelection(.enabled)
                        .font(.body.monospaced())
                    Button("Copy", systemImage: "doc.on.doc") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(actorURL.absoluteString, forType: .string)
                    }
                    .labelStyle(.iconOnly)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func followerRow(_ row: FollowerRow) -> some View {
        HStack(spacing: 10) {
            avatar(for: row)
            VStack(alignment: .leading, spacing: 2) {
                // Plain `Text` only: a display name is follower-supplied, so any markup in it
                // must render literally rather than being interpreted.
                Text(row.displayName).font(.headline).lineLimit(1)
                Text(row.handle ?? row.actor.absoluteString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.vertical, 2)
        .task { followers.enrichIfNeeded(row.actor) }
        .contextMenu {
            // Guarded, not merely displayed: this hands a follower-chosen URL to the system
            // opener, so it's held to the same HTTPS rule as a fetch.
            if ActorProfileFetcher.isHTTPS(row.actor) {
                Button("Open Profile") { NSWorkspace.shared.open(row.actor) }
            }
            Button("Copy Actor URL") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(row.actor.absoluteString, forType: .string)
            }
        }
    }

    @ViewBuilder
    private func avatar(for row: FollowerRow) -> some View {
        // `iconURL` is `nil` unless the fetched value was HTTPS — `ActorProfileFetcher` drops
        // insecure ones, so this never loads an avatar over plaintext.
        AsyncImage(url: row.profile?.iconURL) { image in
            image.resizable().aspectRatio(contentMode: .fill)
        } placeholder: {
            Image(systemName: "person.crop.circle").resizable().foregroundStyle(.tertiary)
        }
        .frame(width: 32, height: 32)
        .clipShape(.circle)
    }

    @ViewBuilder
    private func message(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title2)
            Text(detail).foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
