import Foundation

/// Writes a site's domain intent into `Source/anglesite.json`'s `domain` section (#1169/#1170) —
/// the single place `CustomDomainAttachCommand` (post-deploy, transfer-only) and
/// `ConnectDomainCommand` (the Connect a Domain sheet, #1180) both go through, so the two call
/// sites can't drift on what a "transfer" or "buy" declaration looks like on disk.
public enum DomainIntentRecorder {
    /// Declares an owned-domain (`transfer`) intent: `attach: true` records that the owner wants
    /// this hostname attached as a Workers Custom Domain once its zone is live on the connected
    /// Cloudflare account — the confirmed-live receipt itself is `.site-config`'s
    /// `CF_DOMAIN_ATTACHED`, written separately (`CustomDomainAttachCommand.persistAttached`) once
    /// attach actually succeeds. Best-effort — a write failure here must never surface as an
    /// error to the caller (matches `CustomDomainAttachCommand`'s existing posture).
    ///
    /// Writes `registrar`/`expiresAt` as explicit `""` rather than `nil` for the same reason
    /// `recordBuyIntent` writes `hostname: ""` below: `DomainConfigStore.save`'s merge can't
    /// express deletion, so a `nil` here would leave a *previous* domain's cached registrar/
    /// expiration sitting under the *new* hostname (#1194 review round 3) — `ConnectDomainModel`
    /// would then seed its display straight from that stale, now-mismatched value. An explicit
    /// `""` does get encoded and so does overwrite the merge; `ConnectDomainModel.loadRegistrarInfo`
    /// normalizes a blank string back to `nil` at the read boundary.
    public static func recordTransferIntent(hostname: String, siteDirectory: URL) {
        DomainConfigStore.update(sourceDirectory: siteDirectory) { config in
            config.domain = DomainConfig.Domain(
                hostname: hostname, choice: NewSiteDomainChoice.transfer.rawValue, attach: true,
                registrar: "", expiresAt: "")
        }
    }

    /// Declares a buy-a-domain intent: no hostname exists yet, so `attach` is `false` — there is
    /// nothing to attach until the owner comes back with a real hostname (via the transfer path
    /// above, once they've bought one). Best-effort, matching `recordTransferIntent`.
    ///
    /// Writes `hostname` as an explicit empty string rather than `nil`. `DomainConfigStore.save`
    /// does a recursive JSON merge that can't express deletion, and Swift's synthesized
    /// `Encodable` for an `Optional` property omits the key entirely when the value is `nil` — so
    /// a `nil` hostname here would be indistinguishable from "caller didn't mention hostname" and
    /// a previously-declared hostname (from a prior `recordTransferIntent`, e.g. the owner
    /// reopening the sheet and switching from "I already own a domain" to "Buy a domain") would
    /// survive untouched in `anglesite.json`. An explicit `""` does get encoded and so does
    /// overwrite the merge. `registrar`/`expiresAt` get the same explicit-`""` treatment for the
    /// same reason (see `recordTransferIntent`'s doc comment) — a buy declaration has no hostname
    /// to look up a registrar for, so any registrar/expiration cached under a previous transfer
    /// declaration must not survive into this one.
    public static func recordBuyIntent(siteDirectory: URL) {
        DomainConfigStore.update(sourceDirectory: siteDirectory) { config in
            config.domain = DomainConfig.Domain(
                hostname: "", choice: NewSiteDomainChoice.buy.rawValue, attach: false,
                registrar: "", expiresAt: "")
        }
    }
}
