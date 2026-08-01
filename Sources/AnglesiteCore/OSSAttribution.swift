import Foundation

/// One third-party package Anglesite discloses in the Acknowledgments window — see
/// docs/superpowers/specs/2026-07-31-oss-attributions-design.md. `licenseText` is the package's
/// full, actual license text (never just an SPDX id looked up against a generic template), so the
/// window stays fully correct offline. `homepage` is a plain string, not `URL`, because generator
/// scripts source it from raw `Package.resolved`/`package.json` values that don't always parse as
/// a strict `URL` (e.g. `git+https://…` before stripping); consumers that need a `URL` construct
/// one with `URL(string:)` and treat failure as "no link".
public struct OSSAttribution: Codable, Sendable, Identifiable, Hashable {
    public var id: String { "\(name)@\(version)" }
    public let name: String
    public let version: String
    public let licenseSPDXId: String?
    public let licenseText: String
    public let homepage: String?

    public init(name: String, version: String, licenseSPDXId: String?, licenseText: String, homepage: String?) {
        self.name = name
        self.version = version
        self.licenseSPDXId = licenseSPDXId
        self.licenseText = licenseText
        self.homepage = homepage
    }
}

/// One of the three channels Anglesite distributes third-party code through. The raw value is
/// also the manifest file stem: `Resources/Attributions/<rawValue>.json`.
public enum AttributionSource: String, CaseIterable, Codable, Sendable {
    /// SwiftPM packages linked directly into `Anglesite.app` (see `Package.resolved`).
    case appBinary = "app-binary"
    /// npm packages inside the vendored container image's MCP sidecar (the sidecar repo's
    /// root `node_modules` — `server/` itself is staged without `node_modules`; see
    /// `scripts/lib/stage-dev-image-context.sh`).
    case containerImage = "container-image"
    /// npm packages scaffolded into every new site from `Resources/Template/package.json`.
    case websiteTemplate = "website-template"

    public var displayName: String {
        switch self {
        case .appBinary: "App"
        case .containerImage: "Container & Sidecar"
        case .websiteTemplate: "Website Template"
        }
    }
}
