import Foundation
import AnglesiteCore

/// Identifies one row in the Acknowledgments list. `OSSAttribution.id` (`name@version`) is not
/// unique across sources on its own — the app-binary, container-image, and website-template
/// manifests are independently-generated dependency trees that can (and do) share identical
/// `name@version` pairs, e.g. npm packages common to both the container image and the website
/// template. Pairing the id with its source keeps SwiftUI `List` selection/tagging unique and
/// lookups unambiguous.
public struct SelectedAttribution: Hashable, Sendable {
    public let source: AttributionSource
    public let id: OSSAttribution.ID

    public init(source: AttributionSource, id: OSSAttribution.ID) {
        self.source = source
        self.id = id
    }
}

/// Backs the Acknowledgments window (App menu, next to About). Kept separate from the SwiftUI
/// view so grouping/search/error-handling logic is unit-testable without a rendering harness —
/// same split as `TokenOnboarding`/`DeployModel`.
@MainActor
@Observable
public final class AcknowledgmentsViewModel {
    public private(set) var catalogs: [AttributionSource: [OSSAttribution]] = [:]
    public var searchText: String = ""
    public var selection: SelectedAttribution?
    public private(set) var unavailableSources: Set<AttributionSource> = []

    private let load: (AttributionSource) throws -> [OSSAttribution]
    private let log: (String) -> Void

    public init(
        load: @escaping (AttributionSource) throws -> [OSSAttribution] = { try AttributionCatalog.load($0) },
        log: @escaping (String) -> Void = { message in
            Task { await LogCenter.shared.append(source: "acknowledgments", stream: .stderr, text: message) }
        }
    ) {
        self.load = load
        self.log = log
    }

    /// Loads all three sources independently — one source failing to decode must not hide the
    /// other two (see `AttributionCatalogError`).
    public func loadAll() {
        for source in AttributionSource.allCases {
            do {
                catalogs[source] = try load(source)
            } catch {
                unavailableSources.insert(source)
                log("Failed to load \(source.rawValue) attributions: \(error)")
            }
        }
    }

    public func filtered(_ source: AttributionSource) -> [OSSAttribution] {
        let entries = catalogs[source] ?? []
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return entries }
        return entries.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    public func attribution(withID selection: SelectedAttribution) -> OSSAttribution? {
        catalogs[selection.source]?.first { $0.id == selection.id }
    }
}
