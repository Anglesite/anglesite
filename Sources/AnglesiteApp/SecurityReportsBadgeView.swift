import SwiftUI
import AnglesiteCore

/// Open-GitHub-security-reports badge (#975), rendered as a `ToolbarItem`
/// (`SiteToolbarItemID.securityReports`) in `SiteWindow`'s toolbar. Mirrors
/// `SyncStatusView`'s shape: an `EmptyView` when there's nothing to show, so a site with no
/// open advisories or alerts never widens the toolbar — the `ToolbarItem` itself stays
/// unconditional (frozen id, no `if let`), only this inner view's body branches.
struct SecurityReportsBadgeView: View {
    @Bindable var model: SecurityReportsModel
    let onRecheck: () -> Void
    /// Opens Website Settings ▸ Security Reports (design doc §4: "its popover is a summary, not
    /// the full view") — the popover's "View all in Security Reports" button.
    let onViewAll: () -> Void

    @State private var popoverPresented = false
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    @ScaledMetric(relativeTo: .body) private var badgeDimension = 18
    @ScaledMetric(relativeTo: .body) private var glyphSize = 11

    var body: some View {
        if model.totalCount > 0 || model.isRunning {
            Button {
                popoverPresented.toggle()
            } label: {
                indicator
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            .help(helpText)
            .accessibilityLabel("Security reports")
            .accessibilityValue(helpText)
            .accessibilityHint("Shows this site's open GitHub security advisories and Dependabot alerts")
            .popover(isPresented: $popoverPresented, arrowEdge: .top) {
                popoverContent
                    .padding(14)
                    .frame(width: 320)
            }
        }
    }

    @ViewBuilder
    private var indicator: some View {
        ZStack {
            if differentiateWithoutColor {
                Image(systemName: stateSymbol)
                    .font(.system(size: glyphSize, weight: .bold))
                    .foregroundStyle(color)
            } else {
                Circle()
                    .fill(color)
                    .frame(width: 10, height: 10)
            }
            if model.isRunning {
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.5), lineWidth: 1)
                    .frame(width: 14, height: 14)
            }
        }
        .frame(width: badgeDimension, height: badgeDimension, alignment: .center)
        .contentShape(Rectangle())
    }

    private var stateSymbol: String {
        switch model.badgeState {
        case .clean: return "checkmark.shield"
        case .warnings: return "exclamationmark.shield"
        case .failures: return "xmark.shield"
        }
    }

    private var color: Color {
        switch model.badgeState {
        case .clean: return .green
        case .warnings: return .yellow
        case .failures: return .red
        }
    }

    private var helpText: String {
        "\(model.totalCount) open security \(model.totalCount == 1 ? "report" : "reports")"
    }

    @ViewBuilder
    private var popoverContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "shield.lefthalf.filled").foregroundStyle(.secondary)
                Text("Security Reports").font(.headline)
                Spacer()
            }
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                // The leading glyph distinguishes *kind* (advisory vs. dependency alert); severity
                // is carried by the word next to it, never by its tint alone — so this doesn't need
                // `differentiateWithoutColor` gating the way the badge indicator above does.
                ForEach(model.openAdvisories.prefix(5)) { advisory in
                    reportRow(severity: advisory.severity, symbol: "exclamationmark.triangle.fill",
                              text: advisory.summary)
                }
                ForEach(model.openAlerts.prefix(5)) { alert in
                    reportRow(severity: alert.severity, symbol: "shippingbox.fill",
                              text: String(localized: "\(alert.packageName): dependency alert"))
                }
            }
            Divider()
            // Full-width, its own row: the popover is only 320pt wide, and this label is long
            // enough that sharing a row with "Recheck" (as `HealthBadgeView`'s "Ask
            // Assistant"/"Recheck" footer does) would crowd both. The trailing chevron marks it
            // as a disclosure into another surface, matching the design doc's "the popover is a
            // summary, not the full view" — Website Settings ▸ Security Reports is where the
            // per-item actions actually live.
            Button {
                popoverPresented = false
                onViewAll()
            } label: {
                HStack {
                    Text("View all in Security Reports")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            Divider()
            HStack {
                Spacer()
                Button {
                    popoverPresented = false
                    onRecheck()
                } label: {
                    if model.isRunning {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text("Checking…")
                        }
                    } else {
                        Text("Recheck")
                    }
                }
                .controlSize(.small)
                .disabled(model.isRunning)
            }
        }
    }

    /// One popover row: kind glyph, severity in words, then the report's own text. The row is a
    /// single accessibility element whose label leads with the severity, so VoiceOver announces
    /// it rather than leaving it to the glyph's tint.
    private func reportRow(severity: SecurityAdvisory.Severity, symbol: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .foregroundStyle(severity.reportColor)
            Text(severity.reportLabel)
                .font(.caption.weight(.semibold))
                .foregroundStyle(severity.reportColor)
            Text(text)
                .font(.callout)
        }
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(severity.spokenLabel(for: text))
    }
}

/// Non-color severity presentation for an open security report (#975), shared by the toolbar
/// badge's popover rows and Website Settings ▸ Security Reports' own rows. Severity is never
/// carried by tint alone: every row states the tier in words and repeats it in the row's
/// accessibility label, so both VoiceOver and Differentiate Without Color get it.
extension SecurityAdvisory.Severity {
    var reportLabel: String {
        switch self {
        case .critical: return String(localized: "Critical")
        case .high: return String(localized: "High")
        case .moderate: return String(localized: "Moderate")
        case .low: return String(localized: "Low")
        case .unknown: return String(localized: "Unrated")
        }
    }

    var reportColor: Color {
        switch self {
        case .critical, .high: return .red
        case .moderate: return .orange
        case .low, .unknown: return .yellow
        }
    }

    /// `"Critical: Prototype pollution in left-pad"` — the row's spoken form.
    func spokenLabel(for text: String) -> String {
        "\(reportLabel): \(text)"
    }
}
