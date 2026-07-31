import Foundation

/// Drives the first-deploy token flow — verify the pasted token, persist it only if it's good,
/// surface the connected account, then decide whether to proceed — independent of any SwiftUI.
///
/// The view-model (`DeployModel`) owns the observable state and the parked deploy; this type owns
/// the *ordering* that the cancellation bug lived in (verify → persist → flash → re-check cancel →
/// proceed). Keeping it here, behind injectable closures, means the "a cancelled deploy must not
/// fire" rule is unit-tested under `swift test` rather than only in a hosted app test.
///
/// `@MainActor` so it composes naturally with `DeployModel` (also MainActor) without `Sendable`
/// gymnastics on the closures; MainActor is available well below the app's macOS 27 floor, so this
/// still runs on CI's older runners.
@MainActor
public struct TokenOnboarding {
    /// What the caller should do after a run — the three-way split exists so the view-model can
    /// distinguish "keep the sheet open" from "close it silently" without re-deriving state.
    public enum Outcome: Equatable {
        /// Token verified and persisted — the caller should start the parked deploy.
        case proceed(CloudflareAccount)
        /// Verification (or persistence) failed — the caller keeps the prompt open with `message`.
        case stay(message: String)
        /// The user cancelled during the flow — the caller does nothing.
        case abort
    }

    private let verifier: TokenVerifying

    /// Creates the flow with an injectable verifier so tests can stub the network round-trip.
    public init(verifier: TokenVerifying) {
        self.verifier = verifier
    }

    /// - persist: stores the token (e.g. Keychain write); only called on a successful verify, and a
    ///   throw turns the run into `.stay`.
    /// - onConnected: surfaces the connected account for the success flash, before `delay`.
    /// - delay: the success-flash pause — injectable so tests don't wait real time.
    /// - isCancelled: re-checked after verify + delay; `true` ⇒ `.abort` (no proceed).
    public func run(
        token: String,
        siteDirectory: URL,
        persist: (String) throws -> Void,
        onConnected: (CloudflareAccount) -> Void,
        delay: () async -> Void,
        isCancelled: () -> Bool
    ) async -> Outcome {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .stay(message: "Paste your token first.") }

        switch await verifier.verify(token: trimmed, siteDirectory: siteDirectory) {
        case .failure(let error):
            return .stay(message: error.userMessage)
        case .success(let account):
            do {
                try persist(trimmed)
            } catch {
                return .stay(message: "Couldn’t save to Keychain: \(error)")
            }
            // Let the user see which account they connected, then re-check cancellation before
            // launching a deploy behind their back.
            onConnected(account)
            await delay()
            if isCancelled() { return .abort }
            return .proceed(account)
        }
    }
}
