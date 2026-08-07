import SwiftUI
import AppKit
import AnglesiteCore

/// Slide-up drawer that hosts a deploy in progress and its terminal result.
///
/// Three states drive the body:
///   - `.running`  → phase progress strip + streaming log
///   - `.succeeded` → deployed URL with Copy / Open buttons + log
///   - `.failed`   → reason banner + log + Copy-log
///
/// The `.blocked`, `.workerNameConflict`, and `.webmentionPaidPlanConfirmationNeeded` phases are
/// each rendered by their own modal sheet, not here — by the time this drawer is on screen, the
/// deploy has either reached wrangler or failed in a way the user might want to read about.
struct DeployDrawerView: View {
    @Bindable var model: DeployModel
    let siteName: String
    /// Opens the Connect a Domain sheet (#1180) — wired to `SiteWindowModel.connectDomain.openSheet()`
    /// by `SiteWindow`. Threaded as a closure (matching `AuditSheetView`'s `onRunAgain`) rather than
    /// reaching into `SiteWindowModel` directly, since this view is only ever handed `DeployModel`.
    let onConnectDomain: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            failureSummarySection
            if hasFailureSummaryContent {
                Divider()
            }
            logScroller
            Divider()
            footer
        }
        .frame(maxWidth: .infinity)
        .frame(height: 320)
        .background(.regularMaterial)
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: 10) {
            statusIcon
            VStack(alignment: .leading, spacing: 1) {
                if case .succeeded(let url, _) = model.phase {
                    Link(destination: url) {
                        Text(headerTitle).font(.headline)
                    }
                } else {
                    Text(headerTitle).font(.headline)
                }
                if let subtitle = headerSubtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                if case .running = model.phase, let milestone = model.currentMilestone {
                    Text(milestone).font(.caption).foregroundStyle(.secondary)
                }
                if case .succeeded = model.phase, case .dirty = model.sourceBundleStatus {
                    Text("Code changes not yet deployed to the CMS bundle.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if case .succeeded = model.phase, case .notConnected(let hostname) = model.domainAttachStatus {
                    Text("\(hostname) isn't connected yet — add it to Cloudflare and point its nameservers there, then redeploy.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                // Mirrors the `.notConnected` caption above. The conflict sheet
                // (`domainConflictPresented`) only fires for a foreground deploy, so a conflict
                // discovered during a background/automatic deploy would otherwise never reach the
                // user at all — this caption is the fallback that survives past that gate.
                if case .succeeded = model.phase, case .conflict(let hostname, let ownedBy) = model.domainAttachStatus {
                    Text("\(hostname) is already connected to another site (\(ownedBy)) — not used for this deploy.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                // Markdown for Agents (#1247) requires a Cloudflare Pro plan or higher — surfaced
                // so a Free-plan owner who turned the toggle on learns it isn't actually taking
                // effect, instead of only finding out by reading the debug log.
                if case .succeeded = model.phase, case .failed(let hostname) = model.markdownForAgentsStatus {
                    Text("Couldn't enable Markdown for Agents for \(hostname) — often a Cloudflare plan limit (Pro plan or higher). See the debug log for details.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                // First-publish nudge (#1180): shown exactly once, on the deploy that flips
                // `.site-config`'s CF_WORKER_DEPLOYED from unset to set. `wasFirstDeploy`
                // structurally cannot be true again for this site afterward, so this line cannot
                // reappear on a later deploy — no separate "already prompted" flag is needed.
                // Gated on `domainAttachStatus` too: the sheet is reachable before a first
                // Publish (via the permanent menu item), so an owner can already have declared
                // `DOMAIN_CHOICE=transfer` going into their first deploy — in which case the
                // `.notConnected`/`.conflict` captions above already report the outcome, and this
                // nudge would otherwise contradict them by asking the owner to connect a domain
                // they just tried to. `.skipped` is the common case (default `DOMAIN_CHOICE=later`);
                // `nil` covers a background/automatic first deploy where the attach callback never
                // fired.
                if case .succeeded = model.phase, model.wasFirstDeploy,
                   model.domainAttachStatus == nil || model.domainAttachStatus == .skipped {
                    HStack(spacing: 4) {
                        Text("Your site is live. Connect a domain?")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Connect a domain…", action: onConnectDomain)
                            .buttonStyle(.link)
                            .font(.caption)
                    }
                }
            }
            Spacer()
            if case .succeeded(let url, _) = model.phase {
                // Standard share affordance for the deployed URL (#523) — its share sheet includes
                // a Copy action, so a separate "Copy URL" button would just duplicate it (#1078).
                ShareLink(item: url)
                    .labelStyle(.iconOnly)
                    .help("Share the deployed site's URL")
                    .accessibilityLabel("Share deployed URL")
                Button("Open in browser") {
                    NSWorkspace.shared.open(url)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityHint("Opens \(url.absoluteString)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch model.phase {
        case .running:
            PhaseProgressStrip(
                filledCount: DeployPanelProgress.filledCount(
                    currentMilestonePhase: model.currentMilestonePhase, succeeded: false
                ),
                size: .compact
            )
            .accessibilityLabel("Deploying")
        case .succeeded:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green).font(.title3)
                .accessibilityHidden(true)
        case .failed:
            Image(systemName: "exclamationmark.octagon.fill")
                .foregroundStyle(.red).font(.title3)
                .accessibilityHidden(true)
        case .idle, .blocked, .workerNameConflict, .webmentionPaidPlanConfirmationNeeded, .domainConfigDrift:
            Image(systemName: "shippingbox").font(.title3)
                .accessibilityHidden(true)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .running: return "Deploying \(siteName)…"
        case .succeeded(let url, _): return url.absoluteString
        case .failed: return "Deploy failed"
        case .idle, .blocked, .workerNameConflict, .webmentionPaidPlanConfirmationNeeded, .domainConfigDrift: return siteName
        }
    }

    private var headerSubtitle: String? {
        switch model.phase {
        case .succeeded(_, let duration):
            return String(format: "deployed in %.1f s", duration)
        case .failed(let reason, let exit):
            return exit.map { "\(reason) (exit \($0))" } ?? reason
        default:
            return nil
        }
    }

    /// True when `failureSummarySection` renders content (spinner or a summary) — drives the
    /// separator below it so the summary and the raw log don't run together visually.
    private var hasFailureSummaryContent: Bool {
        if case .failed = model.phase {
            return model.summarizing || model.failureSummary != nil
        }
        return false
    }

    @ViewBuilder
    private var failureSummarySection: some View {
        if case .failed = model.phase {
            if model.summarizing {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Summarizing…").font(.callout).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            } else if let s = model.failureSummary {
                VStack(alignment: .leading, spacing: 6) {
                    Label("AI summary — verify against the log below", systemImage: "sparkles")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Text(s.summary).font(.callout)
                    if !s.likelyCause.isEmpty {
                        Text("Likely cause: \(s.likelyCause)").font(.callout).foregroundStyle(.secondary)
                    }
                    if !s.suggestedFix.isEmpty {
                        Text("Suggested fix: \(s.suggestedFix)").font(.callout).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .textSelection(.enabled)
                .accessibilityElement(children: .combine)
            }
            // failureSummary == nil && !summarizing → render nothing; the raw reason/log already shows.
        }
    }

    private var logScroller: some View {
        // Auto-scroll to the latest line as the log streams in. ScrollViewReader anchors on the
        // last line's id; on each append we scroll to it.
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(model.logLines) { line in
                        Text(line.text)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(line.stream == .stderr ? Color.red : Color.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id(line.id)
                            // stderr is conveyed in red; name it so VoiceOver doesn't lose that.
                            .accessibilityLabel(line.stream == .stderr ? "Error: \(line.text)" : line.text)
                    }
                    if model.logLines.isEmpty {
                        Text("Waiting for output…")
                            .font(.caption).foregroundStyle(.tertiary)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .background(Color(NSColor.textBackgroundColor))
            .onChange(of: model.logLines.count) { _, _ in
                if let last = model.logLines.last {
                    withAnimation(.linear(duration: 0.1)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            // VoiceOver live region: announce the deploy start ("Deploying <site>") and the terminal
            // transition (running → succeeded / failed), not every appended log line. A non-sighted
            // user who has navigated away from the drawer hears start and outcome; the streaming
            // lines stay silent to keep speech usable.
            .onChange(of: model.phase) { oldPhase, newPhase in
                guard AppSettings.shared.announcesLiveUpdates else { return }
                if let announcement = LiveRegionAnnouncer.deployAnnouncement(
                    from: activity(for: oldPhase), to: activity(for: newPhase)) {
                    AccessibilityNotification.Announcement(announcement).post()
                }
            }
            // The one mid-flight exception: warn *once* when the deploy first writes to stderr, so a
            // failing deploy is flagged before its terminal state — without announcing every line.
            .onChange(of: stderrLineCount) { previous, current in
                guard AppSettings.shared.announcesLiveUpdates else { return }
                if let announcement = LiveRegionAnnouncer.deployStderrAnnouncement(
                    previousStderrCount: previous, currentStderrCount: current) {
                    AccessibilityNotification.Announcement(announcement).post()
                }
            }
        }
    }

    /// Number of stderr lines captured so far — drives the one-shot first-error warning.
    private var stderrLineCount: Int {
        model.logLines.lazy.filter { $0.stream == .stderr }.count
    }

    /// Collapses the app-target `DeployModel.Phase` onto the announceable substrate the decider
    /// understands. `idle`, `blocked`, `workerNameConflict`, `webmentionPaidPlanConfirmationNeeded`,
    /// and `domainConfigDrift` are all pre-output states → `.inactive`.
    private func activity(for phase: DeployModel.Phase) -> LiveRegionAnnouncer.DeployActivity {
        switch phase {
        case .running: return .running(site: siteName)
        case .succeeded(let url, _): return .succeeded(url: url.absoluteString)
        case .failed(let reason, let exit):
            return .failed(reason: exit.map { "\(reason) (exit \($0))" } ?? reason)
        case .idle, .blocked, .workerNameConflict, .webmentionPaidPlanConfirmationNeeded, .domainConfigDrift: return .inactive
        }
    }

    /// Copy log is useful on any terminal outcome — even a successful deploy can carry warnings
    /// (e.g. an Astro deprecation notice) worth reporting. Not offered mid-flight (`.running`)
    /// since the log is still streaming.
    private var canCopyLog: Bool {
        switch model.phase {
        case .succeeded, .failed: return true
        case .idle, .running, .blocked, .workerNameConflict, .webmentionPaidPlanConfirmationNeeded, .domainConfigDrift: return false
        }
    }

    private var footer: some View {
        HStack {
            if canCopyLog {
                Button("Copy log") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(model.logText, forType: .string)
                }
            }
            Spacer()
            Button(model.isRunning ? "Hide" : "Dismiss") {
                model.dismissDrawer()
            }
            .keyboardShortcut(.cancelAction)
            .disabled(false)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
