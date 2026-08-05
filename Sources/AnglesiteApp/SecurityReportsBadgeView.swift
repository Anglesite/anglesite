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
                ForEach(model.openAdvisories.prefix(5)) { advisory in
                    Label(advisory.summary, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .lineLimit(1)
                }
                ForEach(model.openAlerts.prefix(5)) { alert in
                    Label("\(alert.packageName): dependency alert", systemImage: "shippingbox.fill")
                        .font(.callout)
                        .lineLimit(1)
                }
            }
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
}
