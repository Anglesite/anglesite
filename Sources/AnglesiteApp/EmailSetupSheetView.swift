import SwiftUI
import AnglesiteCore

/// Wizard UI for `EmailSetupModel` (#769) — Apple-first ecosystem question, provider
/// recommendation + domain/DMARC details, a review of the exact DNS records (with any SPF merge
/// called out), then apply. Structural template: header/content/footer split, same as
/// `DomainSheetView`.
struct EmailSetupSheetView: View {
    @Bindable var model: EmailSetupModel
    /// Dismisses the sheet — `SiteWindow` nils `SiteWindowModel.emailSetupModel` here, same as
    /// `copyEditModel`'s "Done" button.
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 560, idealWidth: 640, minHeight: 460, idealHeight: 560)
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
        switch model.step {
        case .buildingPlan, .applying:
            ProgressView().controlSize(.small)
        case .result(let result):
            Image(systemName: result.failures.isEmpty ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(result.failures.isEmpty ? .green : .yellow)
                .font(.title3)
        default:
            Image(systemName: "envelope").font(.title3)
        }
    }

    private var headerTitle: String {
        switch model.step {
        case .ecosystem: return "Set Up Business Email"
        case .appleTier: return "Personal or business?"
        case .details: return "Email provider details"
        case .buildingPlan: return "Checking existing DNS records…"
        case .review(let plan, _): return "Review \(plan.provider.displayName) setup"
        case .applying: return "Adding DNS records…"
        case .result(let result):
            return "Added \(result.addedCount) record\(result.addedCount == 1 ? "" : "s")"
        }
    }

    private var headerSubtitle: String? {
        switch model.step {
        case .review(_, let spfWasMerged) where spfWasMerged:
            return "Your existing SPF record will be updated to include this provider — not duplicated."
        case .result(let result) where !result.failures.isEmpty:
            return "\(result.failures.count) record\(result.failures.count == 1 ? "" : "s") couldn't be added."
        default:
            return nil
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.step {
        case .ecosystem:
            ecosystemStep
        case .appleTier:
            appleTierStep
        case .details:
            detailsStep
        case .buildingPlan:
            progressView("Reading existing DNS records…")
        case .review(let plan, _):
            reviewStep(plan)
        case .applying:
            progressView("Adding DNS records…")
        case .result(let result):
            resultStep(result)
        }
    }

    private func progressView(_ text: String) -> some View {
        VStack(spacing: 8) {
            ProgressView()
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var ecosystemStep: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "envelope.badge").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("Do you use Apple devices (iPhone, Mac) for this business?")
                .font(.headline).multilineTextAlignment(.center).frame(maxWidth: 420)
            HStack(spacing: 12) {
                Button("Yes, mostly Apple") { model.choose(ecosystem: .apple) }
                    .buttonStyle(.borderedProminent)
                Button("No, mixed or other devices") { model.choose(ecosystem: .mixedOrOther) }
            }
            Spacer()
        }
        .padding(16)
    }

    private var appleTierStep: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("Is this email for you personally, or for a registered business?")
                .font(.headline).multilineTextAlignment(.center).frame(maxWidth: 420)
            HStack(spacing: 12) {
                Button("Just me") { model.choose(appleTier: .personal) }
                    .buttonStyle(.borderedProminent)
                Button("Registered business") { model.choose(appleTier: .registeredBusiness) }
            }
            Spacer()
        }
        .padding(16)
    }

    private var detailsStep: some View {
        Form {
            if let recommendation = model.recommendation {
                Section {
                    Picker("Provider", selection: Binding(
                        get: { model.selectedProvider ?? recommendation.provider },
                        set: { model.selectProvider($0) }
                    )) {
                        ForEach(model.availableProviders, id: \.self) { provider in
                            Text(provider.displayName).tag(provider)
                        }
                    }
                    Text(recommendation.reason).font(.caption).foregroundStyle(.secondary)
                    if let provider = model.selectedProvider {
                        Text(provider.costSummary).font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Recommended provider")
                }
            }
            Section {
                TextField("example.com", text: $model.domain)
                TextField("owner@example.com", text: $model.dmarcReportEmail)
            } header: {
                Text("Domain & DMARC reports")
            } footer: {
                Text("DMARC reports go to this address so you'll hear about delivery problems.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
    }

    private func reviewStep(_ plan: EmailSetupPlanner.DNSPlan) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("DNS records to add").font(.subheadline.weight(.semibold))
                    ForEach(Array(plan.records.enumerated()), id: \.offset) { _, record in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(EmailSetupPlanner.explanation(forRecordType: record.type, name: record.name))
                                .font(.callout)
                            Text("\(record.type) \(record.name) → \(record.content)"
                                + (record.priority.map { " (priority \($0))" } ?? ""))
                                .font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                        .padding(10)
                        .background(Color.secondary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
                if !plan.manualSteps.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("You'll need to add these yourself").font(.subheadline.weight(.semibold))
                        ForEach(Array(plan.manualSteps.enumerated()), id: \.offset) { _, step in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(step.title).font(.callout.weight(.medium))
                                Text(step.instructions).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(10)
                            .background(Color.orange.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                    }
                }
            }
            .padding(16)
        }
    }

    private func resultStep(_ result: EmailSetupExecutor.Result) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if !result.failures.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(result.failures.enumerated()), id: \.offset) { _, failure in
                            Text("\(failure.record.type) \(failure.record.name): couldn't be added.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Text("Finish setup in your email provider's dashboard for any manual steps shown earlier, then your email will start working once DNS propagates (usually within a few hours).")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .padding(16)
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            switch model.step {
            case .appleTier, .details:
                Button("Back") { model.back() }
            default:
                EmptyView()
            }
            Spacer()
            switch model.step {
            case .details:
                Button("Continue") { model.buildPlan() }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.domain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || model.dmarcReportEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            case .review:
                Button("Add DNS Records") { model.apply() }
                    .buttonStyle(.borderedProminent)
            case .result:
                Button("Done") { onDone() }.keyboardShortcut(.defaultAction)
            case .buildingPlan, .applying:
                EmptyView()
            default:
                Button("Cancel") { onDone() }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
