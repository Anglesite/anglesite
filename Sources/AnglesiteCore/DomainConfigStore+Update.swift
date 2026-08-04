import Foundation

/// Shared load/mutate/save shape for `Source/anglesite.json` write-through producers (#1188).
/// `DomainOperations.writeThroughAdd`/`writeThroughRemove`, `HardenExecutor.writeThroughEdge`,
/// `DomainIntentRecorder.recordTransferIntent`/`recordBuyIntent`, `EmailSetupExecutor.apply`, and
/// `DeployCoordinator.syncWorkerActivationToAnglesiteJSON` each independently hand-rolled "load the
/// current `DomainConfig`, mutate one section, best-effort save" — this collapses that into one
/// place so the shape can't drift further across producers, and gives the next one a single
/// pattern to route through. Kept in its own file (not `DomainConfigStore.swift`'s existing body),
/// matching #1170's own constraint of not touching that file.
extension DomainConfigStore {
    /// Loads the current config for `sourceDirectory` (falling back to an empty `DomainConfig` if
    /// the file is absent or fails to decode — mirrors every existing call site's `(try? …) ??
    /// DomainConfig()` fallback), applies `mutate` in place, and saves the result.
    ///
    /// The save is best-effort by default: most callers are finishing up after an already-succeeded
    /// network call, where a disk failure here (full disk, permissions, a hand-corrupted file) must
    /// never turn that success into a reported failure. Returns whether the save succeeded so a
    /// caller that does need to know (e.g. to decide whether a *second* write elsewhere should also
    /// happen) can check it; every current best-effort caller ignores it via `@discardableResult`.
    ///
    /// **Not atomic across the whole load-mutate-save sequence** (#1255): `load()` and `save()` are
    /// still two separate calls here, so two concurrent `update()` calls that both mutate the *same*
    /// top-level section can each `load()` a stale snapshot before either `save()`s, silently
    /// dropping whichever one saves first — the #1189/#1253 lock only protects `save()`'s own
    /// read-merge-write, not this gap. Not currently reachable by any producer routed through here
    /// (no two same-section write-throughs fire concurrently today); #1255 tracks closing it once
    /// #1253's lock lands, by moving this sequence into `DomainConfigStore.swift` itself so it can
    /// hold that lock across the full load+mutate+save.
    @discardableResult
    public static func update(
        sourceDirectory: URL, _ mutate: (inout DomainConfig) -> Void
    ) -> Bool {
        let store = DomainConfigStore(sourceDirectory: sourceDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        mutate(&config)
        return (try? store.save(config)) != nil
    }
}
