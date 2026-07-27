import SwiftUI
import AnglesiteCore

/// Modal sheet shown when the pre-deploy scan refuses a deploy.
///
/// Per the CLAUDE.md durable rule "the app cannot bypass plugin security hooks", this sheet has
/// no override button — the only action is "Got it", which dismisses. The user is expected to
/// fix each failure in the source, then re-run the deploy.
struct BlockedDeploySheetView: View {
    let failures: [PreDeployCheck.ScanFailure]
    let warnings: [PreDeployCheck.ScanWarning]
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(failures.enumerated()), id: \.offset) { _, failure in
                        FailureCard(failure: failure)
                    }
                    if !warnings.isEmpty {
                        Divider().padding(.vertical, 4)
                        Text("Warnings")
                            .font(.subheadline).fontWeight(.semibold)
                            .foregroundStyle(.secondary)
                        ForEach(Array(warnings.enumerated()), id: \.offset) { _, warning in
                            WarningCard(warning: warning)
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack {
                Spacer()
                Button("Got it", action: onDismiss)
                    .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 560, height: 480)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.title)
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Deploy blocked").font(.title3).fontWeight(.semibold)
                Text("The pre-deploy scan found issues that need fixing before this site can ship.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }
}

private struct FailureCard: View {
    let failure: PreDeployCheck.ScanFailure

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: categoryIcon(failure.category))
                    .foregroundStyle(.red)
                    .accessibilityHidden(true)
                Text(categoryLabel(failure.category))
                    .font(.subheadline).fontWeight(.semibold)
                if let file = failure.file {
                    Text(file)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.middle)
                        // Path is middle-truncated for layout; read the whole thing aloud.
                        .accessibilityLabel("File")
                        .accessibilityValue(file)
                }
            }
            Text(failure.detail ?? failure.message).font(.callout)
            if let remediation = failure.remediation {
                Text(remediation)
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.red.opacity(0.25)))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func categoryIcon(_ category: PreDeployCheck.ScanFailure.Category) -> String {
        switch category {
        case .piiEmail, .piiPhone, .piiSSN: return "person.crop.circle.badge.exclamationmark"
        case .exposedToken: return "key.fill"
        case .thirdPartyScript: return "network"
        case .keystaticRoute: return "lock.shield"
        case .cspMisconfigured: return "shield.slash"
        case .wellKnownCollision: return "exclamationmark.lock"
        case .other: return "exclamationmark.triangle"
        }
    }

    private func categoryLabel(_ category: PreDeployCheck.ScanFailure.Category) -> String {
        switch category {
        case .piiEmail: return "PII — email address"
        case .piiPhone: return "PII — phone number"
        case .piiSSN: return "PII — SSN"
        case .exposedToken: return "Exposed token"
        case .thirdPartyScript: return "Third-party script"
        case .keystaticRoute: return "Keystatic admin route"
        case .cspMisconfigured: return "CSP misconfigured"
        case .wellKnownCollision: return "/.well-known/ collision"
        case .other: return "Other"
        }
    }
}

private struct WarningCard: View {
    let warning: PreDeployCheck.ScanWarning

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .accessibilityHidden(true)
                Text(categoryLabel(warning.category))
                    .font(.subheadline).fontWeight(.semibold)
            }
            Text(warning.detail ?? warning.message).font(.callout)
            if let remediation = warning.remediation {
                Text(remediation)
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.orange.opacity(0.25)))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func categoryLabel(_ category: PreDeployCheck.ScanWarning.Category) -> String {
        switch category {
        case .missingOgImage: return "Missing OG image"
        case .maintenanceOverdue: return "Maintenance overdue"
        case .seoCritical: return "SEO — critical"
        case .seoWarning: return "SEO — warning"
        case .orphanedRoute: return "Orphaned route"
        case .mixedContent: return "Mixed content"
        case .sriMissing: return "Missing subresource integrity"
        case .externalLinkRel: return "Missing rel=noopener"
        case .missingSecurityArtifact: return "Missing security artifact"
        case .securityTxtIssue: return "security.txt issue"
        case .mtaStsIssue: return "MTA-STS issue"
        case .thirdPartyScript: return "Third-party script"
        case .wellKnownArtifact: return "/.well-known/ file excluded"
        case .other: return "Other"
        }
    }
}
