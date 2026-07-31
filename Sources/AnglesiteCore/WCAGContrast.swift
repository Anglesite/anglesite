import Foundation

/// WCAG 2.2 contrast-ratio utilities, ported 1:1 from the plugin's `scripts/contrast.ts`.
/// Pure, no I/O.
public struct RGBColor: Sendable, Equatable {
    /// Red channel, 0–255.
    public let r: Int
    /// Green channel, 0–255.
    public let g: Int
    /// Blue channel, 0–255.
    public let b: Int
    /// Creates a color from 0–255 channel values. Not range-checked here — clamping happens at
    /// the serialization edge (`suggestReadable`'s hex output) instead.
    public init(r: Int, g: Int, b: Int) { self.r = r; self.g = g; self.b = b }
}

/// Namespace for the WCAG 2.2 contrast math — kept a caseless enum so the port from the plugin's
/// `scripts/contrast.ts` stays a set of pure static functions with no state to drift.
public enum WCAGContrast {
    /// Parses a hex color (`#rgb` or `#rrggbb`, leading `#` optional). Returns `nil` for invalid input.
    public static func hexToRGB(_ hex: String) -> RGBColor? {
        var h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if h.count == 3, h.allSatisfy({ $0.isHexDigit }) {
            h = h.map { "\($0)\($0)" }.joined()
        }
        guard h.count == 6, h.allSatisfy({ $0.isHexDigit }) else { return nil }
        let scanner = Scanner(string: h)
        var value: UInt64 = 0
        guard scanner.scanHexInt64(&value) else { return nil }
        return RGBColor(r: Int((value >> 16) & 0xFF), g: Int((value >> 8) & 0xFF), b: Int(value & 0xFF))
    }

    /// Relative luminance per WCAG 2.2 §1.4.3.
    public static func relativeLuminance(_ rgb: RGBColor) -> Double {
        func channel(_ c: Int) -> Double {
            let s = Double(c) / 255
            return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
    }

    /// Contrast ratio between two hex colors. `NaN` if either fails to parse.
    public static func contrastRatio(_ hex1: String, _ hex2: String) -> Double {
        guard let rgb1 = hexToRGB(hex1), let rgb2 = hexToRGB(hex2) else { return .nan }
        let l1 = relativeLuminance(rgb1)
        let l2 = relativeLuminance(rgb2)
        let lighter = max(l1, l2)
        let darker = min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)
    }

    /// Whether the pair meets WCAG AA for normal-size text (ratio ≥ 4.5:1). A parse failure yields
    /// `NaN`, and `NaN >= 4.5` is `false` — unparseable colors fail closed.
    public static func meetsAA(fg: String, bg: String) -> Bool { contrastRatio(fg, bg) >= 4.5 }
    /// Whether the pair meets WCAG AA for large text (ratio ≥ 3:1); fails closed on parse errors
    /// like ``meetsAA(fg:bg:)``.
    public static func meetsAALarge(fg: String, bg: String) -> Bool { contrastRatio(fg, bg) >= 3 }

    private static func toHex(_ rgb: RGBColor) -> String {
        func clamp(_ n: Int) -> String { String(format: "%02x", max(0, min(255, n))) }
        return "#\(clamp(rgb.r))\(clamp(rgb.g))\(clamp(rgb.b))"
    }

    /// Darkens or lightens `fg` in 1-unit RGB steps until it meets AA against `bg`. Returns the
    /// original hex, lowercased, if it already passes or if either color fails to parse.
    public static func suggestReadable(fg: String, bg: String) -> String {
        if meetsAA(fg: fg, bg: bg) { return fg }
        guard let fgRGB = hexToRGB(fg), let bgRGB = hexToRGB(bg) else { return fg }
        let shouldDarken = relativeLuminance(bgRGB) > 0.5
        var best = fgRGB
        for step in 1...255 {
            let delta = shouldDarken ? -step : step
            let candidate = RGBColor(
                r: max(0, min(255, fgRGB.r + delta)),
                g: max(0, min(255, fgRGB.g + delta)),
                b: max(0, min(255, fgRGB.b + delta))
            )
            if meetsAA(fg: toHex(candidate), bg: toHex(bgRGB)) {
                best = candidate
                break
            }
        }
        return toHex(best)
    }
}
