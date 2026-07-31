import Foundation

/// Expected per-segment durations of a dev-server startup, used to pace the smooth fill of the
/// startup progress bar between milestone anchors. One segment per gap in the milestone sequence
/// launching → building → connecting → ready.
public struct StartupProfile: Sendable, Equatable, Codable {
    /// Seconds from process spawn to the first astro stdout line.
    public var launchingToBuilding: TimeInterval
    /// Seconds from the first astro stdout line to the dev server printing its ready URL —
    /// typically the longest segment (the Astro/Vite build).
    public var buildingToConnecting: TimeInterval
    /// Seconds from the ready URL appearing to the runtime reporting `.ready`.
    public var connectingToReady: TimeInterval

    /// Creates a profile from three measured (or estimated) segment durations. Not validated
    /// here — readers gate on ``isPlausible`` instead, so a degenerate measurement can still be
    /// constructed, inspected, and then rejected at the persistence boundary.
    public init(launchingToBuilding: TimeInterval, buildingToConnecting: TimeInterval, connectingToReady: TimeInterval) {
        self.launchingToBuilding = launchingToBuilding
        self.buildingToConnecting = buildingToConnecting
        self.connectingToReady = connectingToReady
    }

    /// Built-in fallback used on first run and when stored timing is missing/corrupt. Calibrated
    /// to the default template: a quick spawn, a few seconds of Astro/Vite build, a short tail.
    public static let `default` = StartupProfile(
        launchingToBuilding: 0.5,
        buildingToConnecting: 3.0,
        connectingToReady: 1.5
    )

    /// Whether every segment is finite and non-negative and the total is within a sane ceiling.
    /// Guards against persisting a degenerate or absurd measurement (e.g. a machine asleep mid-boot).
    public var isPlausible: Bool {
        let segments = [launchingToBuilding, buildingToConnecting, connectingToReady]
        guard segments.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return false }
        let total = segments.reduce(0, +)
        return total > 0 && total <= 120
    }
}

/// Persists the most recent *successful* `StartupProfile` per site in `UserDefaults`, so the next
/// startup can pace its progress bar against how long the last one actually took. Reads fall back
/// to `StartupProfile.default` whenever nothing plausible is stored.
public final class StartupTimingStore: @unchecked Sendable {
    /// Shared instance bound to `UserDefaults.standard`. Tests construct their own with a scratch suite.
    public static let shared = StartupTimingStore(defaults: .standard)

    private let defaults: UserDefaults

    /// Creates a store over `defaults`. Injectable so tests can use a scratch suite instead of
    /// polluting (or depending on) `UserDefaults.standard`.
    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    private func key(for siteID: String) -> String { "anglesite.startupTiming.\(siteID)" }

    /// Last successful profile for `siteID`, or `.default` when absent, undecodable, or implausible.
    public func profile(for siteID: String) -> StartupProfile {
        guard
            let data = defaults.data(forKey: key(for: siteID)),
            let decoded = try? JSONDecoder().decode(StartupProfile.self, from: data),
            decoded.isPlausible
        else {
            return .default
        }
        return decoded
    }

    /// Persist a completed successful startup. Implausible or unencodable profiles are dropped.
    public func record(_ profile: StartupProfile, for siteID: String) {
        guard profile.isPlausible, let data = try? JSONEncoder().encode(profile) else { return }
        defaults.set(data, forKey: key(for: siteID))
    }
}
