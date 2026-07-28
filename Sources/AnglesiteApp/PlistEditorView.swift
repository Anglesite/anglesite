import AppKit
import SwiftUI
import AnglesiteCore

struct PlistEditorView: View {
    @Bindable var model: PlistEditorModel
    let onWebsiteTitleSaved: (String) -> Void

    private enum SettingsTab: String, CaseIterable, Identifiable {
        case website = "Website"
        case analytics = "Analytics"
        case redirects = "Redirects"
        case licensing = "Licensing"
        case emailSecurity = "Email Security"
        case securityReports = "Security Reports"
        case workers = "Workers"
        var id: Self { self }
    }

    @Environment(\.controlActiveState) private var controlActiveState
    @State private var selectedTab: SettingsTab = .website
    @State private var showingCustomAnalyticsHelp = false
    @State private var isConfirmingEnablePVR = false
    @State private var isConfirmingEnablePVRForConfiguredRepo = false
    @FocusState private var titleFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task(id: model.file.id) { await model.load() }
        .onChange(of: titleFocused) { wasFocused, isFocused in
            if wasFocused && !isFocused {
                Task { await saveWebsiteTitle() }
            }
        }
        .onChange(of: selectedTab) { oldValue, _ in
            if oldValue == .analytics {
                Task { await model.saveAnalytics() }
            } else if oldValue == .redirects {
                Task { await model.saveRedirects() }
            } else if oldValue == .licensing {
                Task { await model.saveLicensing() }
            } else if oldValue == .emailSecurity {
                Task { await model.saveMtaSts() }
            } else if oldValue == .securityReports {
                Task { await model.saveSecurityReporting() }
            }
        }
        .onChange(of: controlActiveState) { _, new in
            if new == .key { Task { await model.checkExternalChange() } }
        }
        .alert("Website details changed on disk", isPresented: conflictBinding) {
            Button("Keep My Changes", role: .cancel) { model.keepMyChanges() }
            Button("Reload from Disk") { Task { await model.reloadFromDisk() } }
        } message: {
            Text("Another tool edited the website details while you had unsaved changes.")
        }
    }

    private var header: some View {
        HStack {
            Label("Settings", systemImage: "gearshape")
                .font(.headline)
            if model.hasAnyUnsavedEdits {
                Circle().fill(.secondary).frame(width: 7, height: 7)
                    .help("Unsaved changes")
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
        if let loadError = model.loadError {
            ContentUnavailableView {
                Label("Can't open website details", systemImage: "exclamationmark.triangle")
            } description: {
                Text(loadError)
            }
        } else if model.isLoading {
            ProgressView().controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.entries.isEmpty {
            ContentUnavailableView {
                Label("No website details", systemImage: "globe")
            } description: {
                Text("There are no editable website details.")
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Picker("Settings", selection: $selectedTab) {
                        ForEach(SettingsTab.allCases) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(maxWidth: 520)

                    if let validationMessage = model.validationMessage {
                        Label(validationMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                    if selectedTab != .analytics, let analyticsError = model.analyticsError {
                        Label(analyticsError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                    if selectedTab != .redirects, let redirectsError = model.redirectsError {
                        Label(redirectsError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                    if selectedTab != .licensing, let licensingError = model.licensingError {
                        Label(licensingError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                    if selectedTab != .emailSecurity, let mtaStsError = model.mtaStsError {
                        Label(mtaStsError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                    if selectedTab != .securityReports, let securityReportingError = model.securityReportingError {
                        Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }

                    switch selectedTab {
                    case .website:
                        websiteTab
                    case .analytics:
                        analyticsTab
                    case .redirects:
                        redirectsTab
                    case .licensing:
                        ContentLicensingTab(model: model)
                    case .emailSecurity:
                        emailSecurityTab
                    case .securityReports:
                        securityReportsTab
                    case .workers:
                        workersTab
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }

    private var websiteTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                    Text("Title")
                        .frame(minWidth: 160, alignment: .leading)
                    TextField("Title", text: $model.websiteTitle)
                        .focused($titleFocused)
                        .onSubmit { Task { await saveWebsiteTitle() } }
                        .frame(minWidth: 220)
                }
                GridRow {
                    Text("Icons")
                        .frame(minWidth: 160, alignment: .leading)
                    HStack(spacing: 8) {
                        Image(systemName: model.hasWebsiteIcons ? "checkmark.circle.fill" : "globe")
                            .foregroundStyle(model.hasWebsiteIcons ? .green : .secondary)
                            .frame(width: 18)
                        Text(model.hasWebsiteIcons ? "Installed" : "Not Set")
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 72, alignment: .leading)
                        Button {
                            chooseWebsiteIcon()
                        } label: {
                            Label(model.hasWebsiteIcons ? "Change Image" : "Choose Image",
                                  systemImage: "photo.badge.plus")
                        }
                        .disabled(model.isInstallingIcons)
                        if model.isInstallingIcons {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                }
            }
            .textFieldStyle(.roundedBorder)
            if let iconError = model.iconError {
                Label(iconError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }
        }
    }

    private var analyticsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                    Text("Cloudflare")
                        .frame(minWidth: 160, alignment: .leading)
                    HStack(spacing: 8) {
                        Toggle("Cloudflare", isOn: cloudflareAnalyticsBinding)
                            .toggleStyle(.switch)
                            .labelsHidden()
                            .disabled(model.isConfiguringCloudflareAnalytics)
                        Text(model.cloudflareAnalyticsEnabled ? "On" : "Off")
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 28, alignment: .leading)
                        if model.isConfiguringCloudflareAnalytics {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Link(destination: WebsiteAnalyticsAsset.dashboardURL) {
                            Label("Open Dashboard", systemImage: "arrow.up.right.square")
                        }
                    }
                }
                GridRow(alignment: .top) {
                    HStack(spacing: 6) {
                        Text("Custom")
                        Button {
                            showingCustomAnalyticsHelp = true
                        } label: {
                            Image(systemName: "questionmark.circle")
                        }
                        .buttonStyle(.plain)
                        .help("About custom analytics")
                    }
                    .frame(minWidth: 160, alignment: .leading)
                    .padding(.top, 4)
                    HTMLSnippetEditor(text: $model.analyticsSettings.customHeadTag) {
                        Task { await model.saveAnalytics() }
                    }
                        .frame(minWidth: 360, minHeight: 90)
                        .overlay {
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(customAnalyticsMessage == nil ? Color.secondary.opacity(0.25) : Color.orange)
                        }
                }
            }
            .textFieldStyle(.roundedBorder)
            HStack(spacing: 8) {
                if model.isSavingAnalytics {
                    ProgressView()
                        .controlSize(.small)
                }
                if let customAnalyticsMessage {
                    Label(customAnalyticsMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.callout)
                }
            }
        }
        .popover(isPresented: $showingCustomAnalyticsHelp, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Custom Analytics")
                    .font(.headline)
                Text("Paste the HTML code from another analytics provider here, such as Google Analytics, Plausible, Fathom, or a conversion tag.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(width: 280, alignment: .leading)
            }
            .padding()
        }
    }

    /// Stable per-row identity for the in-progress editing table below: `RedirectsStore.RedirectEntry.id`
    /// is `source`, which two freshly-added blank rows both share until the user types something, so it
    /// can't be used as SwiftUI row identity here. The array index is stable for the lifetime of a single
    /// render pass and doesn't collide, so every binding and the delete action key off it instead.
    private struct RedirectRow: Identifiable {
        let id: Int
        let entry: RedirectsStore.RedirectEntry
    }

    private var redirectRows: [RedirectRow] {
        model.redirectEntries.enumerated().map { RedirectRow(id: $0.offset, entry: $0.element) }
    }

    private var redirectsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.redirectEntries.isEmpty {
                Text("No redirects yet. Add one below.")
                    .foregroundStyle(.secondary)
            } else {
                Table(redirectRows) {
                    TableColumn("Source") { row in
                        TextField("/old-path", text: sourceBinding(at: row.id))
                    }
                    TableColumn("Destination") { row in
                        TextField("/new-path", text: destinationBinding(at: row.id))
                    }
                    TableColumn("Type") { row in
                        Picker("Type", selection: codeBinding(at: row.id)) {
                            Text("301").tag(RedirectsStore.RedirectEntry.Code.permanent)
                            Text("302").tag(RedirectsStore.RedirectEntry.Code.temporary)
                        }
                        .labelsHidden()
                    }
                    TableColumn("") { row in
                        Button(role: .destructive) {
                            model.redirectEntries.remove(at: row.id)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(minHeight: 120)
            }
            HStack(spacing: 8) {
                Button {
                    model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "", destination: "", code: .permanent))
                } label: {
                    Label("Add Redirect", systemImage: "plus")
                }
                if model.isSavingRedirects {
                    ProgressView().controlSize(.small)
                }
            }
        }
    }

    private func sourceBinding(at index: Int) -> Binding<String> {
        Binding(
            get: { model.redirectEntries.indices.contains(index) ? model.redirectEntries[index].source : "" },
            set: { newValue in
                if model.redirectEntries.indices.contains(index) {
                    model.redirectEntries[index].source = newValue
                }
            })
    }

    private func destinationBinding(at index: Int) -> Binding<String> {
        Binding(
            get: { model.redirectEntries.indices.contains(index) ? model.redirectEntries[index].destination : "" },
            set: { newValue in
                if model.redirectEntries.indices.contains(index) {
                    model.redirectEntries[index].destination = newValue
                }
            })
    }

    private func codeBinding(at index: Int) -> Binding<RedirectsStore.RedirectEntry.Code> {
        Binding(
            get: { model.redirectEntries.indices.contains(index) ? model.redirectEntries[index].code : .permanent },
            set: { newValue in
                if model.redirectEntries.indices.contains(index) {
                    model.redirectEntries[index].code = newValue
                }
            })
    }

    private var emailSecurityTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("MTA-STS")
                    .font(.headline)
                Text("Require TLS for mail delivered to this domain. Start in testing mode and only switch to enforce after your mail provider is working cleanly.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                GridRow {
                    Text("Mode").frame(minWidth: 160, alignment: .leading)
                    Picker("Mode", selection: $model.mtaStsSettings.mode) {
                        Text("Off").tag(MTAStsPolicyAsset.Mode.disabled)
                        Text("Testing").tag(MTAStsPolicyAsset.Mode.testing)
                        Text("Enforce").tag(MTAStsPolicyAsset.Mode.enforce)
                    }
                    .labelsHidden()
                    .frame(width: 160, alignment: .leading)
                }
                GridRow {
                    Text("Mail domain").frame(minWidth: 160, alignment: .leading)
                    TextField("example.com", text: $model.mtaStsSettings.domain)
                        .frame(minWidth: 260)
                }
                GridRow(alignment: .top) {
                    Text("Allowed MX hosts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 6) {
                        TextEditor(text: $model.mtaStsSettings.mxHosts)
                            .font(.body.monospaced())
                            .frame(minWidth: 260, minHeight: 72)
                            .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                            .accessibilityLabel("Allowed MX hosts")
                        Button("Use MX Records from DNS") { Task { await model.detectMtaStsMXHosts() } }
                            .disabled(MTAStsPolicyAsset.normalizedDomain(model.mtaStsSettings.domain).isEmpty || model.isPublishingMtaStsDNS)
                    }
                }
                GridRow {
                    Text("TLS report mailbox").frame(minWidth: 160, alignment: .leading)
                    TextField("Optional: tls-reports@example.com", text: $model.mtaStsSettings.reportMailbox)
                        .frame(minWidth: 260)
                }
            }
            .textFieldStyle(.roundedBorder)

            if model.mtaStsSettings.mode != .disabled {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Required DNS records", systemImage: "dns")
                        .font(.headline)
                    Text("Point mta-sts.\(displayDomain) at this deployed site and ensure it has a valid HTTPS certificate. Add these TXT records automatically, or copy them into Website → Manage Domain. The MTA-STS ID changes automatically when this policy changes.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if mtaStsDNSRecords.isEmpty {
                        Text("Enter a valid mail domain and at least one MX host to prepare the DNS records.")
                            .font(.callout)
                            .foregroundStyle(.orange)
                    } else {
                        ForEach(mtaStsDNSRecords, id: \.name) { record in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("TXT \(record.name)").font(.callout.monospaced().weight(.medium))
                                Text(record.content).font(.callout.monospaced()).textSelection(.enabled)
                            }
                        }
                        Button("Publish DNS Records") { Task { await model.publishMtaStsDNSRecords() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.isPublishingMtaStsDNS)
                    }
                }
                .padding(10)
                .background(Color.secondary.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }

            if model.isSavingMtaSts || model.isPublishingMtaStsDNS {
                ProgressView().controlSize(.small)
            }
        }
    }

    private var securityReportsTab: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Vulnerability reports")
                    .font(.headline)
                Text("Publish where security researchers should report problems with this site. Anglesite writes an RFC 9116 security.txt from these settings; the first contact is the one researchers should try first.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                GridRow {
                    Text("Publishing").frame(minWidth: 160, alignment: .leading)
                    Picker("Publishing", selection: $model.securityReportingSettings.mode) {
                        Text("Generated by Anglesite").tag(SecurityReportingAsset.Mode.generated)
                        Text("Hand-authored").tag(SecurityReportingAsset.Mode.manual)
                        Text("Off").tag(SecurityReportingAsset.Mode.disabled)
                    }
                    .labelsHidden()
                    .frame(width: 220, alignment: .leading)
                }
                GridRow(alignment: .top) {
                    Text("Contacts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 6) {
                        TextEditor(text: $model.securityReportingSettings.contacts)
                            .font(.body.monospaced())
                            .frame(minWidth: 260, minHeight: 72)
                            .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                            .accessibilityLabel("Security contacts")
                        Text("One per line, most preferred first. An email address, or an https:// page where reports are accepted.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            securityReportsGitHubCallout

            if let securityReportingError = model.securityReportingError {
                Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            if model.isSavingSecurityReporting || model.isCheckingRepoSecurity {
                ProgressView().controlSize(.small)
            }
        }
        .task { await model.refreshRepoSecurityState() }
    }

    @ViewBuilder
    private var securityReportsGitHubCallout: some View {
        if let repo = model.securityReportingRepo {
            VStack(alignment: .leading, spacing: 6) {
                Label("GitHub", systemImage: "shield.lefthalf.filled")
                    .font(.headline)
                if model.securityReportingSettings.mode == .manual {
                    // Manual mode: `planSecurityTxt` never generates security.txt for this site
                    // (the owner hand-maintains it), so offering to route reports here — and
                    // enabling PVR to back a contact Anglesite won't publish — would tell the
                    // owner reports go somewhere they don't. Show the address to copy into their
                    // own file instead, and offer no action.
                    Text("Publishing is set to Hand-authored, so Anglesite isn't generating security.txt for this site. Add this address to your own file if you want to route reports to GitHub:")
                        .font(.callout)
                    Text(SecurityReportingAsset.advisoryURL(for: repo).absoluteString)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                } else {
                    switch model.securityReportingReadiness {
                    case .alreadyConfigured:
                        Text("Reports go to \(repo.owner)/\(repo.name)'s private advisory form.")
                            .font(.callout)
                        Link("Open the advisory form", destination: SecurityReportingAsset.advisoryURL(for: repo))
                            .font(.callout)
                        if model.securityReportingStateIsKnown {
                            if model.securityReportingRepoIsPrivate {
                                Label("\(repo.owner)/\(repo.name) is now private, so researchers outside it can't reach this form. Make the repository public, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                                    .font(.callout)
                                    .foregroundStyle(.orange)
                            }
                            if !model.securityReportingPVREnabled {
                                Label("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so this form can't accept reports yet. Turn it on, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                                    .font(.callout)
                                    .foregroundStyle(.orange)
                                Button("Enable Private Reporting") { isConfirmingEnablePVRForConfiguredRepo = true }
                                    .buttonStyle(.bordered)
                                    .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                            }
                        } else {
                            // A check has never succeeded for this repo (first-ever check failed, or
                            // the remote just changed) — `securityReportingRepoIsPrivate`/
                            // `securityReportingPVREnabled` are still unpopulated `false` defaults, so
                            // rendering either warning above would assert state nobody actually
                            // observed. The "couldn't check" error banner below already explains why.
                            Text("Couldn't confirm \(repo.owner)/\(repo.name)'s visibility or private-reporting status on the last check.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    case .ready:
                        Text("\(repo.owner)/\(repo.name) accepts private vulnerability reports. Routing reports there keeps them out of public issues and off your inbox.")
                            .font(.callout)
                        Button("Route Reports to GitHub") { Task { await model.adoptAdvisoryForm() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                    case .needsPVR:
                        Text("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so its advisory form can't accept reports yet. Anglesite can turn it on for you.")
                            .font(.callout)
                        Button("Enable Private Reporting and Route Reports") { isConfirmingEnablePVR = true }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting || model.isAdoptingAdvisoryForm)
                    case .repoPrivate:
                        Text("\(repo.owner)/\(repo.name) is a private repository, so its advisory form isn't reachable by anyone outside it. Make the repository public to route reports there.")
                            .font(.callout)
                    case .unknown:
                        // The check hasn't completed, or it failed. `securityReportingError`
                        // (rendered by the tab below) carries the reason; don't offer an action
                        // we can't back up.
                        Text("Checking whether \(repo.owner)/\(repo.name) can accept private vulnerability reports…")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    case .notGitHub:
                        EmptyView()
                    }
                }
            }
            .padding(10)
            .background(Color.secondary.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .confirmationDialog(
                "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                isPresented: $isConfirmingEnablePVR,
                titleVisibility: .visible
            ) {
                Button("Turn On and Route Reports") { Task { await model.adoptAdvisoryForm() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
            }
            .confirmationDialog(
                "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                isPresented: $isConfirmingEnablePVRForConfiguredRepo,
                titleVisibility: .visible
            ) {
                Button("Turn On") { Task { await model.enablePrivateVulnerabilityReportingForConfiguredRepo() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
            }
        }
    }

    private var workersTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Button {
                    NSWorkspace.shared.open(model.workerDashboardLogsURL)
                } label: {
                    Label("Production Logs", systemImage: "text.alignleft")
                }
                .disabled(!model.workerDashboardEnabled)
                Button {
                    NSWorkspace.shared.open(model.workerDashboardAnalyticsURL)
                } label: {
                    Label("Analytics", systemImage: "chart.bar.xaxis")
                }
                .disabled(!model.workerDashboardEnabled)
                if model.isLoadingWorkers {
                    ProgressView().controlSize(.small)
                }
            }
            if !model.workerDashboardEnabled {
                Text("Logs and analytics become available after the first deploy that includes a worker.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let workersError = model.workersError {
                Label(workersError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            ForEach(model.workerGroups) { group in
                VStack(alignment: .leading, spacing: 8) {
                    // Group keys are manifest-owned free text (design doc §3) — display-cased,
                    // never localized or enumerated here.
                    Text(group.name.capitalized)
                        .font(.headline)
                    ForEach(group.rows) { row in
                        workerRow(row)
                    }
                }
            }
        }
        .task { await model.loadWorkers() }
    }

    private func workerRow(_ row: PlistEditorModel.WorkerRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(row.descriptor.displayName)
                .frame(minWidth: 160, alignment: .leading)
                .help(row.descriptor.description)
            switch row.status {
            case .componentTied(let affectedPages):
                if affectedPages.isEmpty {
                    Text("Inactive — not used")
                        .foregroundStyle(.secondary)
                } else {
                    WorkerAffectedPagesButton(pages: affectedPages)
                }
            case .settingsActivated(let isOn):
                Toggle(row.descriptor.displayName, isOn: Binding(
                    get: { isOn },
                    set: { newValue in
                        Task { await model.setWorkerActive(row.id, isOn: newValue) }
                    }))
                    .toggleStyle(.switch)
                    .labelsHidden()
                Text(isOn ? "On" : "Off")
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 28, alignment: .leading)
            }
        }
    }

    private var displayDomain: String {
        let domain = MTAStsPolicyAsset.normalizedDomain(model.mtaStsSettings.domain)
        return domain.isEmpty ? "your-domain" : domain
    }

    private var mtaStsDNSRecords: [MTAStsPolicyAsset.DNSRecord] {
        let domain = MTAStsPolicyAsset.normalizedDomain(model.mtaStsSettings.domain)
        guard !domain.isEmpty else { return [] }
        return MTAStsPolicyAsset.dnsRecords(for: domain, settings: model.mtaStsSettings)
    }

    private var conflictBinding: Binding<Bool> {
        Binding(get: { model.conflictDiskContents != nil }, set: { _ in })
    }

    private var customAnalyticsMessage: String? {
        model.analyticsError ?? model.customAnalyticsValidationMessage
    }

    private func saveWebsiteTitle() async {
        guard model.validationMessage == nil else { return }
        if await model.save() {
            onWebsiteTitleSaved(model.websiteTitle)
        }
    }

    private var cloudflareAnalyticsBinding: Binding<Bool> {
        Binding(
            get: { model.cloudflareAnalyticsEnabled },
            set: { enabled in
                Task { await model.setCloudflareAnalyticsEnabled(enabled) }
            }
        )
    }

    private func chooseWebsiteIcon() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = WebsiteIconInstaller.allowedContentTypes
        panel.prompt = model.hasWebsiteIcons ? String(localized: "Change") : String(localized: "Choose")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await model.installWebsiteIcons(from: url) }
    }
}

/// "Active — used on N pages" with the page list in a popover — the read-only status for a
/// component-tied worker (design doc §8; popover chosen over Navigator selection as the
/// implementation-time UI call the spec left open).
private struct WorkerAffectedPagesButton: View {
    let pages: [SiteGraphNode]
    @State private var showingPages = false

    var body: some View {
        Button {
            showingPages = true
        } label: {
            Text("Active — used on ^[\(pages.count) page](inflect: true)")
        }
        .buttonStyle(.link)
        .popover(isPresented: $showingPages, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Pages using this worker's components")
                    .font(.headline)
                ForEach(pages) { page in
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(.secondary)
                        Text(page.title)
                        if let route = page.route {
                            Text(route)
                                .font(.callout.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding()
            .frame(minWidth: 220, alignment: .leading)
        }
    }
}
