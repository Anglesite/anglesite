import Foundation
import AnglesiteCore

/// Backs the Acknowledgments window (App menu, next to About). Kept separate from the SwiftUI
/// view so grouping/search/error-handling logic is unit-testable without a rendering harness —
/// same split as `TokenOnboarding`/`DeployModel`.
@MainActor
@Observable
public final class AcknowledgmentsViewModel {
    public private(set) var catalogs: [AttributionSource: [OSSAttribution]] = [:]
    public var searchText: String = ""
    public var selection: OSSAttribution.ID?
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

    public func attribution(withID id: OSSAttribution.ID) -> OSSAttribution? {
        catalogs.values.flatMap { $0 }.first { $0.id == id }
    }
}
