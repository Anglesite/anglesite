/**
 * Cowork-inspired design tokens for the annotation picker.
 *
 * Warm neutrals keep the picker receding — the user's website stays the hero.
 * A single soft amber accent marks the active highlight and selected state.
 */

export const pickerTheme = Object.freeze({
  // Surfaces — warm cream/beige
  surface: "#faf7f2",
  surfaceMuted: "rgba(250, 247, 242, 0.92)",
  border: "#e0d9cf",

  // Text — warm dark tones
  text: "#3d3529",
  textMuted: "#8a7f72",
  textFaint: "#b5ad9f",

  // Accent — soft warm amber (single accent per issue spec)
  accent: "#c87533",
  accentMuted: "rgba(200, 117, 51, 0.15)",

  // Picker highlight overlay
  highlightBorder: "rgba(200, 117, 51, 0.6)",
  highlightBackground: "rgba(200, 117, 51, 0.08)",

  // Resolve / success
  success: "#5a8a5e",
  successMuted: "rgba(90, 138, 94, 0.12)",

  // Design tokens
  radius: "10px",
  radiusSmall: "6px",
  shadow: "0 4px 16px rgba(61, 53, 41, 0.12)",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
});
