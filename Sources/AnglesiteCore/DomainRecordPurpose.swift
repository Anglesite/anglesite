import Foundation

/// The known `purpose` tag vocabulary for `DomainOperationsService.addRecord` (#1170): a
/// namespaced `type:subtype` string written to `anglesite.json`'s `dns.managedRecords` entries
/// and mirrored into the live Cloudflare record's `anglesite:<purpose>` comment. One source of
/// truth for these strings so the call sites and future consumers (e.g. slice 3's / #1095
/// reconciliation parsing) can't drift apart (#1187).
public enum DomainRecordPurpose {
    public enum Verification {
        public static let bluesky = "verification:bluesky"
        public static let google = "verification:google"
    }

    public enum Email {
        public static let mtaSTS = "email:mta-sts"

        /// `"email:<provider.rawValue>"` for a completed `EmailSetupPlanner` provider choice.
        public static func provider(_ provider: EmailSetupPlanner.Provider) -> String {
            "email:\(provider.rawValue)"
        }
    }

    public enum Security {
        public static let caa = "security:caa"
        public static let nullMX = "security:null-mx"
        public static let spfReject = "security:spf-reject"
        public static let dmarcReject = "security:dmarc-reject"
    }
}
