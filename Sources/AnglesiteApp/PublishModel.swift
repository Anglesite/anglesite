import SwiftUI
import AnglesiteCore

/// SwiftUI-facing wrapper around `RepoBootstrap`. Drives one publish at a time, mirrors the
/// `DeployModel` shape (a `Phase`, an `isRunning` flag, a sheet-presentation flag). All decision
/// logic lives in `RepoBootstrap`; this only maps events to view state.
@MainActor
@Observable
final class PublishModel {
    enum Phase: Equatable {
        case idle
        case running(milestone: String)
        case needsAuth
        case published(RemoteRepo)
        case failed(reason: String)
    }

    /// Progress of verifying a pasted GitHub token, consumed by `GitHubTokenPromptView`'s status
    /// line and button-enabled logic. Shaped like `CloudflareTokenVerification`
    /// (`CloudflareTokenPromptView.swift`) — kept as a separate type rather than shared, since the
    /// two prompts (GitHub vs. Cloudflare tokens) have no other coupling.
    enum TokenVerification: Equatable {
        case idle
        case checking
        case connected(accountName: String?)
        case failed(message: String)
    }

    private(set) var phase: Phase = .idle
    /// Remote read on window open; drives the toolbar label (Publish vs View on GitHub).
    private(set) var existingRemote: RemoteRepo?

    /// Bound to the progress/result sheet in `SiteWindow`.
    var sheetPresented: Bool = false
    /// Bound to `GitHubTokenPromptView` when the provider needs a GitHub token.
    var tokenPromptPresented: Bool = false
    private(set) var tokenVerification: TokenVerification = .idle

    var isRunning: Bool { if case .running = phase { return true }; return false }

    private let bootstrap: RepoBootstrap
    private let onboarding: GitHubTokenOnboarding
    private let keychain: KeychainStore
    private var inFlight: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    /// Site parked while the token prompt is open; retried once a token verifies. `nil` outside
    /// that flow.
    private var pendingPublish: (source: URL, repoName: String)?

    init(
        bootstrap: RepoBootstrap = .live(),
        verifier: GitHubTokenVerifying = GitHubAPITokenVerifier(),
        keychain: KeychainStore = KeychainStore()
    ) {
        self.bootstrap = bootstrap
        self.onboarding = GitHubTokenOnboarding(verifier: verifier)
        self.keychain = keychain
    }

    /// Cheap read of `origin` to decide the toolbar label. Safe to call on window open; a rapid
    /// re-open cancels the prior read so a late-completing one can't clobber a newer result.
    func refreshRemote(source: URL) {
        refreshTask?.cancel()
        refreshTask = Task { self.existingRemote = await bootstrap.remote(of: source) }
    }

    /// Toolbar action. No-op if a publish is already running.
    func publish(source: URL, repoName: String) {
        start(source: source, repoName: repoName)
    }

    /// Called by the token-prompt sheet's "Connect & publish" button. Verifies the token against
    /// GitHub before persisting it — so a bad token is caught here rather than failing later
    /// inside the publish — then retries the parked publish.
    func verifyAndSaveToken(_ token: String) async {
        guard let pending = pendingPublish else {
            // The prompt is only shown with a parked publish; guard defensively.
            tokenVerification = .failed(message: "No publish is waiting — close this and click Publish again.")
            return
        }

        tokenVerification = .checking
        // `onConnected` can fire after the user has already hit Cancel (mid-verify or mid-delay) —
        // `isCancelled` is only re-checked once, after `delay()`. That's harmless: the token really
        // did verify, so persisting it and flashing `.connected`/`AppSettings.gitHubAccount` here
        // is no different from the identity a Settings-row verify would show, and `.abort` below
        // resets `tokenVerification` back to `.idle` before the (already-dismissed) sheet could
        // display it.
        let outcome = await onboarding.run(
            token: token,
            persist: { try keychain.writeGitHubToken($0) },
            onConnected: { account in
                AppSettings.shared.gitHubAccount = account
                tokenVerification = .connected(accountName: account.login)
            },
            delay: { try? await Task.sleep(for: .milliseconds(700)) },
            isCancelled: { Task.isCancelled || !tokenPromptPresented }
        )

        switch outcome {
        case .proceed:
            pendingPublish = nil
            tokenPromptPresented = false
            tokenVerification = .idle
            start(source: pending.source, repoName: pending.repoName)
        case .stay(let message):
            tokenVerification = .failed(message: message)
        case .abort:
            // `cancelTokenPrompt` already clears `pendingPublish`, but clearing it again here too
            // makes this branch self-contained rather than relying on that ordering — a future
            // dismissal path that skips `cancelTokenPrompt` shouldn't be able to leave a stale
            // parked publish behind.
            pendingPublish = nil
            tokenVerification = .idle
        }
    }

    func cancelTokenPrompt() {
        pendingPublish = nil
        tokenPromptPresented = false
        tokenVerification = .idle
    }

    func dismiss() { sheetPresented = false }

    /// Single entry point for kicking off a publish. The `guard` is the only concurrency gate —
    /// it prevents both a second toolbar tap and `verifyAndSaveToken` from opening a second
    /// `consume` loop over the same window.
    private func start(source: URL, repoName: String) {
        guard !isRunning else { return }
        phase = .running(milestone: "Starting…")
        sheetPresented = true
        inFlight = Task {
            await self.consume(
                bootstrap.publish(source: source, repoName: repoName, isPrivate: true),
                source: source,
                repoName: repoName
            )
        }
    }

    private func consume(_ stream: AsyncStream<RepoBootstrap.Event>, source: URL, repoName: String) async {
        for await event in stream {
            switch event {
            case .progress(_, let message): phase = .running(milestone: message)
            case .needsAuth:
                phase = .needsAuth
                pendingPublish = (source, repoName)
                tokenVerification = .idle
                tokenPromptPresented = true
                sheetPresented = false
            case .published(let repo):
                phase = .published(repo)
                existingRemote = repo
            case .failed(let reason):
                phase = .failed(reason: reason)
            }
        }
        // If the task was cancelled without a terminal event, the stream finishes while phase is
        // still .running — reset so isRunning clears and the toolbar button re-enables.
        if case .running = phase { phase = .idle }
    }
}
