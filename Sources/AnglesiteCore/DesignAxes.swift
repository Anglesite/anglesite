import Foundation

/// Five design axes, each a float 0–1. Ported from the plugin's `scripts/design.ts`.
public struct DesignAxes: Sendable, Equatable, Codable {
    /// Cool (0) <-> Warm (1)
    public var temperature: Double
    /// Airy (0) <-> Dense (1)
    public var weight: Double
    /// Playful (0) <-> Authoritative (1)
    public var register: Double
    /// Classic (0) <-> Contemporary (1)
    public var time: Double
    /// Subtle (0) <-> Bold (1)
    public var voice: Double

    /// Memberwise initializer. Values are not clamped here — use
    /// ``DesignAxesCatalog/adjusted(_:by:)`` for clamped mutation and
    /// ``DesignAxesCatalog/isValid(_:)`` to vet axes from untrusted (persisted or
    /// model-generated) sources.
    public init(temperature: Double, weight: Double, register: Double, time: Double, voice: Double) {
        self.temperature = temperature; self.weight = weight; self.register = register
        self.time = time; self.voice = voice
    }
}

/// Business-type presets and helpers for ``DesignAxes`` — the deterministic seed the design
/// interview starts from, so an owner who skips the conversation entirely still gets a
/// defensible default for their kind of business. Ported from the plugin's `scripts/design.ts`.
public enum DesignAxesCatalog {
    /// Neutral fallback for unknown or empty business types — deliberately a touch airy and
    /// subtle rather than dead-center on every axis, matching the plugin's tuning.
    public static let balanced = DesignAxes(temperature: 0.5, weight: 0.4, register: 0.5, time: 0.5, voice: 0.4)

    /// Business-type -> default axes. Verbatim port of `BUSINESS_AXES` in `scripts/design.ts`.
    private static let byBusinessType: [String: DesignAxes] = [
        "restaurant":   DesignAxes(temperature: 0.75, weight: 0.45, register: 0.3,  time: 0.4,  voice: 0.5),
        "bakery":       DesignAxes(temperature: 0.8,  weight: 0.35, register: 0.25, time: 0.3,  voice: 0.45),
        "brewery":      DesignAxes(temperature: 0.7,  weight: 0.55, register: 0.35, time: 0.45, voice: 0.55),
        "hospitality":  DesignAxes(temperature: 0.7,  weight: 0.4,  register: 0.4,  time: 0.35, voice: 0.4),
        "campground":   DesignAxes(temperature: 0.65, weight: 0.4,  register: 0.3,  time: 0.3,  voice: 0.45),
        "accounting":   DesignAxes(temperature: 0.2,  weight: 0.4,  register: 0.8,  time: 0.3,  voice: 0.3),
        "insurance":    DesignAxes(temperature: 0.25, weight: 0.45, register: 0.75, time: 0.35, voice: 0.3),
        "credit-union": DesignAxes(temperature: 0.3,  weight: 0.4,  register: 0.7,  time: 0.4,  voice: 0.35),
        "real-estate":  DesignAxes(temperature: 0.35, weight: 0.45, register: 0.65, time: 0.5,  voice: 0.45),
        "healthcare":   DesignAxes(temperature: 0.35, weight: 0.3,  register: 0.6,  time: 0.6,  voice: 0.3),
        "pharmacy":     DesignAxes(temperature: 0.3,  weight: 0.35, register: 0.65, time: 0.55, voice: 0.25),
        "cleaning":     DesignAxes(temperature: 0.35, weight: 0.3,  register: 0.5,  time: 0.6,  voice: 0.35),
        "grocery":      DesignAxes(temperature: 0.45, weight: 0.4,  register: 0.4,  time: 0.5,  voice: 0.4),
        "fitness":      DesignAxes(temperature: 0.45, weight: 0.7,  register: 0.55, time: 0.7,  voice: 0.8),
        "trades":       DesignAxes(temperature: 0.4,  weight: 0.65, register: 0.6,  time: 0.5,  voice: 0.7),
        "auto-dealer":  DesignAxes(temperature: 0.35, weight: 0.7,  register: 0.6,  time: 0.6,  voice: 0.75),
        "car-wash":     DesignAxes(temperature: 0.4,  weight: 0.6,  register: 0.5,  time: 0.6,  voice: 0.65),
        "plumber":      DesignAxes(temperature: 0.4,  weight: 0.6,  register: 0.55, time: 0.5,  voice: 0.6),
        "electrician":  DesignAxes(temperature: 0.35, weight: 0.6,  register: 0.55, time: 0.55, voice: 0.6),
        "farm":         DesignAxes(temperature: 0.6,  weight: 0.45, register: 0.4,  time: 0.2,  voice: 0.4),
        "florist":      DesignAxes(temperature: 0.6,  weight: 0.3,  register: 0.3,  time: 0.35, voice: 0.45),
        "hardware":     DesignAxes(temperature: 0.5,  weight: 0.55, register: 0.5,  time: 0.3,  voice: 0.5),
        "veterinarian": DesignAxes(temperature: 0.55, weight: 0.4,  register: 0.45, time: 0.4,  voice: 0.4),
        "childcare":    DesignAxes(temperature: 0.7,  weight: 0.3,  register: 0.15, time: 0.6,  voice: 0.7),
        "pet-services": DesignAxes(temperature: 0.65, weight: 0.35, register: 0.2,  time: 0.55, voice: 0.65),
        "dance-studio": DesignAxes(temperature: 0.6,  weight: 0.3,  register: 0.2,  time: 0.65, voice: 0.7),
        "youth-org":    DesignAxes(temperature: 0.6,  weight: 0.35, register: 0.25, time: 0.6,  voice: 0.6),
        "entertainment": DesignAxes(temperature: 0.55, weight: 0.4, register: 0.2,  time: 0.65, voice: 0.75),
        "salon":        DesignAxes(temperature: 0.4,  weight: 0.3,  register: 0.65, time: 0.7,  voice: 0.5),
        "photography":  DesignAxes(temperature: 0.35, weight: 0.25, register: 0.6,  time: 0.7,  voice: 0.55),
        "jewelry":      DesignAxes(temperature: 0.3,  weight: 0.25, register: 0.7,  time: 0.6,  voice: 0.45),
        "community-theater": DesignAxes(temperature: 0.45, weight: 0.35, register: 0.55, time: 0.5, voice: 0.55),
        "hotel":        DesignAxes(temperature: 0.4,  weight: 0.35, register: 0.7,  time: 0.55, voice: 0.4),
        "nonprofit":    DesignAxes(temperature: 0.55, weight: 0.4,  register: 0.4,  time: 0.5,  voice: 0.45),
        "house-of-worship": DesignAxes(temperature: 0.6, weight: 0.4, register: 0.45, time: 0.3, voice: 0.4),
        "social-services": DesignAxes(temperature: 0.55, weight: 0.4, register: 0.45, time: 0.5, voice: 0.4),
        "food-bank":    DesignAxes(temperature: 0.6,  weight: 0.4,  register: 0.35, time: 0.45, voice: 0.45),
        "animal-shelter": DesignAxes(temperature: 0.6, weight: 0.35, register: 0.3, time: 0.5, voice: 0.5),
    ]

    /// Default axis positions for a business type. Falls back to ``balanced`` for unknown types.
    /// Matches only on the substring before the first comma, lowercased and trimmed.
    public static func defaults(forBusinessType businessType: String) -> DesignAxes {
        guard !businessType.isEmpty else { return balanced }
        let key = businessType.lowercased().split(separator: ",", maxSplits: 1)[0]
            .trimmingCharacters(in: .whitespaces)
        return byBusinessType[key] ?? balanced
    }

    /// Applies each delta to the named axis, clamping the result to [0, 1].
    public static func adjusted(_ axes: DesignAxes, by deltas: [WritableKeyPath<DesignAxes, Double>: Double]) -> DesignAxes {
        var result = axes
        for (keyPath, delta) in deltas {
            result[keyPath: keyPath] = max(0, min(1, result[keyPath: keyPath] + delta))
        }
        return result
    }

    /// `true` when every axis is a non-NaN value in [0, 1]. Guards axes that arrive from data
    /// this module didn't produce (persisted config, model-generated values) —
    /// ``adjusted(_:by:)`` already clamps its own writes, so this check exists for the paths
    /// that bypass it.
    public static func isValid(_ axes: DesignAxes) -> Bool {
        [axes.temperature, axes.weight, axes.register, axes.time, axes.voice]
            .allSatisfy { !$0.isNaN && $0 >= 0 && $0 <= 1 }
    }
}
