import Foundation

/// Shared load/mutate/save shape for `Source/anglesite.json` write-through producers (#1188).
/// `DomainOperations.writeThroughAdd`/`writeThroughRemove`, `HardenExecutor.writeThroughEdge`,
/// `DomainIntentRecorder.recordTransferIntent`/`recordBuyIntent`, `EmailSetupExecutor.apply`, and
/// `DeployCoordinator.syncWorkerActivationToAnglesiteJSON` each independently hand-rolled "load the
/// current `DomainConfig`, mutate one section, best-effort save" — this collapses that into one
/// place so the shape can't drift further across producers, and gives the next one a single
/// pattern to route through. This file stays the producer-facing `sourceDirectory`-based entry
/// point (the #1170 file-boundary convention for producer call sites), but as of #1255 the actual
/// load-mutate-save sequence lives in `DomainConfigStore.update(_:)` in `DomainConfigStore.swift`
/// itself — the per-file lock (#1189/#1253) it needs to hold across that whole sequence is private
/// to that file, so the sequence had to move there too.
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
    /// Atomic across the whole load-mutate-save sequence (#1255): this delegates to
    /// `DomainConfigStore.update(_:)`, which holds the #1189/#1253 per-file lock from `load()`
    /// through `save()`, not just around `save()`'s own read-merge-write. Two concurrent calls that
    /// both mutate the same top-level section can no longer both `load()` the same stale snapshot
    /// before either saves.
    @discardableResult
    public static func update(
        sourceDirectory: URL, _ mutate: (inout DomainConfig) -> Void
    ) -> Bool {
        DomainConfigStore(sourceDirectory: sourceDirectory).update(mutate)
    }
}
