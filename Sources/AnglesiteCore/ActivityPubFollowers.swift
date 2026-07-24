import Foundation

/// The site's single ActivityPub actor, as V-4.1 (#363) composed it into the template Worker.
///
/// One fixed actor per site — there is no per-site username setting, by design (see the V-4.1
/// design doc's scope section).
public enum ActivityPubActor {
    /// The fixed actor username. Must stay in step with `ACTIVITYPUB_USERNAME` in
    /// `Resources/Template/worker/worker.ts`, which owns the value; `ActivityPubActorTests`
    /// locks the pair together, since nothing else would catch a rename.
    public static let username = "site"

    /// `https://<site>/users/site` — the actor document, and the URL a Mastodon user pastes into
    /// search to find this site (until WebFinger ships, #366).
    public static func actorURL(siteURL: URL) -> URL {
        siteURL
            .appendingPathComponent("users")
            .appendingPathComponent(username)
    }

    /// `https://<site>/users/site/followers` — the public, unauthenticated AS2 collection.
    public static func followersURL(siteURL: URL) -> URL {
        actorURL(siteURL: siteURL).appendingPathComponent("followers")
    }
}
