import Foundation
// canImport joins the compiler gate: >=6.4 alone was a proxy for "the Xcode 27 SDK is
// present", which a Swift 6.4 Linux toolchain will satisfy without having FoundationModels.
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
#endif

/// Confirms the running OS meets Anglesite's macOS floor. Version is injectable so the
/// mapping is testable without spoofing the process environment.
public struct OSRuntimeProbe: ReadinessProbe {
    /// Stable probe id, echoed into the finding.
    public let id = "os.runtime"
    /// User-facing check title, carried into every finding this probe returns.
    public let title = "macOS runtime"
    private let version: OperatingSystemVersion
    private let minimumMajor: Int

    /// Creates the probe. The defaults check the live process against Anglesite's macOS 27
    /// floor; tests inject `version` to exercise the mapping without spoofing the host OS.
    public init(
        version: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion,
        minimumMajor: Int = 27
    ) {
        self.version = version
        self.minimumMajor = minimumMajor
    }

    /// Passes when the major version meets the floor; otherwise fails with a Software Update
    /// remediation. Only the major version gates — minor/patch appear in the detail text for
    /// honesty, not in the comparison.
    public func check() async -> ReadinessFinding {
        // Include the patch so a user on e.g. 26.9.5 doesn't see a misleading "26.9 is below…".
        let running = "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        if version.majorVersion >= minimumMajor {
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "macOS \(running) meets the macOS \(minimumMajor) requirement for Siri workflows.")
        }
        return ReadinessFinding(id: id, title: title, level: .failure,
            detail: "macOS \(running) is below the macOS \(minimumMajor) requirement.",
            remediation: "Update to macOS \(minimumMajor) or later in System Settings ▸ General ▸ Software Update.")
    }
}

/// Normalized Foundation Models availability, decoupled from the SDK enum so the probe
/// mapping is testable without the framework.
public enum FoundationModelsAvailability: Sendable, Equatable {
    /// The on-device model can serve requests now.
    case available
    /// The user has Apple Intelligence turned off — remediable in System Settings.
    case appleIntelligenceNotEnabled
    /// Eligible device, but the model is still downloading or preparing — transient.
    case modelNotReady
    /// This hardware can't run the model; no remediation exists.
    case deviceNotEligible
    /// Availability couldn't be classified; carries the SDK's own description so the finding
    /// can still say something concrete.
    case unknown(String)
}

/// Reports whether Apple's on-device language model is usable. Availability is injected so
/// tests never touch the live model; the live source reads `SystemLanguageModel` (no inference).
public struct FoundationModelsProbe: ReadinessProbe {
    /// Stable probe id, echoed into the finding.
    public let id = "foundation.models"
    /// User-facing check title, carried into every finding this probe returns.
    public let title = "Apple Foundation Models"
    private let availability: @Sendable () -> FoundationModelsAvailability

    /// Creates the probe with an injected availability source. Production passes
    /// `LiveFoundationModelsAvailability.current`; tests pass a closure returning a fixed case.
    public init(availability: @escaping @Sendable () -> FoundationModelsAvailability) {
        self.availability = availability
    }

    /// Maps availability onto a finding. Transient/remediable states are warnings with a
    /// remediation; ineligible hardware is `.unsupported` rather than a failure, because
    /// there's nothing the owner can do about it.
    public func check() async -> ReadinessFinding {
        switch availability() {
        case .available:
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "The on-device language model is available for summarization and chat.")
        case .appleIntelligenceNotEnabled:
            return ReadinessFinding(id: id, title: title, level: .warning,
                detail: "Apple Intelligence is turned off.",
                remediation: "Enable Apple Intelligence in System Settings ▸ Apple Intelligence & Siri.")
        case .modelNotReady:
            return ReadinessFinding(id: id, title: title, level: .warning,
                detail: "The on-device model is still downloading or preparing.",
                remediation: "Wait for the model to finish downloading, then re-check.")
        case .deviceNotEligible:
            return ReadinessFinding(id: id, title: title, level: .unsupported,
                detail: "This Mac does not support Apple Foundation Models.")
        case .unknown(let reason):
            return ReadinessFinding(id: id, title: title, level: .warning,
                detail: "Foundation Models availability could not be determined: \(reason).")
        }
    }
}

/// Live availability source. Reads `SystemLanguageModel.default.availability` (no inference).
/// Case names below must match the `FoundationModels` SDK; `@unknown default` absorbs drift.
public enum LiveFoundationModelsAvailability {
    /// The current availability, or `.unknown` when the framework isn't present at build time
    /// (older toolchain, or a platform without FoundationModels). Reads availability only —
    /// never triggers inference or a model download.
    public static func current() -> FoundationModelsAvailability {
        #if compiler(>=6.4) && canImport(FoundationModels)
        switch SystemLanguageModel.default.availability {
        case .available:
            return .available
        case .unavailable(let reason):
            switch reason {
            case .appleIntelligenceNotEnabled: return .appleIntelligenceNotEnabled
            case .modelNotReady: return .modelNotReady
            case .deviceNotEligible: return .deviceNotEligible
            @unknown default: return .unknown("\(reason)")
            }
        @unknown default:
            return .unknown("unrecognized availability")
        }
        #else
        return .unknown("FoundationModels unavailable at build time")
        #endif
    }
}
