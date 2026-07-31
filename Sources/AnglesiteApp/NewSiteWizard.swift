import SwiftUI
import AppKit
import AnglesiteCore

/// The New Site template chooser (#1071) — the iWork model: one question (which template),
/// then the site scaffolds as "Untitled" into the default location and opens in the preview.
/// Presented from SitesLauncherView; calls `onComplete(siteID)` when the site is scaffolded
/// and registered.
struct NewSiteWizard: View {
    @Bindable var model: NewSiteWizardModel
    let scaffolder: SiteScaffolder
    let onComplete: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            content
            Divider()
            footer
        }
        .frame(width: 560, height: 460)
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .chooser:  chooserStep
        case .building: buildingStep
        }
    }

    private var chooserStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose a Template").font(.title2.bold())
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))], spacing: 12) {
                    ForEach(model.catalog.themes) { theme in
                        Button { model.draft.themeID = theme.id } label: {
                            ThemePreviewCard(theme: theme, isSelected: model.draft.themeID == theme.id)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        // Double-click = choose and create, the document-chooser convention.
                        .simultaneousGesture(TapGesture(count: 2).onEnded {
                            model.draft.themeID = theme.id
                            create()
                        })
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(theme.name). \(theme.blurb)")
                        .accessibilityValue(model.draft.themeID == theme.id ? "Selected" : "")
                    }
                }
            }
        }.padding(24)
    }

    private var buildingStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Building your website\u{2026}").font(.title2.bold())
            ForEach(Array(model.progress.enumerated()), id: \.offset) { _, s in
                Text(label(for: s)).font(.callout)
                    // The visible label leads with an emoji status glyph; give VoiceOver clean text.
                    .accessibilityLabel(accessibilityLabel(for: s))
            }
            if case .failed(_, let msg) = model.fatal {
                Text(msg).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                    .accessibilityLabel("Build failed")
                    .accessibilityValue(msg)
            }
            if model.completedSiteID != nil && model.hasWarnings {
                Text("Your website was created, but something above needs attention before it can preview. You can open it anyway and fix it from the website window.")
                    .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    .accessibilityLabel("Your website was created with warnings. You can open it anyway and fix it from the website window.")
            }
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func label(for step: SiteScaffolder.ScaffoldStep) -> String {
        switch step {
        case .creatingFolder: return "\u{2705} Created the website file"
        case .copyingTemplate: return "\u{2705} Copied the template"
        case .applyingTheme: return "\u{2705} Applied your theme"
        case .writingContent: return "\u{2705} Prepared the starter content"
        case .installing: return "\u{23F3} Installing\u{2026}"
        case .registering: return "\u{2705} Registering"
        case .warning(_, let m): return "\u{26A0}\u{FE0F} \(m)"
        case .failed(_, let m): return "\u{274C} \(m)"
        case .done: return "\u{2705} Done"
        }
    }

    /// Emoji-free version of `label(for:)` for VoiceOver, which would otherwise read the status
    /// glyph as "check mark", "hourglass", etc. before the actual message.
    private func accessibilityLabel(for step: SiteScaffolder.ScaffoldStep) -> String {
        switch step {
        case .creatingFolder:    return "Created the website file"
        case .copyingTemplate:   return "Copied the template"
        case .applyingTheme:     return "Applied your theme"
        case .writingContent:    return "Prepared the starter content"
        case .installing:        return "Installing…"
        case .registering:       return "Registering"
        case .warning(_, let m): return "Warning: \(m)"
        case .failed(_, let m):  return "Failed: \(m)"
        case .done:              return "Done"
        }
    }

    @ViewBuilder private var footer: some View {
        HStack {
            Spacer()
            // No Cancel once building starts: the scaffold pipeline isn't cancellable and
            // always reaches .done or .failed (failure shows Close below), so cancelling
            // mid-build would leak the in-flight work and the MAS security scope.
            if model.step == .chooser {
                Button("Cancel") { onCancel() }
                Button("Create") { create() }
                    .keyboardShortcut(.defaultAction).disabled(!model.canCreate)
            } else if let id = model.completedSiteID, model.hasWarnings {
                Button("Open Website Anyway") { onComplete(id) }.keyboardShortcut(.defaultAction)
            } else if model.completedSiteID == nil && model.fatal != nil {
                Button("Close") { onCancel() }
            }
        }.padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func create() {
        guard model.canCreate else { return }
        // Auto-open only on a clean build; with warnings, stay put so the owner sees them (#229).
        Task {
            _ = await model.build(using: scaffolder)
            if model.didCompleteCleanly, let id = model.completedSiteID { onComplete(id) }
        }
    }
}

/// One template card: a miniature page mock (nav bar, hero block, text lines) drawn from the
/// theme's own palette, so each card previews a page rather than a bare swatch strip (#1071).
private struct ThemePreviewCard: View {
    let theme: Theme
    let isSelected: Bool

    private var primary: Color { Color(hex: theme.cssVars["color-primary"] ?? "#333333") }
    private var accent: Color { Color(hex: theme.cssVars["color-accent"] ?? "#888888") }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Circle().fill(accent).frame(width: 6, height: 6)
                    Capsule().fill(Color.white.opacity(0.9)).frame(width: 34, height: 4)
                    Spacer()
                }
                .padding(6)
                .background(primary)
                RoundedRectangle(cornerRadius: 2).fill(accent.opacity(0.85)).frame(height: 22)
                    .padding(.horizontal, 6)
                Capsule().fill(Color.primary.opacity(0.5)).frame(width: 70, height: 4)
                    .padding(.horizontal, 6)
                Capsule().fill(Color.primary.opacity(0.25)).frame(height: 3)
                    .padding(.horizontal, 6)
                Capsule().fill(Color.primary.opacity(0.25)).frame(width: 90, height: 3)
                    .padding(.horizontal, 6).padding(.bottom, 8)
            }
            .background(Color(NSColor.textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.1)))
            .accessibilityHidden(true)
            Text(theme.name).font(.subheadline.bold())
            Text(theme.blurb).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }
        .padding(8)
        .overlay(RoundedRectangle(cornerRadius: 8)
            .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2))
    }
}

/// Minimal hex -> Color for theme cards (#rrggbb). Also used by ThemeApplyWizard — keep it
/// here (module-internal) when refactoring this file.
extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self = Color(.sRGB,
                     red: Double((rgb >> 16) & 0xFF) / 255,
                     green: Double((rgb >> 8) & 0xFF) / 255,
                     blue: Double(rgb & 0xFF) / 255)
    }
}
