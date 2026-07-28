import SwiftUI
import AppKit
import AnglesiteCore

/// Modal sheet that renders an `AuditCommand` result. Groups findings by category,
/// shows severity icons per row, and surfaces the runners-skipped list so owners
/// see which checks couldn't run (e.g. Lighthouse not installed for `.performance`).
struct AuditSheetView: View {
    let model: AuditModel
    let siteName: String
    /// Called when the owner wants to re-run the audit. Wired in `SiteWindow` to
    /// the same `audit(siteID:, siteDirectory:)` call the toolbar button triggers.
    let onRunAgain: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            body_
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 540, idealWidth: 600, minHeight: 420, idealHeight: 560)
    }

    // MARK: Header

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
        case .running:
            ProgressView().controlSize(.small)
        case .succeeded(let report, _):
            let critical = report.findings.contains { $0.severity == .critical }
            let anyFindings = !report.findings.isEmpty
            Image(systemName: critical ? "exclamationmark.octagon.fill" :
                              anyFindings ? "exclamationmark.triangle.fill" :
                              "checkmark.seal.fill")
                .foregroundStyle(critical ? .red : (anyFindings ? .yellow : .green))
                .font(.title3)
        case .failed:
            Image(systemName: "xmark.octagon.fill")
                .foregroundStyle(.red).font(.title3)
        case .idle:
            Image(systemName: "magnifyingglass").font(.title3)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .running: return "Auditing \(siteName)…"
        case .succeeded(let report, _):
            if report.findings.isEmpty { return "No issues found in \(siteName)" }
            return "\(report.findings.count) finding\(report.findings.count == 1 ? "" : "s") in \(siteName)"
        case .failed: return "Audit couldn't finish"
        case .idle: return siteName
        }
    }

    private var headerSubtitle: String? {
        switch model.phase {
        case .succeeded(let report, let duration):
            var parts: [String] = []
            let categories = report.runnersExecuted.map(\.rawValue).joined(separator: ", ")
            if !categories.isEmpty { parts.append("ran: \(categories)") }
            if !report.runnersSkipped.isEmpty {
                let skipped = report.runnersSkipped.map(\.category.rawValue).joined(separator: ", ")
                parts.append("skipped: \(skipped)")
            }
            parts.append(String(format: "%.1f s", duration))
            return parts.joined(separator: " · ")
        case .failed(let reason, let exit, _):
            return Self.formatFailure(reason: reason, exitCode: exit)
        default:
            return nil
        }
    }

    /// Compose `reason` and `exitCode` for display. Kept as the single formatter so
    /// the header subtitle and the body render the same string — when the exit was
    /// also encoded into `reason`, both layers appended it and produced "(exit N) (exit N)".
    static func formatFailure(reason: String, exitCode: Int32?) -> String {
        exitCode.map { "\(reason) (exit \($0))" } ?? reason
    }

    // MARK: Body

    @ViewBuilder
    private var body_: some View {
        switch model.phase {
        case .succeeded(let report, _):
            findingsList(report)
        case .failed(let reason, let exit, let tail):
            VStack(alignment: .leading, spacing: 12) {
                Text(Self.formatFailure(reason: reason, exitCode: exit))
                    .font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                failureLog(tail)
            }
            .padding(16)
        case .idle, .running:
            VStack(spacing: 8) {
                ProgressView()
                Text("Auditing…").font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func findingsList(_ report: AuditReport) -> some View {
        if report.findings.isEmpty && report.runnersSkipped.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(.green).font(.largeTitle)
                Text("No issues found.").font(.headline)
                Text("Audited: \(report.runnersExecuted.map(\.rawValue).joined(separator: ", ")).")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    // Plain Text, not Section — Section has no effect inside a LazyVStack.
                    Text(report.summary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .accessibilityLabel("Audit summary: \(report.summary)")
                    ForEach(groupedFindings(report), id: \.0) { (category, items) in
                        categorySection(category: category, findings: items)
                    }
                    if !report.runnersSkipped.isEmpty {
                        skippedRunners(report.runnersSkipped)
                    }
                }
                .padding(16)
            }
        }
    }

    /// Group findings by category, in the canonical Category order (so the section
    /// list is stable across runs even if a runner produced no findings).
    private func groupedFindings(_ report: AuditReport) -> [(AuditReport.Finding.Category, [AuditReport.Finding])] {
        let byCategory = Dictionary(grouping: report.findings, by: \.category)
        return AuditReport.Finding.Category.allCases.compactMap { category in
            guard let items = byCategory[category], !items.isEmpty else { return nil }
            return (category, items.sorted(by: { $0.severity < $1.severity }))
        }
    }

    @ViewBuilder
    private func categorySection(category: AuditReport.Finding.Category, findings: [AuditReport.Finding]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(category.rawValue.capitalized).font(.subheadline.weight(.semibold))
                severityBadges(for: findings)
                Spacer()
            }
            ForEach(findings) { finding in
                findingRow(finding)
            }
        }
    }

    @ViewBuilder
    private func findingRow(_ finding: AuditReport.Finding) -> some View {
        HStack(alignment: .top, spacing: 8) {
            severityIcon(finding.severity)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(finding.title).font(.callout.weight(.medium))
                    if let location = finding.location {
                        Text(location).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }
                Text(finding.detail).font(.callout).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let remediation = finding.remediation {
                    Text(remediation).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func severityIcon(_ severity: AuditReport.Finding.Severity) -> some View {
        switch severity {
        case .critical:
            Image(systemName: "exclamationmark.octagon.fill").foregroundStyle(.red)
        case .warning:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
        case .info:
            Image(systemName: "info.circle.fill").foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func severityBadges(for findings: [AuditReport.Finding]) -> some View {
        let critical = findings.filter { $0.severity == .critical }.count
        let warning  = findings.filter { $0.severity == .warning  }.count
        let info     = findings.filter { $0.severity == .info     }.count
        HStack(spacing: 4) {
            if critical > 0 { countBadge(label: "\(critical) critical", color: .red) }
            if warning  > 0 { countBadge(label: "\(warning) warning",   color: .yellow) }
            if info     > 0 { countBadge(label: "\(info) info",         color: .secondary) }
        }
    }

    private func countBadge(label: String, color: Color) -> some View {
        Text(label)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18))
            .clipShape(Capsule())
    }

    @ViewBuilder
    private func skippedRunners(_ skipped: [AuditReport.SkippedRunner]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Skipped").font(.subheadline.weight(.semibold))
            ForEach(skipped, id: \.category) { entry in
                SettingsBox(verbatimTitle: entry.category.rawValue.capitalized) {
                    Text(entry.reason).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: Failure log

    /// Monospaced scroller of the captured `audit:<siteID>:build` output. Mirrors the deploy
    /// drawer's log presentation (stderr in red) so a failed audit shows the same diagnostic
    /// surface owners already know from deploys, without making them open the Debug pane.
    @ViewBuilder
    private func failureLog(_ tail: [LogCenter.LogLine]) -> some View {
        if tail.isEmpty {
            Text("The build produced no output.")
                .font(.caption).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer()
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(tail) { line in
                            Text(line.text)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(line.stream == .stderr ? Color.red : Color.primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                                .id(line.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .background(Color(NSColor.textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .onAppear {
                    if let last = tail.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            if !model.isRunning, case .succeeded = model.phase {
                Button("Run again") {
                    onRunAgain()
                }
            } else if !model.isRunning, case .failed(_, _, let tail) = model.phase {
                Button("Try again") {
                    onRunAgain()
                }
                if !tail.isEmpty {
                    Button("Copy log") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(model.logText, forType: .string)
                    }
                }
            }
            Spacer()
            Button("Close") {
                model.dismissSheet()
                dismiss()
            }
            .keyboardShortcut(.cancelAction)
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
