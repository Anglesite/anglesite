import Foundation

/// Renders a website-template attribution catalog into the Markdown notice file
/// `SiteScaffolder` writes into every new site's `Source/THIRD-PARTY-NOTICES.md`.
public enum ThirdPartyNoticeRenderer {
    public static func render(_ attributions: [OSSAttribution]) -> String {
        var lines = [
            "# Third-Party Notices", "",
            "This site's build tooling includes the following open-source packages.", "",
        ]
        for attribution in attributions {
            lines.append("## \(attribution.name) \(attribution.version)")
            lines.append("")
            if let spdx = attribution.licenseSPDXId {
                lines.append("License: \(spdx)")
                lines.append("")
            }
            if let homepage = attribution.homepage {
                lines.append("Homepage: \(homepage)")
                lines.append("")
            }
            lines.append("```")
            lines.append(attribution.licenseText.trimmingCharacters(in: .whitespacesAndNewlines))
            lines.append("```")
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }
}
