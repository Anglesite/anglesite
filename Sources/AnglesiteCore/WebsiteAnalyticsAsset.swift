import Foundation

/// Manages the analytics `<script>` block in a site's base layout, plus the `.site-config` keys
/// that go with it. The layout itself is the source of truth: settings are re-parsed from the
/// marker-delimited HTML block on every read rather than stored separately, so an owner (or git)
/// editing the layout by hand can never drift out of sync with what the app shows.
public enum WebsiteAnalyticsAsset {
    /// The two analytics inputs the settings UI edits: a Cloudflare Web Analytics token, and a
    /// free-form custom `<head>` snippet for any other provider.
    public struct Settings: Sendable, Equatable {
        /// The Cloudflare Web Analytics beacon token; empty means Cloudflare analytics is off.
        public var cloudflareToken: String
        /// Owner-supplied `<head>` HTML for a non-Cloudflare provider. Validated by
        /// ``WebsiteAnalyticsAsset/customHeadTagValidationMessage(_:)`` before install, since a
        /// malformed snippet here would corrupt the layout for every page.
        public var customHeadTag: String

        /// Creates settings; both fields default empty so `Settings()` means "analytics off".
        public init(cloudflareToken: String = "", customHeadTag: String = "") {
            self.cloudflareToken = cloudflareToken
            self.customHeadTag = customHeadTag
        }

        /// True when neither field has non-whitespace content — the signal to *remove* the managed
        /// block from the layout rather than write an empty one.
        public var isEmpty: Bool {
            cloudflareToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && customHeadTag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    /// Failures ``WebsiteAnalyticsAsset/install(_:siteDirectory:fileManager:)`` can throw — each
    /// carries enough context for a user-facing message, since these surface directly in the
    /// settings UI.
    public enum InstallError: LocalizedError, Sendable {
        /// The base layout file doesn't exist where the template puts it.
        case layoutNotFound(URL)
        /// The layout has no `</head>` to insert before — the block would have nowhere to live.
        case headCloseTagNotFound(URL)
        /// The custom HTML failed validation; the associated string is the user-facing reason.
        case invalidCustomHTML(String)

        /// User-facing message for each failure, shown as-is in the settings sheet.
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

    /// Where the template keeps the base layout the analytics block is patched into.
    public static let layoutRelativePath = "src/layouts/BaseLayout.astro"
    /// The template-owned config file (lives in `Source/`, unlike app-owned `Config/` state) that
    /// carries the token and CSP domains for the pre-deploy check.
    public static let configRelativePath = ".site-config"
    /// Deep link into the Cloudflare dashboard's Web Analytics page (`:account` is resolved by
    /// Cloudflare to the signed-in account), for the "get a token" affordance in settings.
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

    /// Recovers the current settings from the layout's managed block — the read half of the
    /// layout-is-source-of-truth design. Absent markers simply yield empty settings.
    public static func parseSettings(from source: String) -> Settings {
        Settings(
            cloudflareToken: cloudflareToken(in: source) ?? "",
            customHeadTag: customTag(in: source) ?? ""
        )
    }

    /// Rewrites the layout source with the managed block matching `settings`: replaces an existing
    /// block in place (removing it entirely when settings are empty), otherwise inserts before
    /// `</head>`. Pure — returns `source` unchanged when there's nowhere to insert, so the caller
    /// decides whether a missing `</head>` is an error (see ``install(_:siteDirectory:fileManager:)``).
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

    /// The I/O entry point: validates the custom HTML, patches the layout (migrating any legacy
    /// hand-installed Google tag into the managed block), and upserts the token plus any custom
    /// script domains into `.site-config` — the CSP domains keep the pre-deploy check from
    /// blocking the very script this feature just installed. Writes only on actual change.
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

    /// The canonical way to resolve a site's host from its `.site-config`. The app writes the
    /// `DOMAIN` key; `SITE_DOMAIN` is only accepted as a legacy fallback — resolve hosts through
    /// this method rather than reading either key directly, so every caller agrees on the
    /// precedence.
    public static func bestHost(from config: String, fallback: String) -> String {
        let domain = configValue("DOMAIN", in: config)
            ?? configValue("SITE_DOMAIN", in: config)
            ?? fallback
        return domain.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Extracts the external hosts of any `<script src="https://…">` tags in the custom HTML, so
    /// ``install(_:siteDirectory:fileManager:)`` can add them to the site's CSP allowlist. Sorted
    /// and deduplicated for a deterministic `.site-config` diff.
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

    /// Returns a user-facing rejection message for custom head HTML, or `nil` when it's safe to
    /// install. The checks are structural, not a full HTML parse: an unfinished comment, dangling
    /// tag, unclosed `<script>`, or an embedded copy of Anglesite's own marker comments would each
    /// break the marker-based block parsing (or swallow the rest of the layout's `<head>`).
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

    /// Reads one `KEY=value` line from `.site-config` contents; `nil` when the key is absent.
    /// Line-oriented on purpose — the file is a simple env-style format, not a parsed grammar.
    public static func configValue(_ key: String, in config: String) -> String? {
        for line in config.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("\(key)=") else { continue }
            return String(trimmed.dropFirst(key.count + 1))
        }
        return nil
    }

    /// Loads `.site-config`'s raw contents; a missing file reads as empty rather than throwing,
    /// since a fresh site legitimately has no config yet.
    public static func loadConfig(siteDirectory: URL, fileManager: FileManager = .default) throws -> String {
        let configURL = siteDirectory.appendingPathComponent(configRelativePath)
        guard fileManager.fileExists(atPath: configURL.path) else { return "" }
        return try String(contentsOf: configURL, encoding: .utf8)
    }

    /// Like ``parseSettings(from:)``, but falls back to `.site-config`'s `CF_WEB_ANALYTICS_TOKEN`
    /// when the layout block carries no token — covering a site whose config was written before
    /// the layout was patched (or whose layout was edited by hand).
    public static func parseSettings(layoutSource: String, config: String) -> Settings {
        var settings = parseSettings(from: layoutSource)
        if settings.cloudflareToken.isEmpty, let token = configValue("CF_WEB_ANALYTICS_TOKEN", in: config) {
            settings.cloudflareToken = token
        }
        return settings
    }

    /// Assigns a token with whitespace trimmed — the one normalization point, so a pasted token
    /// with a stray newline doesn't end up verbatim in the beacon attribute and config file.
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

    /// ``parseSettings(layoutSource:config:)`` plus legacy migration: a hand-installed Google
    /// gtag.js snippet found outside the managed block is surfaced as the custom head tag (unless
    /// one is already set), so opening settings on an older site shows what's actually installed
    /// instead of pretending analytics is off.
    public static func parseMigratingLegacySettings(layoutSource: String, config: String) -> Settings {
        var settings = parseSettings(layoutSource: layoutSource, config: config)
        migrateLegacyGoogle(from: layoutSource, into: &settings)
        return settings
    }

    /// Removes a legacy hand-installed gtag.js pair (async loader + inline config) from the layout
    /// so the migrated copy inside the managed block doesn't leave the tag firing twice.
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

    /// ``apply(_:to:)`` after ``stripLegacyGoogle(from:)`` — the write half of legacy migration,
    /// used by ``install(_:siteDirectory:fileManager:)`` so one save both adopts and de-duplicates
    /// an old hand-installed tag.
    public static func applyMigratingLegacy(_ settings: Settings, to source: String) -> String {
        apply(settings, to: stripLegacyGoogle(from: source))
    }

    private static func renderBlock(_ settings: Settings) -> String {
        var lines: [String] = []
        let cloudflareToken = settings.cloudflareToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let customTag = settings.customHeadTag.trimmingCharacters(in: .whitespacesAndNewlines)

        if !cloudflareToken.isEmpty {
            // Deliberately no `integrity=`: the beacon URL is unversioned and Cloudflare
            // rotates its content routinely, so a pinned hash would break analytics fleet-wide
            // on the next rotation with no build-time signal. `pre-deploy-check.ts`'s
            // `sri-missing` warning on this tag is expected, not a gap — the compensating
            // control is the CSP `SCRIPT_ALLOW` scoping this method adds for
            // `cloudflareCSPDomains` while the beacon is enabled. See #1165 for the full
            // investigation and disposition.
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
