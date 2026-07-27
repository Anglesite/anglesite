import SwiftUI
import AnglesiteCore

/// iCloud sync status badge (#881), rendered as a palette `ToolbarItem` (`SiteToolbarItemID.sync`)
/// — mirrors `HealthBadgeView`'s small dot-indicator + popover shape. Hidden entirely (an
/// `EmptyView`) for a package that doesn't live in iCloud Drive, so a local-only site's toolbar
/// never implies a feature that isn't active for it.
struct SyncStatusView: View {
    @Bindable var model: SyncModel

    @State private var popoverPresented = false
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    @ScaledMetric(relativeTo: .body) private var badgeDimension = 18
    @ScaledMetric(relativeTo: .body) private var glyphSize = 11

    var body: some View {
        if model.isEligible {
            Button {
                if model.bannerPresented {
                    model.openResolutionSheet()
                } else {
                    popoverPresented.toggle()
                }
            } label: {
                indicator
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            .help(model.statusLabel)
            .accessibilityLabel("iCloud sync status")
            .accessibilityValue(model.statusLabel)
            .accessibilityHint(model.bannerPresented
                ? "Opens the sync conflict resolution sheet"
                : "Shows this site's iCloud sync status")
            .popover(isPresented: $popoverPresented, arrowEdge: .top) {
                popoverContent
                    .padding(14)
                    .frame(width: 280)
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
            if isSyncing {
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.5), lineWidth: 1)
                    .frame(width: 14, height: 14)
            }
        }
        .frame(width: badgeDimension, height: badgeDimension, alignment: .center)
        .contentShape(Rectangle())
    }

    private var isSyncing: Bool {
        if case .syncing = model.status { return true }
        return false
    }

    private var stateSymbol: String {
        switch model.status {
        case .idle: return "icloud"
        case .syncing: return "arrow.triangle.2.circlepath.icloud"
        case .synced: return "checkmark.icloud"
        case .waitingForICloud: return "icloud.and.arrow.down"
        case .needsAttention: return "exclamationmark.icloud"
        case .failed: return "xmark.icloud"
        }
    }

    private var color: Color {
        switch model.status {
        case .idle, .syncing: return .secondary.opacity(0.6)
        case .synced: return .green
        case .waitingForICloud: return .yellow
        case .needsAttention: return .orange
        case .failed: return .red
        }
    }

    @ViewBuilder
    private var popoverContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "icloud").foregroundStyle(.secondary)
                Text("iCloud Sync").font(.headline)
            }
            Text(model.statusLabel).font(.callout).foregroundStyle(.secondary)
            if model.bannerPresented {
                Button("Resolve…") {
                    popoverPresented = false
                    model.openResolutionSheet()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
    }
}
