import Foundation

/// Grants folder access around a single unit of work for a site, then releases it.
///
/// - App target (`ANGLESITE_MAS`): resolves the site's persisted security-scoped bookmark
///   (recorded against `packageURL`; one grant covers both `Source/` and `Config/`),
///   holds the grant for the duration of `body`, then stops. Mirrors `SiteWindow.acquireGrant`
///   but short-lived, so background App Intents work with no window open. Throws
///   `AccessError.noGrant` if the site has no usable bookmark.
/// - Package tests / non-app callers without `ANGLESITE_MAS`: pass `site.sourceDirectory`
///   straight through.
public enum SiteAccess {
    /// Failures acquiring scoped access. Cases carry ready-to-show messages because the callers
    /// (background App Intents) have no window UI to elaborate — the string is the whole story
    /// the user gets.
    public enum AccessError: Error, Sendable, Equatable {
        /// No security-scoped bookmark for this site. Carries a user-facing message.
        case noGrant(String)
    }

    /// Run `body` with read/write access to the site's source directory. The `URL` passed to
    /// `body` is `site.sourceDirectory` — the Astro project tree that every subprocess
    /// (deploy, backup, audit) uses as its working directory. In the app target the bookmark resolves
    /// to `packageURL`; the scope covers the whole package, so `Source/` (= `sourceDirectory`)
    /// is accessible under it.
    public static func withScopedAccess<T: Sendable>(
        to site: SiteStore.Site,
        in store: SiteStore = .shared,
        _ body: (URL) async -> T
    ) async throws -> T {
        #if ANGLESITE_MAS
        guard let data = await store.bookmarkData(for: site.id) else {
            throw AccessError.noGrant(
                "\(site.name) has no folder grant. Open it once via Open Site… in Anglesite, then try again."
            )
        }
        let resolved = try SecurityScopedBookmark.resolve(data)
        guard resolved.url.startAccessingSecurityScopedResource() else {
            throw AccessError.noGrant(
                "Couldn't access \(site.name)'s folder. Re-add it via Open Site… in Anglesite."
            )
        }
        defer { resolved.url.stopAccessingSecurityScopedResource() }
        // A stale bookmark still resolves; re-mint while the grant is active so it survives.
        if resolved.isStale, let fresh = try? SecurityScopedBookmark.create(for: resolved.url) {
            try? await store.setBookmark(fresh, for: site.id)
        }
        return await body(site.sourceDirectory)
        #else
        return await body(site.sourceDirectory)
        #endif
    }
}
