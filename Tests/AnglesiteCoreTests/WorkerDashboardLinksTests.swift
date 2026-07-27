import Testing
import Foundation
@testable import AnglesiteCore

@Suite("WorkerDashboardLinks (#710)")
struct WorkerDashboardLinksTests {
    @Test("production logs deep link targets the worker's observability logs")
    func productionLogsURL() {
        #expect(
            WorkerDashboardLinks.productionLogsURL(workerName: "my-site").absoluteString
                == "https://dash.cloudflare.com/?to=/:account/workers/services/view/my-site/production/observability/logs")
    }

    @Test("analytics deep link targets the worker's metrics")
    func analyticsURL() {
        #expect(
            WorkerDashboardLinks.analyticsURL(workerName: "my-site").absoluteString
                == "https://dash.cloudflare.com/?to=/:account/workers/services/view/my-site/production/metrics")
    }

    @Test("worker names are percent-encoded defensively")
    func percentEncoding() {
        #expect(
            WorkerDashboardLinks.analyticsURL(workerName: "a b").absoluteString
                == "https://dash.cloudflare.com/?to=/:account/workers/services/view/a%20b/production/metrics")
    }
}
