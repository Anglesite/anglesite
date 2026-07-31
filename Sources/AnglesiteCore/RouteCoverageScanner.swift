import Foundation

/// Diffs the current published route set against the snapshot from the previous deploy
/// (`DeployedRoutesSnapshot`), flagging any route that vanished with no `redirects.json` entry
/// covering it. Pure `SiteContentGraph`/`RedirectsStore` diffing — no JS/plugin involvement,
/// unlike the rest of `PreDeployCheck`'s checks.
public enum RouteCoverageScanner {
    /// Returns one orphaned-route warning per previously-published route that is neither still
    /// published nor covered by a redirect. Warnings, not failures — removing a page can be
    /// intentional, so the owner decides (the remediation text offers both paths).
    ///
    /// - Parameters:
    ///   - currentRoutes: The route set about to be deployed.
    ///   - previousRoutes: The snapshot from the last deploy. `nil` (no snapshot yet — first
    ///     deploy, or pre-snapshot sites) returns `[]`: with no baseline there is nothing to
    ///     diff, and warning on every route would teach owners to ignore the check.
    ///   - redirectSources: `source` paths from `redirects.json`; a vanished route with a
    ///     matching redirect is covered, not orphaned.
    public static func scan(
        currentRoutes: [String],
        previousRoutes: [String]?,
        redirectSources: Set<String>
    ) -> [PreDeployCheck.ScanWarning] {
        guard let previousRoutes else { return [] }
        let current = Set(currentRoutes)
        let vanished = Set(previousRoutes).subtracting(current).subtracting(redirectSources)
        return vanished.sorted().map { route in
            PreDeployCheck.ScanWarning(
                category: .orphanedRoute,
                message: "\(route) is no longer published and has no redirect covering it.",
                remediation: "Add a redirect for \(route) in Site Settings → Redirects, or ignore if the removal is intentional."
            )
        }
    }
}
