import SwiftUI
import AppKit
import AnglesiteCore

struct DomainSheetView: View {
    @Bindable var model: DomainModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 560, idealWidth: 640, minHeight: 420, idealHeight: 540)
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
            Image(systemName: "globe").font(.title3)
        case .resolvingZone, .applying:
            ProgressView().controlSize(.small)
        case .loaded, .addingRecord, .confirmingDelete:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.title3)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.title3)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .idle:
            return "Manage Domain"
        case .resolvingZone(let domain):
            return "Reading DNS records for \(domain)…"
        case .loaded(let records, let domain):
            return "\(records.count) DNS record\(records.count == 1 ? "" : "s") for \(domain)"
        case .addingRecord(_, _, let domain):
            return "Add a DNS record to \(domain)"
        case .confirmingDelete(_, _, let domain):
            return "Delete this record from \(domain)?"
        case .applying(let domain):
            return "Updating \(domain)…"
        case .failed:
            return "Couldn't read DNS records"
        }
    }

    private var headerSubtitle: String? {
        switch model.phase {
        case .addingRecord(let draft, _, _):
            switch draft.context {
            case .bluesky:
                return "Paste the DID Bluesky showed you (starts with \"did=did:plc:\")."
            case .google:
                return "Paste the exact record Google's verification page gave you."
            case .generic:
                return nil
            }
        default:
            return nil
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            domainInputForm
        case .resolvingZone:
            progressView("Resolving zone and reading DNS records…")
        case .loaded:
            recordList
        case .addingRecord(let draft, _, _):
            addRecordForm(draft)
        case .confirmingDelete(let record, _, _):
            deleteConfirmation(record)
        case .applying:
            progressView("Updating DNS records…")
        case .failed(let reason):
            VStack(spacing: 12) {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.largeTitle)
                Text(reason).font(.callout).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).frame(maxWidth: 420)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func progressView(_ text: String) -> some View {
        VStack(spacing: 8) {
            ProgressView()
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var domainInputForm: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "globe").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("Enter the domain to manage").font(.headline)
            Text("The domain must be managed in Cloudflare. Your API token needs Zone DNS Read and Edit permissions.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 400)
            TextField("example.com", text: $model.domainInput)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 300)
                .onSubmit { model.resolveAndLoad() }
            Spacer()
        }
        .padding(16)
    }

    private var recordList: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    model.useAsBlueskyHandle()
                } label: {
                    Label("Use this domain as your Bluesky handle", systemImage: "at")
                }
                .help("Verifies via /.well-known/atproto-did when the site is deployed here; otherwise adds a DNS record.")
                .disabled(model.isRunning)
                Button {
                    model.beginAddRecord(context: .google)
                } label: {
                    Label("Add Google verification", systemImage: "checkmark.seal")
                }
                .disabled(model.isRunning)
                Button {
                    model.openEmailSetup()
                } label: {
                    Label("Set up email", systemImage: "envelope")
                }
                .help("Recommend an email provider and pre-fill its DNS records")
                .disabled(model.isRunning)
                Spacer()
                Button {
                    model.refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Reload DNS records for this domain")
                .disabled(model.isRunning)
                Button {
                    model.beginAddRecord(context: .generic)
                } label: {
                    Label("Add record", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isRunning)
            }
            .padding(12)
            if model.blueskyHandlePhase != .idle {
                Divider()
                blueskyHandleBanner
            }
            Divider()
            if case .loaded(let records, _) = model.phase, records.isEmpty {
                VStack(spacing: 8) {
                    Text("No DNS records found.").font(.headline)
                    Text("Add one above to get started.").font(.callout).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if case .loaded(let records, _) = model.phase {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(records) { record in
                            recordRow(record)
                        }
                    }
                    .padding(12)
                }
            }
        }
    }

    @ViewBuilder
    private var blueskyHandleBanner: some View {
        switch model.blueskyHandlePhase {
        case .idle:
            EmptyView()
        case .verifying(let domain):
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Confirming \(domain) serves your Bluesky DID…").font(.callout)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        case .verified(let domain):
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("\(domain) is verified as your Bluesky handle.").font(.callout)
                Spacer()
                Button("Open Bluesky Settings") {
                    NSWorkspace.shared.open(DomainModel.blueskyHandleChangeURL)
                }
                Button {
                    model.dismissBlueskyHandleResult()
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        case .failed(_, let reason):
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                Text(reason).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Try again") { model.retryBlueskyHandleVerification() }
                Button {
                    model.dismissBlueskyHandleResult()
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    private func recordRow(_ record: DNSRecord) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(DNSRecordLabeler.label(for: record)).font(.callout.weight(.medium))
                Text("\(record.type) \(record.name) → \(record.content)")
                    .font(.caption.monospaced()).foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
            Button(role: .destructive) {
                model.beginDelete(record)
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
        }
        .padding(10)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func addRecordForm(_ draft: DomainModel.Draft) -> some View {
        Form {
            Picker("Type", selection: Binding(
                get: { draft.type },
                set: { var d = draft; d.type = $0; model.updateDraft(d) }
            )) {
                ForEach(["TXT", "CNAME", "A", "AAAA", "MX"], id: \.self) { Text($0).tag($0) }
            }
            TextField("Name", text: Binding(
                get: { draft.name },
                set: { var d = draft; d.name = $0; model.updateDraft(d) }
            ))
            TextField("Content", text: Binding(
                get: { draft.content },
                set: { var d = draft; d.content = $0; model.updateDraft(d) }
            ))
            TextField("TTL", value: Binding(
                get: { draft.ttl },
                set: { var d = draft; d.ttl = $0; model.updateDraft(d) }
            ), format: .number)
            if draft.type == "MX" {
                TextField("Priority", value: Binding(
                    get: { draft.priority ?? 10 },
                    set: { var d = draft; d.priority = $0; model.updateDraft(d) }
                ), format: .number)
                .help("Lower numbers are preferred mail servers, e.g. 10.")
            }
        }
        .padding(16)
    }

    private func isAddRecordFormValid(_ draft: DomainModel.Draft) -> Bool {
        !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draft.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func deleteConfirmation(_ record: DNSRecord) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow).font(.largeTitle)
            Text("\(record.type) \(record.name) → \(record.content)")
                .font(.callout.monospaced()).multilineTextAlignment(.center).frame(maxWidth: 420)
            Text("This can't be undone.").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(16)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            switch model.phase {
            case .idle:
                Button("Load records") { model.resolveAndLoad() }
                    .disabled(model.domainInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .buttonStyle(.borderedProminent)
            case .addingRecord(let draft, _, _):
                Button("Cancel") { model.cancelAddRecord() }
                Spacer()
                Button("Add") { model.submitAddRecord() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!isAddRecordFormValid(draft))
            case .confirmingDelete:
                Button("Cancel") { model.cancelDelete() }
                Spacer()
                Button("Delete", role: .destructive) { model.confirmDelete() }
            case .failed:
                Button("Try again") { model.retryFromFailed() }
            default:
                EmptyView()
            }
            if case .addingRecord = model.phase {} else if case .confirmingDelete = model.phase {} else {
                Spacer()
                Button("Close") { model.dismissSheet() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
