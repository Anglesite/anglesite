// Darwin implementation of the SiteFileWatching seam. The whole file compiles out on
// platforms without the FSEvents API (macOS-only — iOS ships a CoreServices module, but
// without `FSEventStream*`).
#if os(macOS)
import Foundation
import CoreServices

/// Production `SiteFileWatching` backed by the CoreServices FSEvents API. Coalescing latency
/// (0.3s) doubles as the debounce, so no separate timer is needed. State (`stream`, `onBatch`)
/// is guarded by `lock` because the FSEvents callback fires on `queue` while `start`/`stop` are
/// called from the owning actor.
public final class FSEventsFileWatcher: SiteFileWatching, @unchecked Sendable {
    private let queue = DispatchQueue(label: "io.dwk.anglesite.fswatcher")
    private let lock = NSLock()
    private var stream: FSEventStreamRef?
    private var onBatch: (@Sendable (FileChangeBatch) -> Void)?

    /// Creates an idle watcher; no stream exists until `start(root:onBatch:)`.
    public init() {}

    /// Failure to establish the watch.
    public enum WatchError: Error {
        /// `FSEventStreamCreate` returned NULL — the only FSEvents call in this watcher that
        /// reports failure by return value, so the only creation-time error to surface.
        case streamCreationFailed
    }

    /// Begins watching `root` recursively (FSEvents watches whole subtrees natively — no
    /// manual walk, unlike the inotify implementation). Batches arrive on a private serial
    /// queue after the 0.3s coalescing window; events carrying FSEvents' "history is
    /// incomplete" flags (scan-subdirs, dropped events, root changed, mount/unmount) set
    /// `needsFullRescan` instead of pretending the per-path list is trustworthy. Calling
    /// while already watching restarts cleanly (tears the old stream down first).
    public func start(root: URL, onBatch: @escaping @Sendable (FileChangeBatch) -> Void) throws {
        // Tolerate being called while a previous stream is still live: tear it down first so we
        // never orphan an FSEventStreamRef (which would leak and silently cut off its callback).
        stop()

        lock.lock()
        self.onBatch = onBatch
        lock.unlock()

        // FSEvents holds its own strong reference to `self` for the stream's lifetime via the
        // retain/release callbacks below: `info` is passed +0 and the retain callback takes the
        // +1. That keeps `self` alive while callbacks are in flight on `queue`, closing the
        // use-after-free window that `passUnretained` + nil callbacks would leave (a queued
        // callback dereferencing a deallocated watcher). The reference is balanced by
        // `FSEventStreamRelease` in `stop()`, so `stop()` MUST be called to release the watcher —
        // every owner does on teardown.
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: { rawSelf in
                guard let rawSelf else { return nil }
                return UnsafeRawPointer(Unmanaged<FSEventsFileWatcher>.fromOpaque(rawSelf).retain().toOpaque())
            },
            release: { rawSelf in
                guard let rawSelf else { return }
                Unmanaged<FSEventsFileWatcher>.fromOpaque(rawSelf).release()
            },
            copyDescription: nil
        )
        let flags = UInt32(
            kFSEventStreamCreateFlagFileEvents
            | kFSEventStreamCreateFlagNoDefer
            | kFSEventStreamCreateFlagUseCFTypes
        )
        let callback: FSEventStreamCallback = { _, info, count, eventPaths, eventFlags, _ in
            guard let info else { return }
            let watcher = Unmanaged<FSEventsFileWatcher>.fromOpaque(info).takeUnretainedValue()
            // UseCFTypes => eventPaths is a CFArray of CFString.
            let paths = (unsafeBitCast(eventPaths, to: NSArray.self) as? [String]) ?? []
            var urls: [URL] = []
            var needsRescan = false
            let rescanMask = FSEventStreamEventFlags(
                kFSEventStreamEventFlagMustScanSubDirs
                | kFSEventStreamEventFlagUserDropped
                | kFSEventStreamEventFlagKernelDropped
                | kFSEventStreamEventFlagRootChanged
                | kFSEventStreamEventFlagMount
                | kFSEventStreamEventFlagUnmount
            )
            for i in 0..<count {
                if eventFlags[i] & rescanMask != 0 { needsRescan = true }
                if i < paths.count { urls.append(URL(fileURLWithPath: paths[i])) }
            }
            watcher.lock.lock()
            let handler = watcher.onBatch
            watcher.lock.unlock()
            handler?(FileChangeBatch(paths: urls, needsFullRescan: needsRescan))
        }

        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &context,
            [root.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.3, flags
        ) else {
            lock.lock(); self.onBatch = nil; lock.unlock()
            throw WatchError.streamCreationFailed
        }
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
        lock.lock(); self.stream = stream; lock.unlock()
    }

    /// Idempotent. Safe to call when nothing is running. Not callable from the FSEvents callback
    /// itself (the callback dispatches a `Task` rather than re-entering), so the `queue.sync` hop
    /// below cannot deadlock.
    public func stop() {
        lock.lock()
        let s = stream
        stream = nil
        onBatch = nil
        lock.unlock()
        guard let s else { return }
        // Stop + invalidate on the stream's own dispatch queue, per FSEvents' threading contract.
        // Because `queue` is serial, this also drains any in-flight callback before we invalidate,
        // so no callback runs afterward. `FSEventStreamRelease` (which fires the release callback
        // that drops FSEvents' strong ref to `self`) runs off-queue to avoid re-entrancy.
        queue.sync {
            FSEventStreamStop(s)
            FSEventStreamInvalidate(s)
        }
        FSEventStreamRelease(s)
    }
}
#endif
