import SwiftUI
import AppKit
import CoreGraphics
import ImageIO
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
                    detail: Text("Publish it at least once, then followers will appear here."))
            case .notActivated:
                message(
                    "The Fediverse isn't turned on for this site",
                    detail: Text("Turn on the Fediverse in Settings ▸ Workers, then publish again."))
            case .unreachable(let reason):
                // `reason` is server-supplied (HTTP body / error description) — untrusted remote
                // content, never a localization key or format string. `Text(reason)` binds to the
                // `StringProtocol` overload and renders it verbatim.
                message("Couldn't reach this site", detail: Text(reason))
            }
        }
        .navigationSubtitle("Followers")
        .task { if followers.state == .idle { await followers.load() } }
        .onDisappear { followers.saveCacheNow() }
    }

    @ViewBuilder
    private var loadedContent: some View {
        VStack(spacing: 0) {
            // Refresh lives inline rather than in the window toolbar, matching
            // `MicrosubReaderView`'s inline "Sign Out" — the customizable toolbar (#518) is
            // owned by the window, and a pane-scoped item doesn't belong in it. Hoisted out of
            // the empty/non-empty split below so the empty state ("No followers yet") isn't a
            // dead end: without it, an owner watching for their first follower had no way to
            // re-check from inside the pane.
            HStack {
                Text("\(followers.totalItems) followers").font(.headline)
                Spacer()
                Button("Refresh", systemImage: "arrow.clockwise") {
                    Task { await followers.refresh() }
                }
            }
            .padding()

            if followers.rows.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(followers.rows) { row in
                        followerRow(row)
                    }
                    if followers.canLoadMore {
                        // Disabled while a page is in flight: two rapid clicks would append the
                        // same page twice and hand `ForEach` duplicate IDs.
                        Button("Load More") { Task { await followers.loadMore() } }
                            .disabled(followers.isLoadingMore)
                    }
                    // A paging failure is additive, not fatal — it annotates the list instead of
                    // replacing it, so the rows already loaded stay reachable.
                    if let failure = followers.loadMoreFailure {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Couldn't load more followers")
                            // Server-supplied, like `.unreachable`'s reason: rendered verbatim
                            // via the `StringProtocol` overload, never as a localization key.
                            Text(failure).font(.caption).foregroundStyle(.secondary)
                        }
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
        FollowerAvatar(url: row.profile?.iconURL, loader: followers.avatarLoader)
    }

    /// `title` is static UI copy and localizes via the `LocalizedStringKey` overload. `detail` is
    /// pre-built `Text` rather than `String` so each call site controls whether its content
    /// localizes (static copy: a `Text` built from a literal) or renders verbatim (the
    /// `.unreachable` case's server-supplied reason: `Text(reason)`, which must never be treated
    /// as a localization key).
    ///
    /// Note the wording above deliberately avoids writing a quoted literal after `Text(` —
    /// `scripts/check-localization-catalog.sh` is a regex scanner that doesn't strip comments, so
    /// a prose example of that shape reads as a real, uncataloged call site and fails CI (#811).
    ///
    /// Every error state gets a Try Again button: `.noSiteURL` and `.notActivated` both tell the
    /// owner to go do something, so the pane has to be able to notice they did it. `retry()`
    /// re-resolves the site URL, which is what makes `.noSiteURL` genuinely recoverable.
    @ViewBuilder
    private func message(_ title: LocalizedStringKey, detail: Text) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title2)
            detail.foregroundStyle(.secondary)
            Button("Try Again") { Task { await followers.retry() } }
                .padding(.top, 4)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// One follower's avatar, loaded through `AnglesiteCore`'s capped `AvatarLoader`.
///
/// Deliberately not `AsyncImage`: that would hand a follower-chosen URL to `URLSession.shared`
/// with no byte cap, no wall-clock deadline, and no bound on decoded pixel dimensions — a
/// follower could serve a 200 MB file or a decompression bomb as their avatar, and several
/// visible rows could do it at once. `AvatarLoader` bounds the transfer; the decode below bounds
/// the pixels and runs off the MainActor.
// Internal (not `private`) so `Tests/AnglesiteAppTests` can `@testable import AnglesiteAppCore`
// and exercise `dimensionsWithinBound(_:)` directly — the decompression-bomb guard this type
// exists to enforce should not ship unverified.
struct FollowerAvatar: View {
    let url: URL?
    let loader: AvatarLoader

    @State private var image: CGImage?

    var body: some View {
        Group {
            if let image {
                // `decorative:` matches `.accessibilityHidden(true)` below — no alt text is
                // wanted here, and none of it would be trustworthy anyway.
                Image(decorative: image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Image(systemName: "person.crop.circle").resizable().foregroundStyle(.tertiary)
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(.circle)
        // Purely decorative in both states (loaded image and placeholder): the row's name and
        // handle carry the information, so VoiceOver should skip this rather than announce
        // "person crop circle" before every row.
        .accessibilityHidden(true)
        .task(id: url) {
            image = nil
            guard let url else { return }
            // Any failure — unreachable host, oversize body, insecure redirect, undecodable
            // bytes — falls back to the placeholder, exactly like a failed profile fetch falls
            // back to the derived handle.
            image = await Self.load(url, loader: loader)?.image
        }
    }

    /// `CGImage` is immutable once created, so it crosses the isolation boundary safely. Stated
    /// here rather than leaned on from a framework conformance.
    private struct Decoded: @unchecked Sendable { let image: CGImage }

    private nonisolated static func load(_ url: URL, loader: AvatarLoader) async -> Decoded? {
        guard let data = try? await loader.data(for: url) else { return nil }
        // Detached so neither the decode nor the downsample runs on the MainActor: this is the
        // expensive half, and it is being handed attacker-chosen bytes.
        return await Task.detached(priority: .utility) { decode(data) }.value
    }

    /// Decodes to at most ``maximumPixelSize`` on the long edge. `CGImageSourceCreateThumbnailAtIndex`
    /// genuinely subsamples during decode for JPEG (DCT scaling) — but for PNG/GIF, ImageIO
    /// generally decodes the *full* raster before downsampling, so the thumbnail path alone
    /// wouldn't stop a small PNG that declares enormous dimensions from spiking memory during that
    /// decode. ``dimensionsWithinBound(_:)`` closes that gap by rejecting the declared dimensions
    /// up front, before any raster is decoded.
    private nonisolated static func decode(_ data: Data) -> Decoded? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        guard dimensionsWithinBound(source) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return nil }
        return Decoded(image: image)
    }

    /// Rejects an image whose *declared* pixel dimensions exceed a sane bound before
    /// ``decode(_:)`` asks ImageIO to create a thumbnail. `CGImageSourceCopyPropertiesAtIndex`
    /// reads only the format's header metadata — it does not decode the raster — so this check is
    /// cheap even against a hostile file. Missing dimensions are treated as a rejection rather
    /// than an approval: an image this code can't measure gets the placeholder, not a decode.
    // Internal (not `private`) for the same testability reason as the enclosing type.
    nonisolated static func dimensionsWithinBound(_ source: CGImageSource) -> Bool {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { return false }
        return width <= maximumDeclaredPixelDimension && height <= maximumDeclaredPixelDimension
    }

    /// The avatar renders at 32pt; 128px covers a 3× display with room to spare.
    private nonisolated static let maximumPixelSize = 128

    /// Generous enough for any real-world avatar (even an uncropped full-resolution photo) while
    /// rejecting the pathological case a decompression bomb relies on: a file that is small on the
    /// wire but declares e.g. 50000×50000 pixels of raster to decode.
    // Internal (not `private`) for the same testability reason as the enclosing type.
    nonisolated static let maximumDeclaredPixelDimension = 4096
}
