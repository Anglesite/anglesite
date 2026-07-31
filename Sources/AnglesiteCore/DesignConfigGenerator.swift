import Foundation

/// The generated font choices, as literal CSS `font-family` stacks ready to drop into custom
/// properties — system/web-safe fonts only, so no font files ever ship with the site.
public struct DesignTypography: Sendable, Equatable, Codable {
    /// Font stack for headings and other display text.
    public let display: String
    /// Font stack for body copy.
    public let body: String
    /// Stable identifier naming the chosen combination (e.g. `classic-serif+modern-sans`) —
    /// recorded in the design rationale so a human can tell which pairing won without diffing
    /// font stacks.
    public let pairing: String
    /// Memberwise initializer.
    public init(display: String, body: String, pairing: String) { self.display = display; self.body = body; self.pairing = pairing }
}

/// The generated spacing scale, smallest to largest, as literal CSS lengths (`rem` strings) so
/// values flow straight into custom properties without a formatting step downstream.
public struct DesignSpacing: Sendable, Equatable, Codable {
    /// The five scale steps, smallest (`xs`) to largest (`xl`).
    public let xs, sm, md, lg, xl: String
    /// Memberwise initializer.
    public init(xs: String, sm: String, md: String, lg: String, xl: String) {
        self.xs = xs; self.sm = sm; self.md = md; self.lg = lg; self.xl = xl
    }
}

/// The generated corner radii and box shadows, as literal CSS values — same "ready to write"
/// rationale as ``DesignSpacing``.
public struct DesignShape: Sendable, Equatable, Codable {
    /// Radii (small/medium/large) and shadows (small/medium) as CSS value strings.
    public let radiusSm, radiusMd, radiusLg, shadowSm, shadowMd: String
    /// Memberwise initializer.
    public init(radiusSm: String, radiusMd: String, radiusLg: String, shadowSm: String, shadowMd: String) {
        self.radiusSm = radiusSm; self.radiusMd = radiusMd; self.radiusLg = radiusLg
        self.shadowSm = shadowSm; self.shadowMd = shadowMd
    }
}

/// The complete generated design for one site — the single artifact ``DesignTokenWriter`` turns
/// into template CSS vars and rationale markdown. `Codable` and carrying its own inputs
/// (``axes``, ``siteType``, ``brandColor``) so a design can be persisted and regenerated or
/// audited later without replaying the interview that produced it.
public struct DesignConfig: Sendable, Equatable, Codable {
    /// The axis positions this config was generated from.
    public let axes: DesignAxes
    /// The generated color palette.
    public let palette: DesignPalette
    /// The generated font pairing.
    public let typography: DesignTypography
    /// The generated spacing scale.
    public let spacing: DesignSpacing
    /// The generated radii and shadows.
    public let shape: DesignShape
    /// The business type the design was generated for — an input, kept for provenance.
    public let siteType: String
    /// The owner's brand color the palette was anchored to, or `nil` when it was derived from
    /// the axes alone — also an input, kept for provenance.
    public let brandColor: String?

    /// Memberwise initializer — prefer ``DesignConfigGenerator/config(axes:siteType:brandColor:)``,
    /// which keeps the parts mutually consistent.
    public init(axes: DesignAxes, palette: DesignPalette, typography: DesignTypography,
                spacing: DesignSpacing, shape: DesignShape, siteType: String, brandColor: String?) {
        self.axes = axes; self.palette = palette; self.typography = typography
        self.spacing = spacing; self.shape = shape; self.siteType = siteType; self.brandColor = brandColor
    }
}

/// Maps ``DesignAxes`` to a concrete ``DesignConfig`` with pure arithmetic — deterministic by
/// design, so the same axes always regenerate the identical design with no model in the loop
/// (the LLM's only job upstream is moving the axes; everything from there down is auditable
/// math).
public enum DesignConfigGenerator {
    private struct FontPairing {
        let display: String
        let body: String
        let pairing: String
        let score: (DesignAxes) -> Double
    }

    private static let fontPairings: [FontPairing] = [
        FontPairing(display: #"Georgia, "Times New Roman", Times, serif"#,
                    body: "system-ui, -apple-system, sans-serif",
                    pairing: "classic-serif+modern-sans",
                    score: { (1 - $0.time) * 2 + $0.register * 1.5 + (1 - $0.voice) * 0.5 }),
        FontPairing(display: "system-ui, -apple-system, sans-serif",
                    body: "system-ui, -apple-system, sans-serif",
                    pairing: "modern-sans+modern-sans",
                    score: { $0.time * 1.5 + (1 - $0.register) * 1 + $0.voice * 0.5 }),
        FontPairing(display: #""Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif"#,
                    body: #""Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif"#,
                    pairing: "humanist-sans+humanist-sans",
                    score: { $0.temperature * 1.5 + (1 - $0.register) * 1 + (1 - $0.voice) * 0.5 }),
        FontPairing(display: #"Georgia, "Times New Roman", Times, serif"#,
                    body: #""Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif"#,
                    pairing: "classic-serif+humanist-sans",
                    score: { (1 - $0.time) * 1.5 + $0.register * 1 + $0.temperature * 0.8 }),
        FontPairing(display: "system-ui, -apple-system, sans-serif",
                    body: #""Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif"#,
                    pairing: "modern-sans+humanist-sans",
                    score: { $0.time * 1 + $0.temperature * 0.8 + (1 - $0.register) * 0.8 }),
    ]

    /// Picks the highest-scoring built-in font pairing for `axes`. Each candidate scores itself
    /// against the axes (see `fontPairings`), so adding a pairing means adding a scoring
    /// closure, not editing a decision tree.
    public static func typography(for axes: DesignAxes) -> DesignTypography {
        let best = fontPairings.max { $0.score(axes) < $1.score(axes) } ?? fontPairings[0]
        return DesignTypography(display: best.display, body: best.body, pairing: best.pairing)
    }

    /// Airy (weight=0) -> generous spacing (1.2x). Dense (weight=1) -> tighter (0.8x).
    public static func spacing(for axes: DesignAxes) -> DesignSpacing {
        let m = 1.2 - axes.weight * 0.4
        func fmt(_ v: Double) -> String { "\((v * 1000).rounded() / 1000)rem" }
        return DesignSpacing(xs: fmt(0.25 * m), sm: fmt(0.5 * m), md: fmt(1 * m), lg: fmt(2 * m), xl: fmt(4 * m))
    }

    /// Playful (low register) + contemporary (high time) -> rounder. Bold (voice) -> stronger shadows.
    public static func shape(for axes: DesignAxes) -> DesignShape {
        let roundness = (1 - axes.register) * 0.6 + axes.time * 0.4
        func fmt(_ v: Double) -> String { "\((v * 1000).rounded() / 1000)rem" }
        let shadowAlpha = 0.06 + axes.voice * 0.08
        let shadowSpread = 2 + axes.weight * 4
        return DesignShape(
            radiusSm: fmt(0.125 + roundness * 0.25),
            radiusMd: fmt(0.25 + roundness * 0.5),
            radiusLg: fmt(0.5 + roundness * 1.0),
            shadowSm: "0 1px \(Int(shadowSpread.rounded()))px rgba(0, 0, 0, \(String(format: "%.2f", shadowAlpha)))",
            shadowMd: "0 \(Int(shadowSpread.rounded()))px \(Int((shadowSpread * 3).rounded()))px rgba(0, 0, 0, \(String(format: "%.2f", shadowAlpha * 1.5)))"
        )
    }

    /// Assembles the full ``DesignConfig`` from one set of axes — the single entry point (used
    /// by `DesignInterviewModel.confirmAndApply`), so palette, typography, spacing, and shape
    /// are always derived from the *same* axes and can't drift apart.
    public static func config(axes: DesignAxes, siteType: String, brandColor: String?) -> DesignConfig {
        DesignConfig(
            axes: axes,
            palette: DesignPaletteGenerator.generate(axes: axes, brandColor: brandColor),
            typography: typography(for: axes),
            spacing: spacing(for: axes),
            shape: shape(for: axes),
            siteType: siteType,
            brandColor: brandColor
        )
    }
}
