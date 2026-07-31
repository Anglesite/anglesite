import Foundation

/// Color tokens for a generated design. Ported from the plugin's `scripts/design.ts` `Palette`.
public struct DesignPalette: Sendable, Equatable, Codable {
    /// Primary brand color (hex). Either the owner's own brand color verbatim, or derived
    /// from the temperature axis when none was given.
    public let brand: String
    /// Call-to-action color (hex) — hue-offset from ``brand`` (complementary for bold voice,
    /// analogous otherwise) so CTAs read as related but distinct.
    public let accent: String
    /// Page background (hex). Near-white normally; near-black when the axes select dark mode.
    public let bg: String
    /// Raised-surface color for cards/panels (hex), one step off ``bg`` in the same hue family.
    public let surface: String
    /// Body text color (hex) — contrast-corrected against ``bg`` to meet WCAG AA before the
    /// palette is returned, so consumers can use it without re-checking.
    public let text: String
    /// Secondary/muted text color (hex) — also contrast-corrected against ``bg``.
    public let muted: String
    /// Hairline/divider color (hex).
    public let border: String

    /// Memberwise initializer. All values are `#rrggbb` hex strings; ``DesignPaletteGenerator``
    /// is the normal producer — construct directly only in tests or when decoding a stored design.
    public init(brand: String, accent: String, bg: String, surface: String, text: String, muted: String, border: String) {
        self.brand = brand; self.accent = accent; self.bg = bg; self.surface = surface
        self.text = text; self.muted = muted; self.border = border
    }
}

/// Namespace for deterministic palette derivation from ``DesignAxes``. A direct port of the
/// plugin's `scripts/design.ts` color math — kept verbatim so the Swift path and the retired
/// TypeScript path produce identical palettes for the same inputs.
public enum DesignPaletteGenerator {
    /// Deterministic palette generation from design axes, ported verbatim from `generatePalette` in
    /// `scripts/design.ts`. If `brandColor` is a valid hex, it becomes the brand color and the rest
    /// is derived from it; otherwise the brand color is derived from `axes.temperature`.
    public static func generate(axes: DesignAxes, brandColor: String?) -> DesignPalette {
        let isDarkMode = axes.weight > 0.75 && axes.voice > 0.7

        var brandH: Double, brandS: Double, brandL: Double
        if let brandColor, let rgb = WCAGContrast.hexToRGB(brandColor) {
            (brandH, brandS, brandL) = hexToHSL(rgb)
        } else {
            brandH = temperatureToHue(axes.temperature)
            brandS = min(0.85, max(0.35, 0.45 + (1 - axes.register) * 0.2 + axes.voice * 0.15))
            brandL = 0.42 - axes.register * 0.08
        }
        let brand = (brandColor.flatMap(WCAGContrast.hexToRGB) != nil) ? brandColor! : hslToHex(brandH, brandS, brandL)

        let accentOffset: Double = axes.voice > 0.5 ? 180 : 40
        let accentH = (brandH + accentOffset).truncatingRemainder(dividingBy: 360)
        let accentS = min(0.8, brandS + 0.05)
        let accentL = 0.45 + axes.voice * 0.1
        let accent = hslToHex(accentH, accentS, accentL)

        var bg: String, surface: String, text: String, muted: String, border: String
        if isDarkMode {
            bg = hslToHex(brandH, 0.15, 0.08 + axes.temperature * 0.04)
            surface = hslToHex(brandH, 0.12, 0.12 + axes.temperature * 0.04)
            text = hslToHex(brandH, 0.05, 0.92)
            muted = hslToHex(brandH, 0.08, 0.6)
            border = hslToHex(brandH, 0.1, 0.2)
        } else {
            let surfaceH = brandH
            let surfaceS = 0.05 + axes.temperature * 0.1
            bg = hslToHex(surfaceH, surfaceS, 0.99 - axes.temperature * 0.02)
            surface = hslToHex(surfaceH, surfaceS + 0.02, 0.96 - axes.temperature * 0.02)
            text = hslToHex(brandH, 0.1 + axes.temperature * 0.05, 0.1 + axes.weight * 0.03)
            muted = hslToHex(brandH, 0.05, 0.42 + axes.weight * 0.05)
            border = hslToHex(surfaceH, surfaceS + 0.03, 0.88 - axes.weight * 0.05)
        }

        text = WCAGContrast.suggestReadable(fg: text, bg: bg)
        muted = WCAGContrast.suggestReadable(fg: muted, bg: bg)

        return DesignPalette(brand: brand, accent: accent, bg: bg, surface: surface, text: text, muted: muted, border: border)
    }

    /// Cool (0) -> blue/teal (210), balanced (0.5) -> teal (160), warm (1) -> orange/terracotta (25).
    static func temperatureToHue(_ t: Double) -> Double {
        t <= 0.5 ? 210 - t * 100 : 160 - (t - 0.5) * 270
    }

    static func hslToHex(_ h: Double, _ s: Double, _ l: Double) -> String {
        let hue = ((h.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
        let a = s * min(l, 1 - l)
        func f(_ n: Double) -> String {
            let k = (n + hue / 30).truncatingRemainder(dividingBy: 12)
            let color = l - a * max(min(min(k - 3, 9 - k), 1), -1)
            let byte = Int((255 * max(0, min(1, color))).rounded())
            return String(format: "%02x", byte)
        }
        return "#\(f(0))\(f(8))\(f(4))"
    }

    static func hexToHSL(_ rgb: RGBColor) -> (h: Double, s: Double, l: Double) {
        let r = Double(rgb.r) / 255, g = Double(rgb.g) / 255, b = Double(rgb.b) / 255
        let maxC = max(r, g, b), minC = min(r, g, b)
        let l = (maxC + minC) / 2
        if maxC == minC { return (0, 0, l) }
        let d = maxC - minC
        let s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC)
        var h: Double
        if maxC == r { h = ((g - b) / d + (g < b ? 6 : 0)) * 60 }
        else if maxC == g { h = ((b - r) / d + 2) * 60 }
        else { h = ((r - g) / d + 4) * 60 }
        return (h, s, l)
    }
}
