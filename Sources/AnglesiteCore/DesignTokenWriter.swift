import Foundation

/// Translates a design — a generated ``DesignConfig`` or a built-in ``Theme`` — into the two
/// artifacts the template actually consumes: the CSS custom-property values for
/// `src/styles/global.css`, and the owner-facing `DESIGN.md` rationale. Pure string mapping;
/// writing the files is the caller's job so this stays trivially testable.
public enum DesignTokenWriter {
    /// Maps a generated ``DesignConfig`` onto the 12 CSS custom-property names
    /// `Resources/Template/src/styles/global.css` already declares. Tokens the engine computes but
    /// the template has no slot for (border, shadows, the xs/sm/lg/xl spacing steps) are dropped —
    /// only `spacing.md` maps, to `--spacing-unit`.
    public static func templateCSSVars(for config: DesignConfig) -> [String: String] {
        [
            "color-primary": config.palette.brand,
            "color-accent": config.palette.accent,
            "color-background": config.palette.bg,
            "color-surface": config.palette.surface,
            "color-text": config.palette.text,
            "color-text-muted": config.palette.muted,
            "font-heading": config.typography.display,
            "font-body": config.typography.body,
            "spacing-unit": config.spacing.md,
            "radius-sm": config.shape.radiusSm,
            "radius-md": config.shape.radiusMd,
            "radius-lg": config.shape.radiusLg,
        ]
    }

    /// A built-in ``Theme``'s `cssVars` already use the template's naming scheme (decoded from
    /// `Resources/Template/scripts/themes.json`) — pass through unchanged.
    public static func templateCSSVars(for theme: Theme) -> [String: String] { theme.cssVars }

    /// Human-readable `DESIGN.md` rationale, ported from `generateDesignRationale` in
    /// `scripts/design.ts`.
    public static func rationaleMarkdown(for config: DesignConfig) -> String {
        let axes = config.axes
        func describe(_ axis: String, _ value: Double, low: String, high: String) -> String {
            if value <= 0.4 { return low }
            if value >= 0.6 { return high }
            return "between \(low) and \(high)"
        }
        let temperature = describe("temperature", axes.temperature, low: "cool", high: "warm")
        let weight = describe("weight", axes.weight, low: "airy", high: "dense")
        let register = describe("register", axes.register, low: "playful", high: "authoritative")
        let time = describe("time", axes.time, low: "classic", high: "contemporary")
        let voice = describe("voice", axes.voice, low: "subtle", high: "bold")
        let moodWords = [temperature, weight, register, time, voice]
            .reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }

        let foundation = axes.temperature > 0.5 ? "warm" : "cool"
        let pairing = config.typography.pairing
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "+", with: " + ")

        return """
        # Your Design System

        ## What we're going for

        The feel is **\(moodWords.joined(separator: ", "))** — designed for a \(config.siteType.replacingOccurrences(of: "-", with: " ")).

        ## Design axes

        These five axes position your design. Each is a value from 0 to 1.

        | Axis | Value | Reading |
        |------|-------|---------|
        | Temperature (cool ↔ warm) | \(axes.temperature) | \(temperature) |
        | Weight (airy ↔ dense) | \(axes.weight) | \(weight) |
        | Register (playful ↔ authoritative) | \(axes.register) | \(register) |
        | Time (classic ↔ contemporary) | \(axes.time) | \(time) |
        | Voice (subtle ↔ bold) | \(axes.voice) | \(voice) |

        ## Color

        Your brand color is `\(config.palette.brand)`. The accent color `\(config.palette.accent)` provides contrast for calls to action. The surface color `\(config.palette.surface)` and background `\(config.palette.bg)` set a \(foundation) foundation.

        Text color `\(config.palette.text)` on background `\(config.palette.bg)` meets WCAG AA contrast requirements for readability.

        ## Typography

        Display font: `\(config.typography.display.split(separator: ",").first.map(String.init)?.replacingOccurrences(of: "\"", with: "") ?? config.typography.display)` — \(axes.register > 0.5 ? "conveys authority and expertise" : "feels approachable and friendly").

        Body font: `\(config.typography.body.split(separator: ",").first.map(String.init)?.replacingOccurrences(of: "\"", with: "") ?? config.typography.body)` — optimized for comfortable reading at body text sizes.

        Pairing strategy: \(pairing).

        ## To adjust

        You can nudge these axes without re-running the full interview:

        - Want it warmer? Increase `temperature` above \(axes.temperature).
        - Want more authority? Increase `register` above \(axes.register).
        - Want more whitespace? Decrease `weight` below \(axes.weight).
        - Want it more modern? Increase `time` above \(axes.time).
        - Want it louder? Increase `voice` above \(axes.voice).

        Anglesite will regenerate these tokens the next time you apply a design.
        """
    }
}
