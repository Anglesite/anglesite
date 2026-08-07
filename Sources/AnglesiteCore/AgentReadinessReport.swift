import Foundation

/// Cloudflare's Agent Readiness score for a scanned URL (Agents Week 2026, #1248): how easily an
/// AI agent can discover, parse, authenticate against, and call a site — the AI-era analogue of a
/// Lighthouse score. Distinct from `AuditReport` (human accessibility) and `CloudflareZoneState`
/// (security posture); this grades agent-facing discoverability specifically.
///
/// Cloudflare's URL Scanner API reports a readiness *tier* (`level`/`levelName`), not a 0-100
/// composite score — there is no published `score` field alongside it (confirmed against the
/// live API reference at the time this was built). `passedCount`/`totalCount` stand in as the
/// plain-language "how am I doing" summary the app surfaces alongside the tier.
public struct AgentReadinessReport: Sendable, Equatable {
    /// Cloudflare's readiness tier (0 = least ready).
    public let level: Int
    /// The tier's display label (e.g. "Bot-Aware") — the pairing Cloudflare shows on
    /// isitagentready.com.
    public let levelName: String
    public let categories: [Category]
    /// What it takes to reach the next tier; `nil` when Cloudflare reports none (e.g. top tier).
    public let nextLevel: NextLevel?

    public init(level: Int, levelName: String, categories: [Category], nextLevel: NextLevel?) {
        self.level = level
        self.levelName = levelName
        self.categories = categories
        self.nextLevel = nextLevel
    }

    public var passedCount: Int { categories.flatMap(\.checks).filter { $0.status == .pass }.count }
    public var totalCount: Int { categories.flatMap(\.checks).count }

    public struct Category: Sendable, Equatable, Identifiable {
        public let id: String
        public let displayName: String
        public let checks: [Check]

        public init(id: String, displayName: String, checks: [Check]) {
            self.id = id
            self.displayName = displayName
            self.checks = checks
        }
    }

    public struct Check: Sendable, Equatable, Identifiable {
        public let id: String
        public let displayName: String
        public let status: Status
        /// Owner-friendly explanation of what this check means, translated from Cloudflare's
        /// technical check name via `AgentReadinessCatalog` — not Cloudflare's own message text.
        public let hint: String
        /// `true` when Anglesite's site template already implements what this check looks for
        /// (e.g. `robots.txt`, the sitemap). A failure on one of these means the deployed site is
        /// stale or misconfigured, not that the app lacks the feature — drives "redeploy to
        /// pick this up" copy instead of "not supported yet".
        public let anglesiteProvides: Bool

        public enum Status: String, Sendable, Equatable {
            case pass
            case fail
            case neutral
        }

        public init(id: String, displayName: String, status: Status, hint: String, anglesiteProvides: Bool) {
            self.id = id
            self.displayName = displayName
            self.status = status
            self.hint = hint
            self.anglesiteProvides = anglesiteProvides
        }
    }

    public struct NextLevel: Sendable, Equatable {
        public let name: String
        public let target: Int

        public init(name: String, target: Int) {
            self.name = name
            self.target = target
        }
    }
}

/// Owner-friendly copy for Cloudflare's Agent Readiness checks, keyed by Cloudflare's check id
/// (the JSON key inside `meta.processors.agentReadiness.checks.<category>`). An id with no entry
/// here still renders — `checkInfo(for:)` falls back to a humanized version of the id — so a
/// check Cloudflare adds later degrades to readable-but-untranslated instead of disappearing.
public enum AgentReadinessCatalog {
    public struct CategoryInfo: Sendable {
        public let displayName: String
    }

    public struct CheckInfo: Sendable {
        public let displayName: String
        public let passHint: String
        public let failHint: String
        /// See `AgentReadinessReport.Check.anglesiteProvides`.
        public let anglesiteProvides: Bool
    }

    public static let categories: [String: CategoryInfo] = [
        "discoverability": .init(displayName: "Discoverability"),
        "contentAccessibility": .init(displayName: "Content"),
        "botAccessControl": .init(displayName: "Bot Access Control"),
        "discovery": .init(displayName: "Capabilities"),
    ]

    public static let checks: [String: CheckInfo] = [
        "robotsTxt": .init(
            displayName: "Crawling rules (robots.txt)",
            passHint: "AI agents can find your site's crawling rules.",
            failHint: "AI agents can't find crawling rules for your site.",
            anglesiteProvides: true),
        "sitemap": .init(
            displayName: "Sitemap",
            passHint: "AI agents can find a map of your site's pages.",
            failHint: "AI agents can't find a map of your site's pages.",
            anglesiteProvides: true),
        "linkHeaders": .init(
            displayName: "Page discovery links",
            passHint: "Your pages point AI agents to related resources automatically.",
            failHint: "Your pages don't point AI agents to related resources (RFC 8288 Link headers).",
            anglesiteProvides: false),
        "markdownNegotiation": .init(
            displayName: "Markdown for AI agents",
            passHint: "AI agents get a clean, Markdown version of your pages instead of raw HTML.",
            failHint: "AI agents only see raw HTML — a plain-text Markdown version isn't offered yet.",
            anglesiteProvides: false),
        "contentSignals": .init(
            displayName: "Content usage signals",
            passHint: "Your site tells AI companies how they may use your content.",
            failHint: "Your site doesn't say how AI companies may use your content.",
            anglesiteProvides: true),
        "robotsTxtAiRules": .init(
            displayName: "AI crawler rules",
            passHint: "Your crawling rules include AI-specific bot instructions.",
            failHint: "Your crawling rules don't call out AI bots specifically.",
            anglesiteProvides: true),
        "webBotAuth": .init(
            displayName: "Verified bot access",
            passHint: "Your site can cryptographically verify trusted AI agents.",
            failHint: "Your site can't yet verify trusted AI agents cryptographically (Web Bot Auth).",
            anglesiteProvides: false),
        "agentSkills": .init(
            displayName: "Agent Skills manifest",
            passHint: "Your site publishes a manifest of tasks AI agents can perform for visitors.",
            failHint: "Your site doesn't publish a manifest of tasks AI agents can perform for visitors.",
            anglesiteProvides: false),
        "apiCatalog": .init(
            displayName: "API catalog",
            passHint: "Your site publishes a catalog of its APIs for AI agents to use.",
            failHint: "Your site doesn't publish a catalog of its APIs for AI agents.",
            anglesiteProvides: false),
        "mcpServerCard": .init(
            displayName: "MCP server listing",
            passHint: "AI agents can discover your site's MCP server.",
            failHint: "AI agents can't discover an MCP server for your site.",
            anglesiteProvides: false),
        "oauthDiscovery": .init(
            displayName: "Sign-in discovery for agents",
            passHint: "AI agents can find how to sign in on your visitors' behalf.",
            failHint: "AI agents can't find how to sign in on your visitors' behalf (OAuth/OIDC discovery).",
            anglesiteProvides: false),
        "oauthProtectedResource": .init(
            displayName: "Protected resource discovery",
            passHint: "AI agents can find how to access your site's protected resources.",
            failHint: "AI agents can't find how to access your site's protected resources.",
            anglesiteProvides: false),
        "webMcp": .init(
            displayName: "In-browser agent tools (WebMCP)",
            passHint: "AI agents browsing your site can use its in-page tools directly.",
            failHint: "AI agents browsing your site can't use in-page tools directly (WebMCP).",
            anglesiteProvides: false),
        "a2aAgentCard": .init(
            displayName: "Agent-to-agent card",
            passHint: "Other AI agents can discover how to work with yours.",
            failHint: "Other AI agents can't discover how to work with yours.",
            anglesiteProvides: false),
    ]

    public static func categoryDisplayName(for id: String) -> String {
        categories[id]?.displayName ?? humanize(id)
    }

    public static func checkInfo(for id: String) -> CheckInfo {
        checks[id] ?? .init(
            displayName: humanize(id),
            passHint: "This check passed.",
            failHint: "This check needs attention.",
            anglesiteProvides: false)
    }

    /// Turns a camelCase check id (e.g. `"robotsTxtAiRules"`) into a readable fallback label
    /// (`"Robots Txt Ai Rules"`) for ids not in the catalog above.
    private static func humanize(_ camelCase: String) -> String {
        var result = ""
        for (index, character) in camelCase.enumerated() {
            if character.isUppercase && index > 0 {
                result.append(" ")
            }
            result.append(index == 0 ? Character(character.uppercased()) : character)
        }
        return result
    }
}
