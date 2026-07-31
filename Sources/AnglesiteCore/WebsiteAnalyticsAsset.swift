import Foundation

public enum WebsiteAnalyticsAsset {
    public struct Settings: Sendable, Equatable {
        public var cloudflareToken: String
        public var customHeadTag: String

        public init(cloudflareToken: String = "", customHeadTag: String = "") {
            self.cloudflareToken = cloudflareToken
            self.customHeadTag = customHeadTag
        }

        public var isEmpty: Bool {
            cloudflareToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && customHeadTag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    public enum InstallError: LocalizedError, Sendable {
        case layoutNotFound(URL)
        case headCloseTagNotFound(URL)
        case invalidCustomHTML(String)

        public var errorDescription: String? {
            switch self {
            case .layoutNotFound(let url):
                return "Website layout not found at \(url.path)."
            case .headCloseTagNotFound(let url):
                return "Website layout is missing a closing head tag at \(url.path)."
            case .invalidCustomHTML(let reason):
                return reason
            }
        }
    }

    public static let layoutRelativePath = "src/layouts/BaseLayout.astro"
    public static let configRelativePath = ".site-config"
    public static let dashboardURL = URL(string: "https://dash.cloudflare.com/?to=/:account/web-analytics")!

    /// CSP origins the Cloudflare Web Analytics beacon needs: the script host and the
    /// endpoint its event beacons POST to. The template's baseline CSP deliberately does
    /// not pre-allow these (#1013) — they're added to SCRIPT_ALLOW only while the beacon
    /// is enabled, and removed again when it's turned off.
    public static let cloudflareCSPDomains = ["static.cloudflareinsights.com", "cloudflareinsights.com"]

    private static let blockStart = "<!-- anglesite:analytics-start -->"
    private static let blockEnd = "<!-- anglesite:analytics-end -->"
    private static let customStart = "<!-- anglesite:custom-analytics-start -->"
    private static let customEnd = "<!-- anglesite:custom-analytics-end -->"

    public static func parseSettings(from source: String) -> Settings {
        Settings(
            cloudflareToken: cloudflareToken(in: source) ?? "",
            customHeadTag: customTag(in: source) ?? ""
        )
    }

    public static func apply(_ settings: Settings, to source: String) -> String {
        let block = renderBlock(settings)
        if let existing = analyticsBlockRange(in: source) {
            var patched = source
            if block.isEmpty {
                patched.replaceSubrange(existing, with: "")
            } else {
                patched.replaceSubrange(existing, with: block)
            }
            return patched
        }
        guard !block.isEmpty, let headEnd = source.range(of: "</head>") else { return source }
        var patched = source
        patched.insert(contentsOf: block + "\n", at: headEnd.lowerBound)
        return patched
    }

    public static func install(_ settings: Settings, siteDirectory: URL, fileManager: FileManager = .default) throws {
        if let validationMessage = customHeadTagValidationMessage(settings.customHeadTag) {
            throw InstallError.invalidCustomHTML(validationMessage)
        }

        let layoutURL = siteDirectory.appendingPathComponent(layoutRelativePath)
        guard fileManager.fileExists(atPath: layoutURL.path) else {
            throw InstallError.layoutNotFound(layoutURL)
        }
        let source = try String(contentsOf: layoutURL, encoding: .utf8)
        let patched = applyMigratingLegacy(settings, to: source)
        if patched == source && !settings.isEmpty && source.range(of: "</head>") == nil {
            throw InstallError.headCloseTagNotFound(layoutURL)
        }
        if patched != source {
            try patched.write(to: layoutURL, atomically: true, encoding: .utf8)
        }

        let configURL = siteDirectory.appendingPathComponent(configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let cloudflareToken = settings.cloudflareToken.trimmingCharacters(in: .whitespacesAndNewlines)
        var updatedConfig = SiteConfigFile.upsert([
            ("CF_WEB_ANALYTICS_TOKEN", cloudflareToken)
        ], into: config)
        if cloudflareToken.isEmpty {
            updatedConfig = SiteConfigFile.removeCSPDomains(cloudflareCSPDomains, from: updatedConfig)
        } else {
            updatedConfig = SiteConfigFile.addCSPDomains(cloudflareCSPDomains, into: updatedConfig)
        }
        let customDomains = customScriptDomains(from: settings.customHeadTag)
        if !customDomains.isEmpty {
            updatedConfig = SiteConfigFile.addCSPDomains(customDomains, into: updatedConfig)
        }
        if updatedConfig != config {
            try updatedConfig.write(to: configURL, atomically: true, encoding: .utf8)
        }
    }

    public static func bestHost(from config: String, fallback: String) -> String {
        let domain = configValue("DOMAIN", in: config)
            ?? configValue("SITE_DOMAIN", in: config)
            ?? fallback
        return domain.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func customScriptDomains(from html: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"<script[^>]+src=["']https?://([^/"']+)"#, options: [.caseInsensitive]) else {
            return []
        }
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        let domains = regex.matches(in: html, range: range).compactMap { match -> String? in
            guard match.numberOfRanges > 1, let capture = Range(match.range(at: 1), in: html) else { return nil }
            return String(html[capture]).lowercased()
        }
        return Array(Set(domains)).sorted()
    }

    public static func customHeadTagValidationMessage(_ html: String) -> String? {
        let snippet = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !snippet.isEmpty else { return nil }

        if snippet.contains(blockStart) || snippet.contains(blockEnd)
            || snippet.contains(customStart) || snippet.contains(customEnd) {
            return "Custom analytics HTML can't include Anglesite's managed analytics comments."
        }

        if hasDanglingHTMLComment(in: snippet) {
            return "Custom analytics HTML has an unfinished comment."
        }

        if hasDanglingTag(in: snippet) {
            return "Custom analytics HTML has an unfinished tag."
        }

        if hasUnclosedScriptTag(in: snippet) {
            return "Custom analytics script tags must include a closing </script> tag."
        }

        return nil
    }

    public static func configValue(_ key: String, in config: String) -> String? {
        for line in config.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("\(key)=") else { continue }
            return String(trimmed.dropFirst(key.count + 1))
        }
        return nil
    }

    public static func loadConfig(siteDirectory: URL, fileManager: FileManager = .default) throws -> String {
        let configURL = siteDirectory.appendingPathComponent(configRelativePath)
        guard fileManager.fileExists(atPath: configURL.path) else { return "" }
        return try String(contentsOf: configURL, encoding: .utf8)
    }

    public static func parseSettings(layoutSource: String, config: String) -> Settings {
        var settings = parseSettings(from: layoutSource)
        if settings.cloudflareToken.isEmpty, let token = configValue("CF_WEB_ANALYTICS_TOKEN", in: config) {
            settings.cloudflareToken = token
        }
        return settings
    }

    public static func setCloudflareToken(_ token: String, in settings: inout Settings) {
        settings.cloudflareToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func legacyGoogleTag(in source: String) -> String? {
        guard let id = firstCapture(in: source, pattern: #"googletagmanager\.com/gtag/js\?id=([^"'&<\s]+)"#) else {
            return nil
        }
        return """
        <script async src="https://www.googletagmanager.com/gtag/js?id=\(attr(id))"></script>
        <script>
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '\(attr(id))');
        </script>
        """
    }

    private static func migrateLegacyGoogle(from source: String, into settings: inout Settings) {
        if settings.customHeadTag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let tag = legacyGoogleTag(in: source) {
            settings.customHeadTag = tag
        }
    }

    public static func parseMigratingLegacySettings(layoutSource: String, config: String) -> Settings {
        var settings = parseSettings(layoutSource: layoutSource, config: config)
        migrateLegacyGoogle(from: layoutSource, into: &settings)
        return settings
    }

    public static func stripLegacyGoogle(from source: String) -> String {
        var output = source
        if let asyncRange = output.range(of: #"\n?\s*<script async src="https://www\.googletagmanager\.com/gtag/js\?id=[^"]+"></script>"#, options: .regularExpression) {
            output.removeSubrange(asyncRange)
        }
        if let blockRange = output.range(of: #"\n?\s*<script>\s*window\.dataLayer = window\.dataLayer \|\| \[\];\s*function gtag\(\)\{dataLayer\.push\(arguments\);\}\s*gtag\('js', new Date\(\)\);\s*gtag\('config', '[^']+'\);\s*</script>"#, options: .regularExpression) {
            output.removeSubrange(blockRange)
        }
        return output
    }

    public static func applyMigratingLegacy(_ settings: Settings, to source: String) -> String {
        apply(settings, to: stripLegacyGoogle(from: source))
    }

    private static func renderBlock(_ settings: Settings) -> String {
        var lines: [String] = []
        let cloudflareToken = settings.cloudflareToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let customTag = settings.customHeadTag.trimmingCharacters(in: .whitespacesAndNewlines)

        if !cloudflareToken.isEmpty {
            let beacon = cloudflareBeaconAttributeValue(token: cloudflareToken)
            lines.append(#"<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='\#(beacon)'></script>"#)
        }
        if !customTag.isEmpty {
            lines.append(customStart)
            lines.append(customTag)
            lines.append(customEnd)
        }
        guard !lines.isEmpty else { return "" }
        return ([blockStart] + lines + [blockEnd]).joined(separator: "\n")
    }

    private static func analyticsBlockRange(in source: String) -> Range<String.Index>? {
        guard let start = source.range(of: blockStart),
              let end = source.range(of: blockEnd, range: start.upperBound..<source.endIndex)
        else { return nil }
        var upper = end.upperBound
        if upper < source.endIndex, source[upper] == "\n" {
            upper = source.index(after: upper)
        }
        return start.lowerBound..<upper
    }

    private static func customTag(in source: String) -> String? {
        guard let start = source.range(of: customStart),
              let end = source.range(of: customEnd, range: start.upperBound..<source.endIndex)
        else { return nil }
        return source[start.upperBound..<end.lowerBound]
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func firstCapture(in source: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        guard let match = regex.firstMatch(in: source, range: range),
              match.numberOfRanges > 1
        else { return nil }
        for index in 1..<match.numberOfRanges {
            guard let capture = Range(match.range(at: index), in: source) else { continue }
            return String(source[capture])
        }
        return nil
    }

    private static func hasDanglingHTMLComment(in snippet: String) -> Bool {
        var searchStart = snippet.startIndex
        while let start = snippet.range(of: "<!--", range: searchStart..<snippet.endIndex) {
            guard let end = snippet.range(of: "-->", range: start.upperBound..<snippet.endIndex) else {
                return true
            }
            searchStart = end.upperBound
        }
        return false
    }

    private static func hasDanglingTag(in snippet: String) -> Bool {
        guard let lastOpen = snippet.lastIndex(of: "<") else { return false }
        guard let lastClose = snippet.lastIndex(of: ">") else { return true }
        return lastOpen > lastClose
    }

    private static func hasUnclosedScriptTag(in snippet: String) -> Bool {
        let lowercased = snippet.lowercased()
        var searchStart = lowercased.startIndex
        while let openStart = lowercased.range(of: "<script", range: searchStart..<lowercased.endIndex) {
            guard let openEnd = lowercased.range(of: ">", range: openStart.upperBound..<lowercased.endIndex) else {
                return true
            }
            guard let close = lowercased.range(of: "</script", range: openEnd.upperBound..<lowercased.endIndex),
                  lowercased.range(of: ">", range: close.upperBound..<lowercased.endIndex) != nil
            else {
                return true
            }
            searchStart = close.upperBound
        }
        return false
    }

    private static func attr(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "'", with: "&#39;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func cloudflareBeaconAttributeValue(token: String) -> String {
        let object = ["token": token]
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
            ?? Data(#"{"token":""}"#.utf8)
        return singleQuotedAttr(String(decoding: data, as: UTF8.self))
    }

    private static func singleQuotedAttr(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "'", with: "&#39;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func cloudflareToken(in source: String) -> String? {
        guard let json = firstCapture(in: source, pattern: #"data-cf-beacon=(?:"([^"]+)"|'([^']+)')"#) else {
            return nil
        }
        let decoded = htmlAttributeDecode(json)
        guard let data = decoded.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String
        else { return nil }
        return token
    }

    private static func htmlAttributeDecode(_ value: String) -> String {
        value.replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}
