// SwiftUI is Darwin-only; this bridge exists purely for the (Darwin-only) Styles panel's
// ColorPicker, so it compiles out cleanly on the portable core (cross-platform port design §5).
#if canImport(SwiftUI)
import SwiftUI

/// Best-effort CSS <color> <-> SwiftUI Color bridge for the Styles panel's ColorPicker.
/// Only handles #rgb/#rrggbb/#rrggbbaa hex forms — named colors and rgb()/hsl() fall back
/// to the free-text field, which always remains available.
public enum CSSColor {
    /// Parses a hex CSS color (`#rgb`, `#rrggbb`, or `#rrggbbaa`) into a `Color`. Returns `nil`
    /// for every other form — deliberately, so the caller falls back to the free-text field
    /// instead of this bridge guessing at named colors or `rgb()`/`hsl()` syntax.
    public static func parse(_ value: String) -> Color? {
        var hex = value.trimmingCharacters(in: .whitespaces)
        guard hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        guard hex.count == 3 || hex.count == 6 || hex.count == 8 else { return nil }
        if hex.count == 3 {
            hex = hex.map { "\($0)\($0)" }.joined()
        }
        guard let value = UInt64(hex, radix: 16) else { return nil }
        let hasAlpha = hex.count == 8
        let r = Double((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
        let g = Double((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let b = Double((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
        let a = hasAlpha ? Double(value & 0xFF) / 255 : 1
        return Color(red: r, green: g, blue: b, opacity: a)
    }

    /// Formats a picker `Color` back to lowercase hex, emitting the 8-digit `#rrggbbaa` form
    /// only when alpha is actually below 1 — round-tripping an opaque color must not grow an
    /// alpha suffix the stylesheet never had. Falls back to `#000000` when the `Color` has no
    /// resolvable `cgColor` (a dynamic/asset color), rather than throwing mid-edit.
    public static func format(_ color: Color) -> String {
        guard let cgColor = color.cgColor, let components = cgColor.components, components.count >= 3 else {
            return "#000000"
        }
        let r = Int((components[0] * 255).rounded())
        let g = Int((components[1] * 255).rounded())
        let b = Int((components[2] * 255).rounded())
        // `components` is [r, g, b, alpha] for RGB-family color spaces; `cgColor.alpha` is the
        // authoritative alpha regardless of component layout, so use it rather than indexing
        // components[3] (which would be wrong for e.g. a grayscale-backed CGColor).
        let alpha = cgColor.alpha
        guard alpha < 1 else { return String(format: "#%02x%02x%02x", r, g, b) }
        let a = Int((alpha * 255).rounded())
        return String(format: "#%02x%02x%02x%02x", r, g, b, a)
    }

    /// CSS property names whose values get the ColorPicker affordance in the Styles panel. A
    /// fixed allowlist (rather than sniffing the value) so shorthand and non-color properties
    /// that merely *contain* a color keep the plain text field, where edits stay lossless.
    public static let colorProperties: Set<String> = [
        "color", "background-color", "border-color", "outline-color", "fill", "stroke",
        "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    ]
}
#endif
