import SwiftUI
import AnglesiteCore

/// The #1171 drift audit + reconcile UI: shows declared `anglesite.json` vs live Cloudflare drift,
/// grouped by how each finding should be resolved (investigation doc §5.5's "app advises" rule —
/// auto-apply unambiguous app-owned drift, ask a consequences-phrased question for contested
/// state, surface untracked records for awareness only). Structurally mirrors `HardenSheetView`'s
/// header/content/footer shape and its plan-preview → apply → re-audit result view.
struct DomainConfigAuditSheetView: View {
    @Bindable var model: DomainConfigAuditModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 560, idealWidth: 640, minHeight: 400, idealHeight: 540)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            statusIcon
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle).font(.headline)
                if let subtitle = headerSubtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch model.phase {
        case .idle:
            Image(systemName: "arrow.triangle.2.circlepath").font(.title3)
        case .auditing, .reconciling:
            ProgressView().controlSize(.small)
        case .results(let findings, _, _, _):
            Image(systemName: findings.isEmpty ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath.circle.fill")
                .foregroundStyle(findings.isEmpty ? .green : .blue)
                .font(.title3)
        case .succeeded(let result):
            Image(systemName: result.failedItems.isEmpty ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(result.failedItems.isEmpty ? .green : .yellow)
                .font(.title3)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red).font(.title3)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .idle:
            return "Domain Config Audit"
        case .auditing(let domain):
            return "Comparing anglesite.json to \(domain)…"
        case .results(let findings, _, let domain, _):
            if findings.isEmpty { return "\(domain) matches anglesite.json" }
            return "\(findings.count) drift finding\(findings.count == 1 ? "" : "s") for \(domain)"
        case .reconciling(let domain):
            return "Reconciling \(domain)…"
        case .succeeded(let result):
            if result.failedItems.isEmpty {
                return "\(result.appliedCount) change\(result.appliedCount == 1 ? "" : "s") applied"
            }
            return "\(result.appliedCount) applied, \(result.failedItems.count) failed"
        case .failed:
            return "Domain config audit failed"
        }
    }

    private var headerSubtitle: String? {
        switch model.phase {
        case .results:
            return "Review the drift below. Auto-fixable changes can be applied with one click."
        case .succeeded(let result):
            if let err = result.auditError {
                return "Post-apply audit failed: \(err)"
            }
            let findings = result.postAuditFindings.count
            if findings == 0 { return "Post-apply audit: no remaining drift." }
            return "Post-apply audit: \(findings) remaining finding\(findings == 1 ? "" : "s")."
        default:
            return nil
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            idleView
        case .auditing:
            VStack(spacing: 8) {
                ProgressView()
                Text("Reading anglesite.json and the live Cloudflare zone…")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .results(let findings, let plan, _, _):
            resultsView(findings: findings, plan: plan)
        case .reconciling:
            VStack(spacing: 8) {
                ProgressView()
                Text("Applying reconciliation changes…")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .succeeded(let result):
            succeededView(result)
        case .failed(let reason):
            VStack(spacing: 12) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red).font(.largeTitle)
                Text(reason)
                    .font(.callout).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 440)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var idleView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("Check for domain config drift")
                .font(.headline)
            Text("Compares this site's declared anglesite.json (domain, managed DNS records, edge hardening) against what's actually live on Cloudflare.")
                .font(.callout).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            Spacer()
        }
        .padding(16)
    }

    @ViewBuilder
    private func resultsView(findings: [DomainConfigAudit.Finding], plan: DomainConfigReconcilePlan) -> some View {
        if findings.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green).font(.largeTitle)
                Text("No drift found.").font(.headline)
                Text("The live Cloudflare zone matches everything declared in anglesite.json.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    let autoApply = findings.filter { if case .autoApply = $0.remediation { return true }; return false }
                    let ownerQuestions = findings.filter { if case .ownerQuestion = $0.remediation { return true }; return false }
                    let informational = findings.filter { if case .informational = $0.remediation { return true }; return false }

                    if !autoApply.isEmpty {
                        findingSection(title: "Can be fixed automatically", findings: autoApply, tint: .blue)
                    }
                    if !ownerQuestions.isEmpty {
                        findingSection(title: "Needs your decision", findings: ownerQuestions, tint: .orange)
                    }
                    if !informational.isEmpty {
                        findingSection(title: "For your awareness", findings: informational, tint: .secondary)
                    }
                }
                .padding(16)
            }
        }
    }

    private func findingSection(title: String, findings: [DomainConfigAudit.Finding], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            ForEach(findings) { finding in
                findingRow(finding, tint: tint)
            }
        }
    }

    private func findingRow(_ finding: DomainConfigAudit.Finding, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(finding.title).font(.callout.weight(.medium))
            Text(finding.detail).font(.callout).foregroundStyle(.secondary)
            if case .ownerQuestion(let question) = finding.remediation {
                Text(question).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(tint.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func succeededView(_ result: DomainConfigAuditModel.ReconcileResult) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if result.appliedCount > 0 {
                    Label("\(result.appliedCount) change\(result.appliedCount == 1 ? "" : "s") applied successfully.", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.callout)
                }

                if !result.failedItems.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Failed").font(.subheadline.weight(.semibold))
                        ForEach(Array(result.failedItems.enumerated()), id: \.offset) { _, item in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.description).font(.callout.weight(.medium))
                                Text(item.error).font(.caption).foregroundStyle(.red)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(Color.red.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                }

                if !result.postAuditFindings.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Remaining drift").font(.subheadline.weight(.semibold))
                        ForEach(result.postAuditFindings) { finding in
                            findingRow(finding, tint: .secondary)
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            switch model.phase {
            case .idle:
                Button("Check Domain Config") { model.runAudit() }
                    .buttonStyle(.borderedProminent)
            case .results(_, let plan, _, _) where !plan.isEmpty:
                Button("Apply \(plan.items.count) change\(plan.items.count == 1 ? "" : "s")") {
                    model.reconcile()
                }
                .buttonStyle(.borderedProminent)
            case .failed:
                Button("Try again") {
                    model.retryFromFailed()
                }
            default:
                EmptyView()
            }
            Spacer()
            Button("Close") {
                model.dismissSheet()
            }
            .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
