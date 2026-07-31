// Sources/AnglesiteIntents/SiriReadinessIntentProbes.swift
import AnglesiteCore
import AppIntents  // load-bearing: AnglesiteShortcuts.appShortcuts default-arg resolves [AppShortcut]

/// Confirms Anglesite's App Shortcuts are registered (the surface Siri/Spotlight enumerate).
/// Count is injectable; the default reads the live provider.
public struct AppIntentsRegistrationProbe: ReadinessProbe {
    /// Stable finding id (`ReadinessProbe` requirement) — keyed, not display text, so UI can
    /// track a finding across runs.
    public let id = "intents.registration"
    /// Human-facing row title shown in the readiness report.
    public let title = "App Intents & Shortcuts"
    /// `nil` means "read the live count at `check()` time". Resolving it lazily (rather than as a
    /// default argument) avoids reading the provider at struct-construction time, which can run
    /// before `AppDependencyManager` finishes wiring App Intents. `AnglesiteShortcuts.appShortcuts`
    /// is a static `@AppShortcutsBuilder` literal, so the live count is environment-independent.
    private let shortcutCount: Int?

    /// Pass a count to pin the probe's input in tests; the `nil` default defers to the live
    /// ``AnglesiteShortcuts`` provider at check time (see `shortcutCount` for why lazily).
    public init(shortcutCount: Int? = nil) {
        self.shortcutCount = shortcutCount
    }

    /// `.ok` when at least one App Shortcut is registered; `.warning` (with a relaunch
    /// remediation) when none are — an empty provider means Siri/Spotlight can't discover
    /// Anglesite at all.
    public func check() async -> ReadinessFinding {
        let shortcutCount = self.shortcutCount ?? AnglesiteShortcuts.appShortcuts.count
        if shortcutCount > 0 {
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "\(shortcutCount) Anglesite shortcuts are registered for Siri and Spotlight.")
        }
        return ReadinessFinding(id: id, title: title, level: .warning,
            detail: "No Anglesite shortcuts are registered.",
            remediation: "Relaunch Anglesite so the system re-registers its App Shortcuts.")
    }
}

/// Reports whether the build includes Swift 6.4 View Annotations (the onscreen-awareness path
/// that lets Siri act on the site you're viewing). Compile-time gated; injectable for tests.
public struct ViewAnnotationsProbe: ReadinessProbe {
    /// Stable finding id (`ReadinessProbe` requirement).
    public let id = "view.annotations"
    /// Human-facing row title shown in the readiness report.
    public let title = "Onscreen awareness (View Annotations)"
    private let compiled: Bool

    /// The default reads the compile-time truth (``builtWithAnnotations``); tests inject the
    /// other branch, since a single binary can only ever exercise one side of the `#if`.
    public init(compiled: Bool = ViewAnnotationsProbe.builtWithAnnotations) {
        self.compiled = compiled
    }

    /// Whether this binary was compiled with Swift 6.4+, where the view-annotation APIs exist.
    /// A computed property (not a stored `let`) so the `#if compiler` check reads as one
    /// expression at the probe's default-argument site.
    public static var builtWithAnnotations: Bool {
        #if compiler(>=6.4)
        return true
        #else
        return false
        #endif
    }

    /// `.ok` when built with annotations; `.unsupported` (not `.warning`) otherwise — the user
    /// can't fix a compile-time gap short of installing a newer build, so nagging is wrong.
    public func check() async -> ReadinessFinding {
        if compiled {
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "Site windows publish an entity identifier, so Siri can act on the site you're viewing.")
        }
        return ReadinessFinding(id: id, title: title, level: .unsupported,
            detail: "This build was compiled without Swift 6.4 view-annotation support.",
            remediation: "Use a build produced with Xcode 27 / Swift 6.4 or later.")
    }
}

/// Reports whether Anglesite's tools are exposed to the system-wide MCP bridge. Unbuilt today
/// (Phase D, #135) — defaults to `.unsupported`; flips to a real check when #164/#101 land.
public struct SystemMCPBridgeProbe: ReadinessProbe {
    /// Stable finding id (`ReadinessProbe` requirement).
    public let id = "mcp.bridge"
    /// Human-facing row title shown in the readiness report.
    public let title = "System-wide MCP bridge"
    private let registered: Bool

    // TODO(#135): replace the `false` default with a live system-MCP-bridge registration check
    // once Phase D lands (#164/#101). Until then this probe truthfully reports `.unsupported`.
    /// The `false` default is honest, not a stub-smell: system-MCP exposure is unbuilt (Phase D,
    /// #135), so production constructs an always-`.unsupported` probe by design.
    public init(registered: Bool = false) {
        self.registered = registered
    }

    /// `.ok` when tools are registered with the bridge; `.unsupported` otherwise. Uses
    /// `.unsupported` rather than `.warning` because there is nothing the user can do about it.
    public func check() async -> ReadinessFinding {
        if registered {
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "Anglesite's tools are exposed to the system MCP bridge for external agents.")
        }
        return ReadinessFinding(id: id, title: title, level: .unsupported,
            detail: "System-wide MCP exposure is not available in this build (Phase D, #135).")
    }
}
