import Foundation

/// Derives a Fediverse-style `@user@host` handle from a bare ActivityPub actor IRI.
///
/// The followers collection `@dwk/activitypub` serves carries only IRIs — no names, no handles
/// (V-4.2, #364). This is the offline first approximation every follower row renders with
/// immediately, and the permanent fallback when fetching that follower's actor document fails.
/// It deliberately returns `nil` rather than guessing for path shapes it doesn't recognize:
/// a wrong handle is worse than the raw IRI, which callers fall back to.
public enum ActorHandle {
    /// Path segments that conventionally precede an actor's name: Mastodon and most
    /// ActivityPub servers use `/users/<name>`; Lemmy uses `/u/<name>` and `/c/<name>`.
    private static let nameBearingPrefixes: Set<String> = ["users", "u", "c"]

    /// `@alice@mastodon.social` for `https://mastodon.social/users/alice`, or `nil` when the
    /// IRI's shape isn't one this recognizes.
    public static func derive(from actor: URL) -> String? {
        guard let host = actor.host, !host.isEmpty else { return nil }
        let segments = actor.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        guard let last = segments.last else { return nil }

        let name: String
        if last.hasPrefix("@") {
            name = String(last.dropFirst())
        } else if segments.count >= 2, nameBearingPrefixes.contains(segments[segments.count - 2]) {
            name = last
        } else {
            return nil
        }

        guard !name.isEmpty else { return nil }

        // The IRI is attacker-supplied (any Fediverse actor can follow the site), and
        // `URL.pathComponents` percent-decodes, so a hostile server can smuggle invisible
        // Unicode bidi-control characters into the name segment to make the rendered handle
        // impersonate a different, trusted one. Sanitize both extracted pieces before
        // assembling the handle — see `DisplayString` for why this is the one place the rule
        // lives.
        let safeName = DisplayString.safe(name)
        let safeHost = DisplayString.safe(host)
        guard !safeName.isEmpty else { return nil }
        return "@\(safeName)@\(safeHost)"
    }
}
