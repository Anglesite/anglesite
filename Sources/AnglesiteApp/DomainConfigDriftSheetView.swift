import SwiftUI
import AnglesiteCore

/// Sheet shown when the deploy pipeline's declared-vs-live check (#1173) finds drift between
/// `Source/anglesite.json` and the site's live Cloudflare state. Informs, doesn't remediate
/// in-app — the "Review in Domain Config Audit" button hands off to the #1171 audit sheet, where
/// findings are actually reconciled. Dismiss-only otherwise, like `DomainConflictSheetView`;
/// there's no rename-and-retry action here, so no `pendingDeploy` park.
struct DomainConfigDriftSheetView: View {
    let findings: [DomainConfigAudit.Finding]
    let onReview: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(findings) { finding in
                        FindingCard(finding: finding)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack {
                Button("Dismiss", action: onDismiss)
                Spacer()
                Button("Review in Domain Config Audit", action: onReview)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
            .padding(16)
        }
        .frame(width: 560, height: 420)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.title)
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Deploy blocked — domain config drift").font(.title3).fontWeight(.semibold)
                Text("Your declared domain configuration (anglesite.json) doesn't match what's live on Cloudflare. Review and reconcile before deploying again.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }
}

private struct FindingCard: View {
    let finding: DomainConfigAudit.Finding

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: categoryIcon)
                    .foregroundStyle(.orange)
                    .accessibilityHidden(true)
                Text(finding.title)
                    .font(.subheadline).fontWeight(.semibold)
            }
            Text(finding.detail).font(.callout)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.orange.opacity(0.25)))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var categoryIcon: String {
        switch finding.category {
        case .dns: return "network"
        case .edge: return "shield.lefthalf.filled"
        }
    }
}

#Preview {
    DomainConfigDriftSheetView(
        findings: [
            DomainConfigAudit.Finding(
                category: .dns, title: "Missing managed DNS record",
                detail: "MX record @ is declared but not live.",
                remediation: .autoApply(.createManagedRecord(
                    DomainConfig.DNSRecord(type: "MX", name: "@", content: "mx.example.com")))
            )
        ],
        onReview: {}, onDismiss: {}
    )
}
