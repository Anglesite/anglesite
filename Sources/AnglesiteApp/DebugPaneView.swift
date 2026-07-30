import SwiftUI
import UniformTypeIdentifiers
import AnglesiteCore

/// Live tail of every subprocess line that lands in `LogCenter.shared`.
///
/// Subscribes once per appearance, accumulates into local state, and offers source/stream filter
/// chips plus a free-text search so a developer hunting a bug can isolate the lines that matter.
/// `Pause` freezes the displayed rows (the underlying buffer keeps filling, so nothing is lost);
/// `Save…` and `Copy` export whatever's currently visible.
struct DebugPaneView: View {
    @State private var lines: [LogCenter.LogLine] = []
    @State private var frozenLines: [LogCenter.LogLine]?  // non-nil while paused: the snapshot to show
    @State private var knownSources: Set<String> = []
    @State private var sourceFilter: String = allSourcesTag
    @State private var streamFilter: StreamFilter = .all
    @State private var searchQuery: String = ""
    @State private var autoScroll: Bool = true
    @State private var subscriberTask: Task<Void, Never>?
    @State private var workerSessions: [WorkersDevSession] = []
    @State private var workersSubscriberTask: Task<Void, Never>?
    @Bindable private var esiPreviewMode = EsiPreviewMode.shared

    private static let allSourcesTag = "All"
    private let center: LogCenter
    private let workersCenter: WorkersDevStatusCenter

    init(center: LogCenter = .shared, workersCenter: WorkersDevStatusCenter = .shared) {
        self.center = center
        self.workersCenter = workersCenter
    }

    private var isPaused: Bool { frozenLines != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            toolbar
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            Divider()
            serverSection
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(visibleLines) { line in
                            row(for: line).id(line.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .background(Color(NSColor.textBackgroundColor))
                .onChange(of: visibleLines.last?.id) { _, newID in
                    guard autoScroll, !isPaused, let newID else { return }
                    withAnimation(.linear(duration: 0.05)) {
                        proxy.scrollTo(newID, anchor: .bottom)
                    }
                }
            }
        }
        .frame(minWidth: 680, minHeight: 400)
        .task { await startStreaming() }
        .task { await streamWorkerSessions() }
        .onDisappear {
            subscriberTask?.cancel()
            workersSubscriberTask?.cancel()
        }
    }

    private var toolbar: some View {
        HStack(spacing: 12) {
            Picker("Source", selection: $sourceFilter) {
                Text("All").tag(Self.allSourcesTag)
                ForEach(Array(knownSources).sorted(), id: \.self) { src in
                    Text(src).tag(src)
                }
            }
            .frame(maxWidth: 200)

            Picker("Stream", selection: $streamFilter) {
                ForEach(StreamFilter.allCases, id: \.self) { f in
                    Text(f.label).tag(f)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 200)

            TextField("Search", text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 140, maxWidth: 240)

            Spacer()

            Toggle("Pause", isOn: Binding(
                get: { isPaused },
                set: { frozenLines = $0 ? lines : nil }
            ))
            .toggleStyle(.switch)

            Toggle("Auto-scroll", isOn: $autoScroll)
                .toggleStyle(.switch)
                .disabled(isPaused)

            Button("Clear") {
                lines.removeAll()
                frozenLines = nil
            }
            Button("Copy") { copyVisibleToClipboard() }
            Button("Save…") { saveVisibleToFile() }
        }
    }

    /// Production-behavior controls, distinct from the log-filtering toolbar above. ESI's
    /// Live/Unprocessed toggle is the first control here (see
    /// docs/superpowers/specs/2026-07-13-esi-astro-component-design.md §4a); the Local Workers
    /// rows surface each open site's wrangler-dev session (#699,
    /// docs/superpowers/specs/2026-07-30-server-debug-panel-design.md §5).
    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text("Server").font(.headline)
                Picker("ESI Fragments", selection: $esiPreviewMode.unprocessed) {
                    Text("Live").tag(false)
                    Text("Unprocessed (show fallbacks)").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)
                Spacer()
            }
            ForEach(workerSessions) { session in
                workerRow(session)
            }
        }
    }

    private func workerRow(_ session: WorkersDevSession) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
                .fill(statusColor(session.status))
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)  // the status text carries the meaning
            Text(session.displayName)
                .font(.system(size: 12, weight: .medium))
            statusText(session.status)
                .font(.system(size: 12))
            if case .running(.some(let url)) = session.status {
                Link(url.absoluteString, destination: url)
                    .font(.system(size: 12, design: .monospaced))
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(url.absoluteString, forType: .string)
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .help("Copy local worker URL")
                .accessibilityLabel("Copy local worker URL")
            }
            if case .failed(let reason) = session.status {
                Text(reason)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(reason)
            }
            Spacer()
        }
        .padding(.leading, 4)
    }

    private func statusColor(_ status: WorkersDevStatus) -> Color {
        switch status {
        case .starting: return Color(NSColor.secondaryLabelColor).opacity(0.5)
        case .running: return .green
        case .restarting: return .orange
        case .failed: return .red
        }
    }

    private func statusText(_ status: WorkersDevStatus) -> Text {
        switch status {
        case .starting: return Text("Starting…").foregroundStyle(.secondary)
        case .running: return Text("Running").foregroundStyle(.secondary)
        case .restarting(let attempt): return Text("Restarting (attempt \(attempt))").foregroundStyle(.orange)
        case .failed: return Text("Failed").foregroundStyle(.red)
        }
    }

    private func row(for line: LogCenter.LogLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(Self.timeFormatter.string(from: line.timestamp))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(width: 88, alignment: .leading)
            Text(line.source)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 140, alignment: .leading)
                .lineLimit(1)
            Image(systemName: line.stream == .stderr ? "exclamationmark.bubble" : "text.bubble")
                .foregroundStyle(line.stream == .stderr ? .orange : .secondary)
                .imageScale(.small)
                .accessibilityLabel(line.stream == .stderr ? "Standard error" : "Standard output")
            Text(line.text)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var visibleLines: [LogCenter.LogLine] {
        (frozenLines ?? lines).filtered(
            source: sourceFilter == Self.allSourcesTag ? nil : sourceFilter,
            stream: streamFilter.logStream,
            query: searchQuery
        )
    }

    private func startStreaming() async {
        // Replay buffered history first so opening the pane mid-session shows context.
        let history = await center.snapshot()
        lines = history
        for line in history { knownSources.insert(line.source) }

        let subscription = await center.subscribe()
        let task = Task { @MainActor in
            for await line in subscription.stream {
                if Task.isCancelled { break }
                lines.append(line)
                if lines.count > 5000 { lines.removeFirst(lines.count - 5000) }
                knownSources.insert(line.source)
            }
        }
        subscriberTask = task
        // Wait so the task is cleaned up when this scope ends; never returns under normal use.
        _ = await task.value
    }

    private func streamWorkerSessions() async {
        // subscribe() replays the current snapshot as its first element, so a pane opened
        // mid-session shows existing rows immediately.
        let subscription = await workersCenter.subscribe()
        let task = Task { @MainActor in
            for await sessions in subscription.stream {
                if Task.isCancelled { break }
                workerSessions = sessions
            }
        }
        workersSubscriberTask = task
        _ = await task.value
    }

    private func copyVisibleToClipboard() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(visibleLines.exportText(), forType: .string)
    }

    private func saveVisibleToFile() {
        let panel = NSSavePanel()
        panel.title = "Save Process Log"
        panel.nameFieldStringValue = "anglesite-\(Self.fileStampFormatter.string(from: Date())).log"
        if #available(macOS 11.0, *) {
            panel.allowedContentTypes = [UTType(filenameExtension: "log") ?? .plainText, .plainText]
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? visibleLines.exportText().write(to: url, atomically: true, encoding: .utf8)
    }

    enum StreamFilter: String, CaseIterable, Hashable {
        case all, stdout, stderr
        var label: String {
            switch self {
            case .all: return "Both"
            case .stdout: return "Out"
            case .stderr: return "Err"
            }
        }
        var logStream: LogCenter.Stream? {
            switch self {
            case .all: return nil
            case .stdout: return .stdout
            case .stderr: return .stderr
            }
        }
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    private static let fileStampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        return f
    }()
}

#Preview {
    DebugPaneView()
}
