import Foundation

/// Cloudflare-dashboard deep links for one deployed site Worker (#710, design doc §8). Uses the
/// dashboard's `?to=` deep-link resolver with its `:account` placeholder — the same mechanism as
/// `WebsiteAnalyticsAsset.dashboardURL` — so the app never needs to know the account ID. The
/// worker-detail paths follow the dashboard's `workers/services/view/<name>/production` scheme;
/// a drifted subpath falls back to the worker's overview page, so a stale path degrades to "one
/// more click", never a dead end. Centralized here so a Cloudflare path change is a one-file fix.
public enum WorkerDashboardLinks {
    /// The worker's production logs (Observability ▸ Logs).
    public static func productionLogsURL(workerName: String) -> URL {
        deepLink(to: "/workers/services/view/\(encoded(workerName))/production/observability/logs")
    }

    /// The worker's production metrics/analytics.
    public static func analyticsURL(workerName: String) -> URL {
        deepLink(to: "/workers/services/view/\(encoded(workerName))/production/metrics")
    }

    private static func deepLink(to path: String) -> URL {
        URL(string: "https://dash.cloudflare.com/?to=/:account\(path)")!
    }

    private static func encoded(_ workerName: String) -> String {
        workerName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? workerName
    }
}
