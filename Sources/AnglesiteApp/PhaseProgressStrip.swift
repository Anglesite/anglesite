import SwiftUI
import AppKit

/// Three-panel cumulative-fill progress indicator inspired by AOL's classic sign-on animation
/// (see docs/superpowers/specs/2026-07-28-phase-progress-panels-design.md): three fixed cells
/// that light up left-to-right as named phases complete and *stay* lit — never a single badge
/// that swaps in place. The third cell shows the app's own icon behind a "group" glyph, echoing
/// the reference animation's people-gathered-at-the-logo composition.
struct PhaseProgressStrip: View {
    /// 0...3. Cells at index `< filledCount` render filled/tinted; the rest render dimmed.
    let filledCount: Int
    var size: Size = .full

    enum Size {
        case full, compact

        var cellDimension: CGFloat {
            switch self {
            case .full: return 56
            case .compact: return 18
            }
        }

        var glyphFontSize: CGFloat {
            switch self {
            case .full: return 28
            case .compact: return 10
            }
        }

        var cornerRadius: CGFloat {
            switch self {
            case .full: return 10
            case .compact: return 4
            }
        }

        var spacing: CGFloat {
            switch self {
            case .full: return 8
            case .compact: return 3
            }
        }
    }

    var body: some View {
        HStack(spacing: size.spacing) {
            cell(glyph: "🚶", filled: filledCount >= 1)
            cell(glyph: "🏃", filled: filledCount >= 2)
            groupCell(filled: filledCount >= 3)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Progress: \(filledCount) of 3 steps complete")
    }

    private func cell(glyph: String, filled: Bool) -> some View {
        Text(glyph)
            .font(.system(size: size.glyphFontSize))
            .opacity(filled ? 1 : 0.35)
            .frame(width: size.cellDimension, height: size.cellDimension)
            .background(cellBackground(filled: filled))
            .overlay(cellBorder(filled: filled))
            .animation(.easeInOut(duration: 0.2), value: filled)
    }

    private func groupCell(filled: Bool) -> some View {
        ZStack {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size.cellDimension * 0.7, height: size.cellDimension * 0.7)
                .opacity(filled ? 1 : 0.35)
            Text("👥")
                .font(.system(size: size.glyphFontSize))
                .opacity(filled ? 1 : 0.35)
        }
        .frame(width: size.cellDimension, height: size.cellDimension)
        .background(cellBackground(filled: filled))
        .overlay(cellBorder(filled: filled))
        .animation(.easeInOut(duration: 0.2), value: filled)
    }

    private func cellBackground(filled: Bool) -> some View {
        RoundedRectangle(cornerRadius: size.cornerRadius)
            .fill(filled ? Color.accentColor.opacity(0.18) : Color(nsColor: .quaternaryLabelColor).opacity(0.12))
    }

    private func cellBorder(filled: Bool) -> some View {
        RoundedRectangle(cornerRadius: size.cornerRadius)
            .strokeBorder(filled ? Color.accentColor.opacity(0.5) : Color.secondary.opacity(0.25))
    }
}
