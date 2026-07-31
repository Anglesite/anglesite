// Linux implementation of the SiteFileWatching seam. The whole file compiles out on platforms
// without Glibc.
#if canImport(Glibc)
import Foundation
import Glibc

/// Production `SiteFileWatching` backed by Linux's inotify API.
///
/// inotify watches are per-directory and non-recursive, so `start()` walks the tree and arms a
/// watch on every subdirectory (skipping `SiteIndexPaths.skippedDirectoryNames` — watching
/// `node_modules` wholesale would multiply the watch count for no reindexing benefit), then arms
/// a new watch whenever a subdirectory is created.
///
/// Structural changes — a directory appearing, disappearing, or being renamed, plus a
/// watch-queue overflow — are conservatively reported as `needsFullRescan` rather than tracked
/// file-by-file: a directory that appears may already contain files written into it before its
/// watch could be armed (inotify has no atomic watch-and-list), so per-file tracking of its
/// contents can't be trusted. This mirrors the FSEvents watcher's `MustScanSubDirs` /
/// `UserDropped` / `RootChanged` handling. Events are coalesced over the same 0.3s window
/// FSEvents uses, via a debounce timer on `queue`.
///
/// Threading: `fd`, `readSource`, `onBatch`, and `watchedDirectories` are guarded by `lock`
/// because they're written both from the calling thread (`start`/`stop`) and from `queue` (a
/// newly-created subdirectory arms its own watch from inside the event handler). The debounce
/// state (`pendingPaths`, `pendingRescan`, `flushTimer`) is confined to `queue` — it's only ever
/// touched by the read source's event handler and its own timer, both scheduled on `queue`.
public final class InotifyFileWatcher: SiteFileWatching, @unchecked Sendable {
    private let queue = DispatchQueue(label: "io.dwk.anglesite.inotifywatcher")
    private let lock = NSLock()
    private var fd: Int32 = -1
    private var readSource: DispatchSourceRead?
    private var onBatch: (@Sendable (FileChangeBatch) -> Void)?
    private var watchedDirectories: [Int32: URL] = [:]

    private var pendingPaths: Set<URL> = []
    private var pendingRescan = false
    private var flushTimer: DispatchSourceTimer?

    private static let watchMask: UInt32 = UInt32(
        IN_CREATE | IN_DELETE | IN_MODIFY | IN_MOVED_FROM | IN_MOVED_TO | IN_CLOSE_WRITE
        | IN_DELETE_SELF | IN_MOVE_SELF
    )

    /// Creates an idle watcher; no inotify fd exists until `start(root:onBatch:)`.
    public init() {}

    /// Failure to establish the watch tree.
    public enum WatchError: Error {
        /// `inotify_init1` failed — typically fd exhaustion or `fs.inotify.max_user_instances`.
        case initFailed
        /// `inotify_add_watch` failed for the directory at the associated path. On large
        /// trees the usual culprit is the `fs.inotify.max_user_watches` sysctl — one watch is
        /// consumed per directory, which is why the walk skips `node_modules` and friends.
        case addWatchFailed(String)
    }

    /// Begins watching `root` by walking the tree and arming a per-directory watch (see the
    /// type doc for why, and for what escalates to `needsFullRescan`). Batches arrive on a
    /// private serial queue after a 0.3s debounce. Calling while already watching restarts
    /// cleanly, matching `FSEventsFileWatcher`'s contract; if arming fails partway through
    /// the walk, everything is torn down (fd closed, no partial watch left running) before
    /// the error propagates.
    public func start(root: URL, onBatch: @escaping @Sendable (FileChangeBatch) -> Void) throws {
        // Tolerate being called while a previous watch is still live, matching
        // FSEventsFileWatcher's contract.
        stop()

        let newFD = inotify_init1(Int32(IN_NONBLOCK) | Int32(IN_CLOEXEC))
        guard newFD >= 0 else { throw WatchError.initFailed }

        lock.lock()
        fd = newFD
        self.onBatch = onBatch
        lock.unlock()

        do {
            try addWatches(under: root, fd: newFD)
        } catch {
            lock.lock()
            fd = -1
            self.onBatch = nil
            watchedDirectories.removeAll()
            lock.unlock()
            close(newFD)
            throw error
        }

        let source = DispatchSource.makeReadSource(fileDescriptor: newFD, queue: queue)
        source.setEventHandler { [weak self] in self?.drainEvents() }
        source.setCancelHandler { close(newFD) }
        source.resume()
        lock.lock(); readSource = source; lock.unlock()
    }

    /// Idempotent. Safe to call when nothing is running.
    public func stop() {
        lock.lock()
        let source = readSource
        readSource = nil
        onBatch = nil
        watchedDirectories.removeAll()
        fd = -1
        lock.unlock()
        guard let source else { return }
        // Drain debounce state on `queue` before cancelling, so a flush already in flight
        // can't fire into a stopped watcher. `source.cancel()` is async; the read source's
        // cancel handler closes the fd once any in-flight read completes.
        queue.sync {
            flushTimer?.cancel()
            flushTimer = nil
            pendingPaths.removeAll()
            pendingRescan = false
        }
        source.cancel()
    }

    // MARK: Watch tree setup

    private func addWatches(under directory: URL, fd: Int32) throws {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return
        }

        let wd = directory.path.withCString { inotify_add_watch(fd, $0, Self.watchMask) }
        guard wd >= 0 else { throw WatchError.addWatchFailed(directory.path) }
        lock.lock(); watchedDirectories[wd] = directory; lock.unlock()

        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]
        ) else { return }

        for entry in entries {
            guard !SiteIndexPaths.skippedDirectoryNames.contains(entry.lastPathComponent) else { continue }
            let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            // A symlinked subdirectory is skipped rather than recursed into: `isDirectoryKey`
            // resolves through the link, so an unfiltered walk could cycle back up the tree (a
            // symlink pointing at an ancestor) or fan out into an unrelated, unbounded directory
            // — either way well past `fs.inotify.max_user_watches`. FSEvents doesn't have this
            // failure mode (it watches the real filesystem tree, not a manually-walked listing),
            // so this is inotify-specific.
            guard values?.isSymbolicLink != true, values?.isDirectory == true else { continue }
            try addWatches(under: entry, fd: fd)
        }
    }

    // MARK: Event draining (runs on `queue`)

    private func drainEvents() {
        lock.lock()
        let currentFD = fd
        lock.unlock()
        guard currentFD >= 0 else { return }

        // inotify events are variable-length (a fixed header plus an optional trailing name);
        // 64 headers' worth of slack room keeps a burst of same-directory events from requiring
        // multiple `read`s in the common case without over-allocating.
        let bufferSize = 64 * (MemoryLayout<inotify_event>.size + 256)
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while true {
            let bytesRead = buffer.withUnsafeMutableBytes { ptr -> Int in
                read(currentFD, ptr.baseAddress, bufferSize)
            }
            // EAGAIN (no more data on the non-blocking fd) and any other read failure both just
            // mean "nothing left to drain right now."
            guard bytesRead > 0 else { break }

            var offset = 0
            while offset + MemoryLayout<inotify_event>.size <= bytesRead {
                let (event, name, recordSize) = buffer.withUnsafeBytes { raw -> (inotify_event, String?, Int) in
                    let eventPtr = raw.baseAddress!.advanced(by: offset).assumingMemoryBound(to: inotify_event.self)
                    let event = eventPtr.pointee
                    var name: String?
                    if event.len > 0 {
                        let nameStart = raw.baseAddress!.advanced(by: offset + MemoryLayout<inotify_event>.size)
                        name = String(cString: nameStart.assumingMemoryBound(to: CChar.self))
                    }
                    return (event, name, MemoryLayout<inotify_event>.size + Int(event.len))
                }
                handle(event: event, name: name)
                offset += recordSize
            }
        }
    }

    private func handle(event: inotify_event, name: String?) {
        if event.mask & UInt32(IN_Q_OVERFLOW) != 0 {
            // The kernel dropped events wholesale; we have no idea what changed.
            pendingRescan = true
            scheduleFlush()
            return
        }
        if event.mask & UInt32(IN_IGNORED) != 0 {
            // Watch removed (explicitly, or because its directory was deleted/moved away).
            lock.lock(); watchedDirectories.removeValue(forKey: event.wd); lock.unlock()
            return
        }

        lock.lock()
        let directory = watchedDirectories[event.wd]
        let currentFD = fd
        lock.unlock()
        guard let directory, currentFD >= 0 else { return }

        if event.mask & UInt32(IN_DELETE_SELF | IN_MOVE_SELF) != 0 {
            // The watched directory itself vanished or moved — possibly outside `root`
            // entirely. Per inotify(7), only IN_DELETE_SELF is reliably followed by an
            // automatic IN_IGNORED; a plain rename (IN_MOVE_SELF) leaves the kernel watch
            // armed on the same inode wherever it now lives, with no further event on this fd
            // if that's outside our tree. Clean up immediately rather than waiting for an
            // IN_IGNORED that may never come: drop the map entry so a moved-away directory's
            // future changes can't resolve against this stale URL, and release the kernel-side
            // watch so it doesn't sit there consuming `fs.inotify.max_user_watches` forever.
            // If this was actually an in-place rename, the kernel's `fsnotify_move()` emits
            // this IN_MOVE_SELF *before* the paired IN_MOVED_TO on the parent directory's own
            // watch, so the parent's handler (which re-walks and re-arms via `addWatches`)
            // always runs after this cleanup, never racing it.
            lock.lock(); watchedDirectories.removeValue(forKey: event.wd); lock.unlock()
            inotify_rm_watch(currentFD, event.wd)
            pendingRescan = true
            scheduleFlush()
            return
        }

        guard let name, !name.isEmpty else { return }
        let childURL = directory.appendingPathComponent(name)

        if event.mask & UInt32(IN_ISDIR) != 0 {
            guard !SiteIndexPaths.skippedDirectoryNames.contains(name) else {
                // We never watch this subtree (node_modules, .git, …), so its appearing,
                // vanishing, or being renamed has no reindexing impact — nothing to arm and
                // nothing to rescan for.
                return
            }
            if event.mask & UInt32(IN_CREATE | IN_MOVED_TO) != 0 {
                // Arm a watch on the new subtree so its own future changes are tracked. Its
                // current contents (if any raced ahead of us) are covered by the rescan below.
                try? addWatches(under: childURL, fd: currentFD)
            }
            pendingRescan = true
            scheduleFlush()
            return
        }

        pendingPaths.insert(childURL)
        scheduleFlush()
    }

    // MARK: Debounce (queue-confined)

    private func scheduleFlush() {
        guard flushTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.3)
        timer.setEventHandler { [weak self] in self?.flush() }
        timer.resume()
        flushTimer = timer
    }

    private func flush() {
        flushTimer?.cancel()
        flushTimer = nil
        guard !pendingPaths.isEmpty || pendingRescan else { return }
        let batch = FileChangeBatch(paths: Array(pendingPaths), needsFullRescan: pendingRescan)
        pendingPaths.removeAll()
        pendingRescan = false
        lock.lock(); let handler = onBatch; lock.unlock()
        handler?(batch)
    }
}
#endif
