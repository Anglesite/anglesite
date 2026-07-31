import Foundation

/// Composes the URL the live-preview WKWebView should load when a page route is requested
/// (e.g. by `PreviewSiteIntent`). Pure and `AnglesiteCore`-scoped so it's unit-testable on CI —
/// the App-target glue that calls it (`PreviewModel`) is not.
public enum PreviewNavigation {
    /// The absolute preview URL for `route` against the dev-server `base`.
    /// `route` is treated as a site-absolute path; `base`'s scheme/host/port are preserved.
    /// An empty route or `"/"` returns `base` (the site root). A query string or fragment in
    /// `route` (e.g. `/about?preview=1#top`) is carried over to the result rather than being
    /// percent-encoded into the path.
    public static func targetURL(base: URL, route: String) -> URL {
        let trimmed = route.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != "/" else { return base }
        let normalized = trimmed.hasPrefix("/") ? trimmed : "/" + trimmed
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false),
              let routeComps = URLComponents(string: normalized) else { return base }
        comps.path = routeComps.path
        comps.query = routeComps.query
        comps.fragment = routeComps.fragment
        return comps.url ?? base
    }

    /// Query-parameter key the app appends to force `EsiInclude`'s dev-preview shim into the
    /// "unprocessed" state (spec §4a) — must match `esi-dev-shim.ts`'s `esiPreviewIsUnprocessed`.
    public static let esiPreviewQueryKey = "esiPreview"

    /// The value paired with ``esiPreviewQueryKey`` to request the "unprocessed" state — must
    /// also match `esi-dev-shim.ts`, which string-compares it when deciding whether to leave
    /// `<esi:include>` tags unexpanded.
    public static let esiPreviewUnprocessedValue = "unprocessed"

    /// Appends (or replaces) the `esiPreview=unprocessed` query item on `url` when `unprocessed`
    /// is `true`; returns `url` unchanged when `false`. Existing query items are preserved.
    public static func applyingEsiPreviewMode(_ url: URL, unprocessed: Bool) -> URL {
        guard unprocessed else { return url }
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = (comps.queryItems ?? []).filter { $0.name != esiPreviewQueryKey }
        items.append(URLQueryItem(name: esiPreviewQueryKey, value: esiPreviewUnprocessedValue))
        comps.queryItems = items
        return comps.url ?? url
    }
}
