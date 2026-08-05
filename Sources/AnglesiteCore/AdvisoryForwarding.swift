import Foundation

/// Prepares a clipboard-ready summary for forwarding a security advisory to
/// `Anglesite/Anglesite`'s own advisory form — for reports discovered while triaging a site's
/// GitHub advisories that turn out to be about Anglesite itself, not the owner's site (#975).
///
/// Deliberately clipboard + browser, never an API call: a fine-grained PAT can't be scoped to a
/// repository outside its own owner's account/org, so an in-app API call would only work for
/// `Anglesite`-org members. Copy + open works for every user, using their own github.com session.
public enum AdvisoryForwarding {
    public static let anglesiteAdvisoryFormURL = URL(string: "https://github.com/Anglesite/Anglesite/security/advisories/new")!

    /// Plain text for the clipboard: the advisory's title, its own public GHSA URL, and a note
    /// naming the site repo it was found while triaging. Deliberately excludes the advisory's
    /// private `description`/`vulnerabilities` fields — only what's already public via the GHSA
    /// metadata goes on the clipboard; anything more specific is the owner's call to add by hand
    /// before submitting.
    public static func clipboardText(for advisory: SecurityAdvisory, siteRepo: RemoteRepo) -> String {
        """
        \(advisory.summary)
        \(advisory.htmlURL.absoluteString)

        Found while triaging security reports against \(siteRepo.owner)/\(siteRepo.name).
        """
    }
}
