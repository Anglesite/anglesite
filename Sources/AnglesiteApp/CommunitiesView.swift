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
        Group {
            switch communities.state {
            case .noSiteURL:
                message(
                    "This site hasn't been published yet",
                    detail: Text("Publish it at least once, then you can join communities."))
            case .idle, .loading, .loaded:
                HSplitView {
                    sidebar
                        .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
                    timelinePane
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
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
        // The setter has NO side effect, and each button is solely responsible for clearing
        // `leaveConfirmation` — matching `SiteWindow`'s `deleteConfirmation` dialog (#968/#969).
        // A clearing setter runs *after* Leave's synchronous action but *before* the `Task` it
        // spawns gets to run, so `confirmLeave()`'s `guard let community = leaveConfirmation`
        // would always see nil and silently return — no unfollow, ever.
        .alert(
            "Leave this community?",
            isPresented: Binding(
                get: { communities.leaveConfirmation != nil },
                set: { _ in }),
            presenting: communities.leaveConfirmation
        ) { community in
            Button("Leave", role: .destructive) { Task { await communities.confirmLeave() } }
            Button("Cancel", role: .cancel) { communities.cancelLeave() }
        } message: { community in
            // `community.displayName` is remote-supplied (a hostile Group's own actor-document
            // `name`, already run through `DisplayString.safe` — which strips bidi/control
            // scalars, not markdown syntax). The interpolated-`LocalizedStringKey` overload
            // markdown-parses its content, so embedding it there directly would let a Group named
            // e.g. `[Your Site](https://phish.example)` render as a live link inside a destructive
            // confirmation. `Text(String)` binds to the plain-`StringProtocol` overload instead —
            // verbatim, no markdown — matching `FollowersView`'s `Text(reason)` precedent.
            Text("This site will stop receiving posts from ")
                + Text(community.displayName ?? community.id)
                + Text(".")
        }
        // Discovery (V-5.4, #371): browse/search step feeding this same join flow, opened from
        // the magnifying-glass button beside the handle/URL bar in `sidebar`.
        .sheet(isPresented: $communities.discoveryPresented) {
            CommunityDiscoverySheet(communities: communities)
        }
    }

    /// `title` is static UI copy and localizes via the `LocalizedStringKey` overload. `detail` is
    /// pre-built `Text` rather than `String` so the call site controls whether its content
    /// localizes — mirrors `FollowersView.message(_:detail:)`. `.noSiteURL` is the only state this
    /// pane can genuinely observe (`CommunitiesModel.configure`/`resolveSite` do no network I/O,
    /// unlike `FollowersModel`'s Worker-backed `.notActivated`/`.unreachable`), so there's only
    /// ever one message here, but the shape stays parallel in case that changes. Try Again calls
    /// `retry()`, which re-resolves the site URL — what makes `.noSiteURL` recoverable without
    /// closing and reopening the window once the owner publishes.
    @ViewBuilder
    private func message(_ title: LocalizedStringKey, detail: Text) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title2)
            detail.foregroundStyle(.secondary)
            Button("Try Again") { Task { await communities.retry() } }
                .padding(.top, 4)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TextField("!community@instance or URL", text: $communities.joinHandleText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await communities.join() } }
                Button("Join") { Task { await communities.join() } }
                    .disabled(
                        communities.joinHandleText.trimmingCharacters(in: .whitespaces).isEmpty
                            || communities.isJoining)
                // Discovery (V-5.4, #371): a keyword-search alternative to typing a handle/URL
                // directly. A separate button rather than folding into the text field above — the
                // field still doubles as the target for a result the sheet hands back, matching
                // `AddRedirectSheet`'s "prefill and let the owner review" precedent rather than
                // joining silently from inside the sheet.
                Button {
                    communities.discoveryPresented = true
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .help("Find a community by keyword")
                // An icon-only button's default VoiceOver label comes from the SF Symbol's own
                // name ("magnifying glass"), which doesn't say what the button does — unlike the
                // titled `Button`s elsewhere in this file (e.g. `communityRow`'s "Leave…"). Per
                // the macOS accessibility standard (docs/mac-assed-app-spec.md).
                .accessibilityLabel("Find a community by keyword")
            }
            .padding()

            if communities.joined.isEmpty {
                // The example handle is example copy, not a real address, but the
                // `LocalizedStringKey` overload's Markdown/data-detection parsing auto-links any
                // email-shaped substring into a `mailto:` link regardless. Resolving the
                // localized value ourselves and handing it to the plain-`StringProtocol`
                // overload (`Text(String)`) skips that parsing — same mechanism as the
                // `Text(reason)`/`Text(community.displayName …)` precedents above and in
                // `FollowersView`, just applied to avoid an unwanted autolink instead of a
                // markdown-injection risk.
                Text(String(localized: "No communities joined yet — enter a handle above, like !sandbox@lemmy.sdf.org."))
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
            if let url = post.url, ActorProfileFetcher.isHTTPS(url) {
                Button("Open in Browser") { NSWorkspace.shared.open(url) }
            }
        }
    }
}

/// The Discovery sheet (V-5.4, #371): keyword search over a chosen instance's own communities,
/// one-tap join into the same path `sidebar`'s handle/URL bar uses. `instance` binds directly to
/// `AppSettings.Key.communitySearchInstance` via `@AppStorage` — the same key
/// `CommunitiesModel.discoveryInstance` reads — mirroring `AdvancedSettingsView`'s
/// `sitesRootOverride` plain-text-override pattern rather than threading the value through the
/// model.
private struct CommunityDiscoverySheet: View {
    @Bindable var communities: CommunitiesModel
    @AppStorage(AppSettings.Key.communitySearchInstance)
    private var instance: String = CommunitySearchClient.defaultInstance
    @Environment(\.dismiss) private var dismiss
    @FocusState private var queryFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Find a Community").font(.headline)

            TextField("Keyword", text: $communities.discoveryQuery)
                .textFieldStyle(.roundedBorder)
                .focused($queryFieldFocused)
                .onSubmit { Task { await communities.searchDiscovery() } }

            LabeledContent("Source") {
                // `instance`'s raw stored value can be blank (or whitespace-only) — the field
                // shows that as empty rather than silently normalizing it into the field itself
                // (typing into a field that snaps back to a default on every keystroke would make
                // it impossible to type a *new* instance from an empty start). But
                // `CommunitiesModel.discoveryInstance`/`AppSettings.communitySearchInstance` DO
                // fall back to `CommunitySearchClient.defaultInstance` for that same blank value —
                // so the placeholder names that fallback explicitly, rather than a generic
                // example, so an empty-looking field doesn't read as "search is broken" when it's
                // actually about to search the default instance.
                TextField(
                    "Defaults to \(CommunitySearchClient.defaultInstance) if blank", text: $instance
                )
                .textFieldStyle(.roundedBorder)
            }
            // The privacy stance the issue calls for (#371): this search goes only to the
            // instance above, never to an Anglesite-run directory — worth saying plainly next to
            // the field the owner controls it from.
            Text("Searches only the instance above. Anglesite doesn't run or query a directory of its own.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let discoveryErrorMessage = communities.discoveryErrorMessage {
                Label(discoveryErrorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            Group {
                if communities.isSearchingDiscovery {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if communities.discoveryResults.isEmpty {
                    Text(
                        communities.discoveryQuery.trimmingCharacters(in: .whitespaces).isEmpty
                            ? "Type a keyword and press Return to search."
                            : "No communities found."
                    )
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(communities.discoveryResults) { result in
                        discoveryRow(result)
                    }
                }
            }
            .frame(minHeight: 240)

            HStack {
                Spacer()
                Button("Close") { dismiss() }
            }
        }
        .padding()
        .frame(minWidth: 420, idealWidth: 480, minHeight: 420)
        .onAppear { queryFieldFocused = true }
    }

    @ViewBuilder
    private func discoveryRow(_ result: CommunitySearchResult) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                // `result.title`/`.name` are remote-supplied and already `DisplayString.safe`'d by
                // `CommunitySearchClient` (bidi/control scalars stripped), but that guard doesn't
                // strip markdown syntax — same reasoning as the leave-confirmation alert above, so
                // this uses `Text(String)`'s plain-`StringProtocol` overload rather than the
                // markdown-parsing `LocalizedStringKey` one.
                Text(result.title ?? result.name).font(.headline).lineLimit(1)
                Text(subtitle(for: result)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button("Join") { Task { await communities.joinFromDiscovery(result) } }
                .disabled(communities.isJoining)
        }
        .padding(.vertical, 2)
    }

    private func subtitle(for result: CommunitySearchResult) -> String {
        var text = "!\(result.name)@\(result.instance)"
        if let count = result.subscriberCount {
            text += " · \(count) member" + (count == 1 ? "" : "s")
        }
        return text
    }
}
