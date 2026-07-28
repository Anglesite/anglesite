import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

@MainActor
@Suite struct ScriptSyncModelTests {
    private let fileA = TemplateScriptsDivergence(relativePath: "scripts/a.ts", templateHash: "hash-a")
    private let fileB = TemplateScriptsDivergence(relativePath: "scripts/b.ts", templateHash: "hash-b")

    @Test func resolvingOneOfTwoRowsRemovesItWithoutFinishing() {
        var resolved: [(TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision)] = []
        var finished = false
        let model = ScriptSyncModel(
            divergences: [fileA, fileB],
            onResolve: { resolved.append(($0, $1)) },
            onFinished: { finished = true }
        )

        model.update(fileA)

        #expect(resolved.count == 1)
        #expect(resolved[0].0 == fileA)
        #expect(resolved[0].1 == .update)
        #expect(model.pending == [fileB])
        #expect(finished == false)
    }

    @Test func resolvingEveryRowFiresOnFinishedExactlyOnce() {
        var finishedCount = 0
        let model = ScriptSyncModel(
            divergences: [fileA, fileB],
            onResolve: { _, _ in },
            onFinished: { finishedCount += 1 }
        )

        model.keepMine(fileA)
        #expect(finishedCount == 0)
        model.update(fileB)
        #expect(finishedCount == 1)
        #expect(model.pending.isEmpty)
    }

    @Test func resolvingAfterAlreadyEmptyDoesNotRefireOnFinished() {
        var finishedCount = 0
        let model = ScriptSyncModel(
            divergences: [fileA],
            onResolve: { _, _ in },
            onFinished: { finishedCount += 1 }
        )

        model.update(fileA)
        #expect(finishedCount == 1)

        // Redundant resolve after pending is already empty must not re-fire onFinished.
        model.update(fileA)
        #expect(finishedCount == 1)
    }

    @Test func redundantResolveOfAnAlreadyResolvedDivergenceForwardsNoSecondDecision() {
        var resolvedCount = 0
        let model = ScriptSyncModel(
            divergences: [fileA],
            onResolve: { _, _ in resolvedCount += 1 },
            onFinished: {}
        )

        model.update(fileA)
        #expect(resolvedCount == 1)

        // fileA is no longer in `pending` — a second tap (e.g. a stale UI callback) must not
        // forward a second, possibly contradictory decision.
        model.keepMine(fileA)
        #expect(resolvedCount == 1)
    }
}
