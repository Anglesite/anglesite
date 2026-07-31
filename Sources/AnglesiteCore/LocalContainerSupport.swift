/// Decides whether `LocalContainerSiteRuntime` can run on this build/host. The entitlement is the
/// real gate (it's unforgeable — Virtualization.framework rejects VM configurations from a process
/// whose signature lacks it, loudly, at `validate()`), so no feature flag is needed: a build
/// without it simply reports `false` and the app falls back to `UnavailableSiteRuntime` /
/// `RemoteSandboxSiteRuntime`. The entitlement itself is unrestricted — any signature works,
/// including ad-hoc Debug builds; no Apple approval or provisioning-profile grant is involved
/// (verified 2026-07-07 via `scripts/run-container-probe.sh` under `codesign --sign -`).
public enum LocalContainerSupport {
    /// The gate's result. `unavailable` carries *every* failing precondition, not just the
    /// first, so UI can tell the user the complete story in one pass.
    public enum Availability: Sendable, Equatable {
        /// The local container runtime can run on this build/host.
        case available
        /// It cannot; the reasons list every failed precondition, in declaration order.
        case unavailable([UnavailabilityReason])

        /// Collapse to a Bool for callers that only branch and don't need to explain why.
        public var isAvailable: Bool {
            if case .available = self { true } else { false }
        }
    }

    /// The individual preconditions the gate checks. `String` raw values so a reason can be
    /// logged or compared stably across builds.
    public enum UnavailabilityReason: String, Sendable, Equatable, CaseIterable {
        /// The host CPU is not arm64 — Apple Containerization requires Apple Silicon.
        case notAppleSilicon
        /// The host OS predates macOS 26, the Apple-Containerization floor (see
        /// ``LocalContainerSupport/hostOSIsSupported``).
        case unsupportedOS
        /// The running binary's signature lacks `com.apple.security.virtualization` (see
        /// ``LocalContainerSupport/hostHasVirtualizationEntitlement``).
        case missingVirtualizationEntitlement

        /// A short human-readable explanation of the failed precondition.
        public var description: String {
            switch self {
            case .notAppleSilicon:
                "Apple Silicon is required"
            case .unsupportedOS:
                "macOS 26 or newer is required"
            case .missingVirtualizationEntitlement:
                "signed build is missing com.apple.security.virtualization"
            }
        }
    }

    /// Boolean collapse of ``availability(isAppleSilicon:osIsSupported:hasVirtualizationEntitlement:)``
    /// for callers that only branch. Same parameter story: defaults are the host probes,
    /// overridable for tests and for the app's real entitlement probe.
    public static func isAvailable(
        isAppleSilicon: Bool = hostIsAppleSilicon,
        osIsSupported: Bool = hostOSIsSupported,
        hasVirtualizationEntitlement: Bool = hostHasVirtualizationEntitlement
    ) -> Bool {
        availability(
            isAppleSilicon: isAppleSilicon,
            osIsSupported: osIsSupported,
            hasVirtualizationEntitlement: hasVirtualizationEntitlement
        ).isAvailable
    }

    /// Evaluates every precondition rather than short-circuiting on the first failure, so the
    /// result can present the complete list of blockers at once. Each parameter defaults to
    /// this type's host probe and exists as an override seam — for tests, and (for the
    /// entitlement) for the app target's real `AnglesiteContainer`-backed probe, since the
    /// default here is conservatively false (see ``hostHasVirtualizationEntitlement``).
    public static func availability(
        isAppleSilicon: Bool = hostIsAppleSilicon,
        osIsSupported: Bool = hostOSIsSupported,
        hasVirtualizationEntitlement: Bool = hostHasVirtualizationEntitlement
    ) -> Availability {
        var reasons: [UnavailabilityReason] = []
        if !isAppleSilicon { reasons.append(.notAppleSilicon) }
        if !osIsSupported { reasons.append(.unsupportedOS) }
        if !hasVirtualizationEntitlement { reasons.append(.missingVirtualizationEntitlement) }
        return reasons.isEmpty ? .available : .unavailable(reasons)
    }

    /// True on arm64. Intel Macs report false.
    public static var hostIsAppleSilicon: Bool {
        #if arch(arm64)
        return true
        #else
        return false
        #endif
    }

    /// True on macOS 26+ (the Apple-Containerization floor; intentionally below the app's macOS 27
    /// deployment target — every host the app runs on qualifies; do not raise this check).
    public static var hostOSIsSupported: Bool {
        if #available(macOS 26.0, *) { return true } else { return false }
    }

    /// Whether this process carries `com.apple.security.virtualization`. Read from the signed
    /// entitlements via `SecTaskCopyValueForEntitlement`; absent/unsigned → false. The concrete
    /// probe lives in `AnglesiteContainer` (it needs `Security`/`Virtualization` to confirm a
    /// usable VM); in `AnglesiteCore` the default is conservatively false so CI never selects the
    /// container path. Production overrides this via the `isAvailable(...)` parameter from the app.
    public static var hostHasVirtualizationEntitlement: Bool { false }
}
