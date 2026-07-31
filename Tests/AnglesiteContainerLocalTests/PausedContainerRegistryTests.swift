import Testing
import Foundation
@testable import AnglesiteContainer

struct PausedContainerRegistryTests {
    @Test
    func evictsOldestOnlyWhenAtCapacity() {
        #expect(PausedContainerRegistry.siteIDToEvict(order: [], capacity: 2) == nil)
        #expect(PausedContainerRegistry.siteIDToEvict(order: ["a"], capacity: 2) == nil)
        #expect(PausedContainerRegistry.siteIDToEvict(order: ["a", "b"], capacity: 2) == "a")
        #expect(PausedContainerRegistry.siteIDToEvict(order: ["a", "b", "c"], capacity: 2) == "a")
    }

    @Test
    func reclaimReturnsNilForUnknownSiteID() async {
        let registry = PausedContainerRegistry()
        #expect(await registry.reclaim(siteID: "never-registered") == nil)
    }
}
