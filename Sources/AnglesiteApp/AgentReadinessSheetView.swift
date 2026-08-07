import SwiftUI
import AnglesiteCore

struct AgentReadinessSheetView: View {
    @Bindable var model: AgentReadinessModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 540, idealWidth: 620, minHeight: 380, idealHeight: 520)
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
            Image(systemName: "sparkle.magnifyingglass").font(.title3)
        case .scanning:
            ProgressView().controlSize(.small)
        case .succeeded(let report, _):
            Image(systemName: report.passedCount == report.totalCount ? "checkmark.seal.fill" : "exclamationmark.seal.fill")
                .foregroundStyle(report.passedCount == report.totalCount ? .green : .yellow)
                .font(.title3)
        case .failed:
            Image(systemName: "xmark.seal.fill")
                .foregroundStyle(.red).font(.title3)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .idle:
            return "Agent Readiness"
        case .scanning(let url):
            return "Checking \(url.host ?? url.absoluteString)…"
        case .succeeded(let report, _):
            return "\(report.levelName) (\(report.passedCount)/\(report.totalCount) checks passing)"
        case .failed:
            return "Couldn't check Agent Readiness"
        }
    }

    private var headerSubtitle: String? {
        switch model.phase {
        case .idle:
            return "See how easily AI agents and assistants can find and use this site."
        case .scanning:
            return "Cloudflare is scanning the deployed site — this can take up to a minute."
        case .succeeded(let report, let url):
            var subtitle = "Scanned \(url.absoluteString)."
            if let nextLevel = report.nextLevel {
                subtitle += " Next tier: \(nextLevel.name)."
            }
            return subtitle
        case .failed:
            return nil
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            idlePrompt
        case .scanning:
            VStack(spacing: 8) {
                ProgressView()
                Text("Scanning the deployed site for AI agent readiness…")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .succeeded(let report, _):
            reportView(report)
        case .failed(let reason):
            VStack(spacing: 12) {
                Image(systemName: "xmark.seal.fill")
                    .foregroundStyle(.red).font(.largeTitle)
                Text(reason)
                    .font(.callout).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var idlePrompt: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("Is this site ready for AI agents?")
                .font(.headline)
            Text("Cloudflare's Agent Readiness score checks whether AI agents and assistants can discover, read, and act on your deployed site — the 2026 equivalent of a Lighthouse score, but for AI agents instead of browsers.")
                .font(.callout).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            Spacer()
        }
        .padding(16)
    }

    private func reportView(_ report: AgentReadinessReport) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(report.categories) { category in
                    Section {
                        Text(category.displayName).font(.subheadline.weight(.semibold))
                        ForEach(category.checks) { check in
                            checkRow(check)
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private func checkRow(_ check: AgentReadinessReport.Check) -> some View {
        HStack(alignment: .top, spacing: 8) {
            checkStatusIcon(check.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(check.displayName).font(.callout.weight(.medium))
                Text(check.hint).font(.caption).foregroundStyle(.secondary)
                if check.status == .fail && check.anglesiteProvides {
                    Text("Anglesite already supports this — redeploy the site to pick it up.")
                        .font(.caption).foregroundStyle(.blue)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(rowBackground(check.status))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private func checkStatusIcon(_ status: AgentReadinessReport.Check.Status) -> some View {
        switch status {
        case .pass:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .fail:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        case .neutral:
            Image(systemName: "minus.circle.fill").foregroundStyle(.secondary)
        }
    }

    private func rowBackground(_ status: AgentReadinessReport.Check.Status) -> Color {
        switch status {
        case .pass: return Color.green.opacity(0.06)
        case .fail: return Color.secondary.opacity(0.06)
        case .neutral: return Color.clear
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            switch model.phase {
            case .idle:
                Button("Check Score") { model.runScan() }
                    .buttonStyle(.borderedProminent)
            case .succeeded:
                Button("Rescan") { model.runScan() }
            case .failed:
                Button("Try Again") { model.retryFromFailed() }
            case .scanning:
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
