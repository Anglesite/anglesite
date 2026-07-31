// Sources/AnglesiteCore/IntegrationScaffolder.swift
import Foundation

/// Applies an `OperationPlan` to a site's `Source/` directory idempotently,
/// streaming progress as `SetupStep` values. The only writer in the
/// bucket-3 integration framework.
public actor IntegrationScaffolder {
    /// One progress event in an apply run. `done` and `failed` are terminal; `warning` is
    /// informational and never stops the run.
    public enum SetupStep: Sendable, Equatable {
        /// File-creation, injection, and append steps are being applied to `Source/`.
        case writingFiles
        /// The batched `.site-config` mutations are being written (a single read-modify-write).
        case configuring
        /// Terminal: every step applied — or was skipped idempotently — for this integration.
        case done(integrationID: String)
        /// Non-fatal degradation, e.g. an owner-edited file was left untouched instead of
        /// being overwritten. `step` names the phase the warning belongs to.
        case warning(step: String, message: String)
        /// Terminal: the run stopped at `step` with a user-presentable `message`. Writes from
        /// earlier steps are left in place — re-running the same plan is safe because every
        /// step is idempotent.
        case failed(step: String, message: String)
    }

    private let fileManager: FileManager
    /// Creates a scaffolder that writes through `fileManager` — injectable so tests can
    /// substitute a throwing or in-memory file manager.
    public init(fileManager: FileManager = .default) { self.fileManager = fileManager }

    /// Applies `plan`'s steps under `sourceDirectory`, yielding progress until a terminal
    /// `done` or `failed` event.
    ///
    /// Idempotent by design: a file that already exists with identical contents is rewritten
    /// harmlessly, while a file the owner has since edited is skipped with a `warning` rather
    /// than clobbered — the owner's copy always wins. All `.site-config` mutations across the
    /// plan are deferred and batched into one read-modify-write at the end, so two config
    /// steps in the same plan can't race each other into a lost update.
    ///
    /// `nonisolated` so callers get the stream synchronously; the actual work hops onto the
    /// actor inside the stream's backing task.
    public nonisolated func apply(_ plan: OperationPlan, in sourceDirectory: URL) -> AsyncStream<SetupStep> {
        AsyncStream(bufferingPolicy: .unbounded) { continuation in
            Task {
                await self.run(plan, in: sourceDirectory) { continuation.yield($0) }
                continuation.finish()
            }
        }
    }

    private func run(_ plan: OperationPlan, in source: URL, emit: @Sendable (SetupStep) -> Void) async {
        for w in plan.warnings { emit(.warning(step: "plan", message: w.message)) }
        emit(.writingFiles)
        for step in plan.steps {
            switch step {
            case .createFile(let rel, let contents):
                let url = source.appendingPathComponent(rel)
                do {
                    if fileManager.fileExists(atPath: url.path) {
                        let existing = try String(contentsOf: url, encoding: .utf8)
                        if existing != contents {
                            emit(.warning(step: "writingFiles", message: "Left your edited \(rel) untouched."))
                            continue
                        }
                    } else {
                        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    }
                    try contents.write(to: url, atomically: true, encoding: .utf8)
                } catch { return emit(.failed(step: "writingFiles", message: humanize(error))) }

            case .injectAnchor(let rel, let anchor, let id, let snippet, let style):
                let url = source.appendingPathComponent(rel)
                do {
                    let content = try String(contentsOf: url, encoding: .utf8)
                    switch MarkerInjector.inject(snippet: snippet, withID: id, atAnchor: anchor, into: content, style: style) {
                    case .success(let updated): try updated.write(to: url, atomically: true, encoding: .utf8)
                    case .failure(let f): return emit(.failed(step: "writingFiles", message: "\(rel): \(f)"))
                    }
                } catch { return emit(.failed(step: "writingFiles", message: humanize(error))) }

            case .appendLine(let rel, let line):
                let url = source.appendingPathComponent(rel)
                do {
                    var current = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
                    if !current.isEmpty, !current.hasSuffix("\n") { current += "\n" }
                    current += line
                    if !current.hasSuffix("\n") { current += "\n" }
                    try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try current.write(to: url, atomically: true, encoding: .utf8)
                } catch { return emit(.failed(step: "writingFiles", message: humanize(error))) }

            case .upsertConfig, .addCSP:
                // Config mutations are batched below; nothing to do per-step here.
                continue
            }
        }

        // Batch all config mutations into a single read-modify-write to avoid lost-update races.
        let configSteps = plan.steps.filter { if case .upsertConfig = $0 { return true }
                                              if case .addCSP = $0 { return true }
                                              return false }
        if !configSteps.isEmpty {
            emit(.configuring)
            let url = source.appendingPathComponent(".site-config")
            var current = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            for step in configSteps {
                switch step {
                case .upsertConfig(let kvs):
                    current = SiteConfigFile.upsert(kvs.map { ($0.key, $0.value) }, into: current)
                case .addCSP(let domains):
                    current = SiteConfigFile.addCSPDomains(domains, into: current)
                default: break
                }
            }
            do { try current.write(to: url, atomically: true, encoding: .utf8) }
            catch { return emit(.failed(step: "configuring", message: humanize(error))) }
        }

        emit(.done(integrationID: plan.integrationID.rawValue))
    }

    private func humanize(_ error: Error) -> String { (error as NSError).localizedDescription }
}
