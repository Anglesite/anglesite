import Foundation
import Testing
@testable import AnglesiteCore

@Suite("WorkersDevStatusCenter")
struct WorkersDevStatusCenterTests {
    @Test("update then snapshot round-trips a session")
    func updateSnapshotRoundTrip() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        let sessions = await center.snapshot()
        #expect(sessions == [WorkersDevSession(siteID: "s1", displayName: "My Site", status: .starting)])
    }

    @Test("latest update per site wins")
    func latestUpdateWins() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        let url = URL(string: "http://127.0.0.1:51003")!
        await center.update(siteID: "s1", displayName: "My Site", status: .running(url: url))
        #expect(await center.snapshot() == [
            WorkersDevSession(siteID: "s1", displayName: "My Site", status: .running(url: url))
        ])
    }

    @Test("remove drops the session; removing an absent site is a no-op")
    func removeDropsSession() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        await center.remove(siteID: "s1")
        #expect(await center.snapshot().isEmpty)
        await center.remove(siteID: "never-added")  // must not crash or broadcast
        #expect(await center.snapshot().isEmpty)
    }

    @Test("snapshot is sorted by displayName then siteID for stable UI order")
    func snapshotSorted() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "b", displayName: "Zeta", status: .starting)
        await center.update(siteID: "a", displayName: "Alpha", status: .starting)
        #expect(await center.snapshot().map(\.siteID) == ["a", "b"])
    }

    @Test("subscribe replays the current snapshot, then streams each change")
    func subscribeReplaysThenStreams() async {
        let center = WorkersDevStatusCenter()
        await center.update(siteID: "s1", displayName: "My Site", status: .starting)
        let subscription = await center.subscribe()
        var iterator = subscription.stream.makeAsyncIterator()
        let first = await iterator.next()
        #expect(first == [WorkersDevSession(siteID: "s1", displayName: "My Site", status: .starting)])
        await center.remove(siteID: "s1")
        let second = await iterator.next()
        #expect(second == [])
        subscription.cancel()
    }

    @Test("cancel unregisters the subscriber")
    func cancelUnregisters() async throws {
        let center = WorkersDevStatusCenter()
        let subscription = await center.subscribe()
        subscription.cancel()
        // onTermination unregisters via a Task hop; poll briefly (a bounded poll on an async
        // unregistration, mirroring LogCenter's own tests).
        for _ in 0..<50 {
            if await center.subscriberCount() == 0 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(await center.subscriberCount() == 0)
    }
}
