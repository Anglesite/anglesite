import Testing
import Foundation
@testable import AnglesiteCore

struct AnglesiteTokenTemplateTests {
    @Test("the template keeps every permission the old Workers-deploy template had")
    func supersetOfDeployTemplate() {
        let keys = Set(AnglesiteTokenTemplate.permissionGroups.map(\.key))
        for legacy in ["workers_routes", "workers_scripts", "workers_kv_storage", "workers_tail", "workers_r2"] {
            #expect(keys.contains(legacy))
        }
    }

    @Test("the template covers the new integration surface")
    func coversNewServices() {
        let keys = Set(AnglesiteTokenTemplate.permissionGroups.map(\.key))
        for needed in ["d1", "zone_settings", "dns", "zone_waf", "response_compression",
                       "challenge_widgets", "email_routing_rules", "email_routing_addresses",
                       "zaraz", "page_shield", "analytics", "registrar"] {
            #expect(keys.contains(needed), "missing permission group: \(needed)")
        }
    }

    @Test("createTokenURL lands on the dashboard token page with name + permission pre-fill")
    func urlShape() throws {
        let components = try #require(URLComponents(url: AnglesiteTokenTemplate.createTokenURL,
                                                    resolvingAgainstBaseURL: false))
        #expect(components.host == "dash.cloudflare.com")
        #expect(components.path == "/profile/api-tokens")
        let items = components.queryItems ?? []
        #expect(items.contains { $0.name == "name" && $0.value == "Anglesite" })
        let permissions = items.first { $0.name == "permissionGroupKeys" }?.value ?? ""
        #expect(permissions.contains(#""key":"workers_scripts""#))
        #expect(permissions.contains(#""key":"registrar""#))
    }

    @Test("oauthScope space-joins every permission group key, one scope per group, no duplicates")
    func oauthScopeMatchesPermissionGroups() {
        let scopeKeys = AnglesiteTokenTemplate.oauthScope.split(separator: " ").map(String.init)
        #expect(Set(scopeKeys) == Set(AnglesiteTokenTemplate.permissionGroups.map(\.key)))
        #expect(scopeKeys.count == AnglesiteTokenTemplate.permissionGroups.count)
    }
}
