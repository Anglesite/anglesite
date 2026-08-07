/// Translates a raw DNS record into the plain-English purpose label shown in the Domain sheet's
/// record list — mirrors the `domain` plugin skill's "translate the output into plain English"
/// step. Order matters: more specific rules (DMARC/SPF/Atmosphere) are checked before the generic
/// TXT fallback.
public enum DNSRecordLabeler {
    /// The plain-English purpose label for `record`. Matching is case-insensitive across type,
    /// name, and content; anything unrecognized becomes `"Other"` rather than surfacing a raw
    /// record type at an owner who came here to publish a website, not to learn DNS.
    public static func label(for record: DNSRecord) -> String {
        let type = record.type.uppercased()
        let name = record.name.lowercased()
        let content = record.content.lowercased()

        switch type {
        case "MX":
            return "Email routing"
        case "TXT" where name.hasPrefix("_dmarc.") || name == "_dmarc":
            return "Spam prevention (DMARC)"
        case "TXT" where content.hasPrefix("v=spf1"):
            return "Spam prevention (SPF)"
        case "TXT" where name.hasPrefix("_atproto.") || name == "_atproto":
            return "Atmosphere verification"
        case "CNAME" where content.contains(".pages.dev") || content.contains(".workers.dev"):
            return "Website"
        case "A", "AAAA":
            return "Website"
        default:
            return "Other"
        }
    }
}
