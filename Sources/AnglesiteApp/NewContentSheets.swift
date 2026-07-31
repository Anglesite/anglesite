import AppKit
import SwiftUI
import AnglesiteCore

struct NewPageSheet: View {
    let site: SiteStore.Site?
    let onCreate: (String, String?, ContentScaffold.PageTemplate) async -> ContentCreateResult

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var route = ""
    @State private var routeFollowsTitle = true
    @State private var baseURLPrefix = "https://example.com/"
    @State private var template = ContentScaffold.PageTemplate.standard
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Page") {
                    TextField("Title", text: $title)
                    HStack {
                        Text("URL")
                        Spacer(minLength: 16)
                        HStack(spacing: 0) {
                            Text(baseURLPrefix)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            TextField("Route", text: routeBinding, prompt: Text(routePrompt))
                                .labelsHidden()
                                .multilineTextAlignment(.trailing)
                                .textFieldStyle(.plain)
                                .frame(width: routeFieldWidth, alignment: .trailing)
                            Text("/")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Template") {
                    Picker("Template", selection: $template) {
                        ForEach(ContentScaffold.PageTemplate.builtIns) { template in
                            Text(template.displayName).tag(template)
                        }
                    }
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 420, minHeight: 250)
            .navigationTitle("New Page")
            .onChange(of: title) { _, _ in
                if routeFollowsTitle {
                    route = defaultRoute
                }
            }
            .task(id: site?.id) {
                baseURLPrefix = await Self.resolveBaseURLPrefix(for: site)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isCreating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "Creating…" : "Create") {
                        create()
                    }
                    .disabled(isCreating || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    /// Editing the route through this binding detaches it from the title. Re-enabling
    /// auto-follow requires an explicit gesture, not an incidental match against the
    /// derived slug — so the setter only ever clears the flag, never restores it.
    /// Programmatic updates from `onChange(of: title)` write `route` directly and so
    /// bypass this setter, leaving auto-follow intact.
    private var routeBinding: Binding<String> {
        Binding(
            get: { route },
            set: { newValue in
                route = newValue
                routeFollowsTitle = false
            }
        )
    }

    private var defaultRoute: String {
        ContentScaffold.slugify(title.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var routePrompt: String {
        defaultRoute.isEmpty ? "my-new-webpage" : defaultRoute
    }

    private var routeFieldWidth: CGFloat {
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        let measured = (routeTextForSizing as NSString).size(withAttributes: [.font: font]).width
        return min(max(ceil(measured) + 4, 40), 280)
    }

    private var routeTextForSizing: String {
        route.isEmpty ? routePrompt : route
    }

    /// Build the public-URL prefix for the page route, reading `.site-config` off the
    /// main actor. Recomputed whenever the bound `site` changes, so a sheet opened
    /// before the site finished loading still picks up the real host once it arrives.
    private static func resolveBaseURLPrefix(for site: SiteStore.Site?) async -> String {
        let fallbackHost = "example.com"
        let config: String
        if let site {
            let directory = site.sourceDirectory
            config = await Task.detached(priority: .utility) {
                (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: directory)) ?? ""
            }.value
        } else {
            config = ""
        }
        let host = WebsiteAnalyticsAsset.bestHost(from: config, fallback: fallbackHost)
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let absolute = trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://")
            ? trimmed
            : "https://\(trimmed.isEmpty ? fallbackHost : trimmed)"
        return absolute.hasSuffix("/") ? absolute : absolute + "/"
    }

    private func create() {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanRoute = route.trimmingCharacters(in: .whitespacesAndNewlines)
        isCreating = true
        errorMessage = nil
        Task {
            let result = await onCreate(cleanTitle, cleanRoute.isEmpty ? nil : cleanRoute, template)
            await MainActor.run {
                isCreating = false
                switch result {
                case .created:
                    dismiss()
                case .siteNotFound:
                    errorMessage = "This site is no longer available."
                case .failed(let reason):
                    errorMessage = reason
                }
            }
        }
    }
}

struct NewCollectionEntrySheet: View {
    let descriptors: [ContentTypeDescriptor]
    let onCreate: (String, String?, ContentTypeDescriptor, [String: String]) async -> ContentCreateResult

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var slug = ""
    @State private var selectedID: String
    /// Values for the selected type's required `.url` fields, keyed by field name. A bookmark,
    /// reply, or like is schema-invalid without one, so these are collected before the write rather
    /// than scaffolded empty (#916).
    @State private var urlValues: [String: String] = [:]
    @State private var isCreating = false
    @State private var errorMessage: String?

    init(
        descriptors: [ContentTypeDescriptor],
        onCreate: @escaping (String, String?, ContentTypeDescriptor, [String: String]) async -> ContentCreateResult
    ) {
        self.descriptors = descriptors
        self.onCreate = onCreate
        _selectedID = State(initialValue: descriptors.first?.id ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if descriptors.isEmpty {
                    ContentUnavailableView(
                        "No Collection Types",
                        systemImage: "tray",
                        description: Text("This site does not have any collection-backed content types.")
                    )
                } else {
                    Section("Collection Entry") {
                        Picker("Type", selection: $selectedID) {
                            ForEach(descriptors) { descriptor in
                                Text(descriptor.displayName).tag(descriptor.id)
                            }
                        }
                        // A reply or like has no title field — it is identified by its target URL,
                        // so asking for a title would collect a value the entry never stores (#916).
                        // A bookmark's title is schema-optional (its target URL is the point), so
                        // it's shown but not required — an empty title falls back to a URL-derived
                        // slug in NativeContentOperations.createTyped (#1011).
                        if selectedDescriptor?.titleField != nil {
                            TextField(
                                "Title", text: $title,
                                prompt: selectedDescriptor?.titleIsRequired == true ? nil : Text("optional"))
                        }
                        // Field names match the inspector's labels in `TypedEntryForm`, including
                        // the " *" required suffix — every field here is schema-required (#916),
                        // and without it an untouched reply/like row gives no sign anything's
                        // missing before Create refuses to enable (#1010).
                        ForEach(requiredURLFields, id: \.name) { field in
                            TextField(
                                field.name + (field.required ? " *" : ""),
                                text: urlBinding(field.name),
                                prompt: Text(verbatim: "https://example.com/post"))
                        }
                        TextField("Slug", text: $slug, prompt: Text("optional"))
                        if hasMalformedURL {
                            Text("Enter an absolute URL, e.g. https://example.com/post")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    // Switching type changes which fields exist, so per-type input must not survive
                    // the switch. `title` in particular becomes invisible after a switch to a
                    // titleless type yet still wins slug precedence in NativeContentOperations — so
                    // it has to be cleared here, not just hidden. `slug` is an explicit user override
                    // and stays meaningful across types, so it is left alone.
                    .onChange(of: selectedID) {
                        title = ""
                        urlValues = [:]
                        errorMessage = nil
                    }
                    if let selectedCollection {
                        Section("Destination") {
                            LabeledContent("Collection", value: selectedCollection)
                        }
                    }
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 440, minHeight: 280)
            .navigationTitle("New Collection")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isCreating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "Creating…" : "Create") {
                        create()
                    }
                    .disabled(isCreating || selectedCollection == nil || !titleIsSatisfied || !urlFieldsAreValid)
                }
            }
        }
    }

    private var selectedDescriptor: ContentTypeDescriptor? {
        descriptors.first { $0.id == selectedID }
    }

    private var selectedCollection: String? {
        selectedDescriptor?.collection
    }

    private var requiredURLFields: [ContentTypeField] {
        selectedDescriptor?.requiredURLFields ?? []
    }

    private func urlBinding(_ name: String) -> Binding<String> {
        Binding(get: { urlValues[name] ?? "" }, set: { urlValues[name] = $0 })
    }

    private func trimmedURL(_ name: String) -> String {
        (urlValues[name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Every required `.url` field holds a value the write boundary will accept.
    private var urlFieldsAreValid: Bool {
        requiredURLFields.allSatisfy { ContentFieldValidation.isAbsoluteURL(trimmedURL($0.name)) }
    }

    /// A field the user has started typing into that isn't a valid URL yet — drives the hint below
    /// the fields. Empty fields don't nag; they just leave Create disabled.
    private var hasMalformedURL: Bool {
        requiredURLFields.contains {
            let value = trimmedURL($0.name)
            return !value.isEmpty && !ContentFieldValidation.isAbsoluteURL(value)
        }
    }

    /// Only a schema-required title field imposes a requirement — a type whose title is optional
    /// (e.g. `bookmark`, defined by its target URL) or absent imposes none (#1011).
    private var titleIsSatisfied: Bool {
        selectedDescriptor?.titleIsRequired != true
            || !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func create() {
        guard let descriptor = selectedDescriptor, selectedCollection != nil else { return }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSlug = slug.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanURLs = requiredURLFields.reduce(into: [String: String]()) { values, field in
            values[field.name] = trimmedURL(field.name)
        }
        isCreating = true
        errorMessage = nil
        Task {
            let result = await onCreate(
                cleanTitle, cleanSlug.isEmpty ? nil : cleanSlug, descriptor, cleanURLs)
            await MainActor.run {
                isCreating = false
                switch result {
                case .created:
                    dismiss()
                case .siteNotFound:
                    errorMessage = "This site is no longer available."
                case .failed(let reason):
                    errorMessage = reason
                }
            }
        }
    }
}

struct NewPostSheet: View {
    let onCreate: (String) async -> ContentCreateResult

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Post") {
                    TextField("Title", text: $title)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 380, minHeight: 160)
            .navigationTitle("New Post")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isCreating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "Creating…" : "Create") {
                        create()
                    }
                    .disabled(isCreating || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func create() {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        isCreating = true
        errorMessage = nil
        Task {
            let result = await onCreate(cleanTitle)
            await MainActor.run {
                isCreating = false
                switch result {
                case .created:
                    dismiss()
                case .siteNotFound:
                    errorMessage = "This site is no longer available."
                case .failed(let reason):
                    errorMessage = reason
                }
            }
        }
    }
}

/// Name prompt for "Extract into Component…" (design §6.3). Mirrors `NewComponentSheet`'s
/// Form/toolbar shape, but prompts for a bare component name passed straight through as the op's
/// `newName` (the plugin derives the full `src/components/<Name>.astro` path itself). Validates
/// client-side that the name starts with an uppercase letter — a UX guard, not a substitute for
/// the plugin's own `invalid-input`/`already-exists` refusals, which surface via `errorMessage`.
struct ExtractComponentSheet: View {
    /// Called with the client-side-validated name. Returns an error message to show in-sheet, or
    /// `nil` on success (which dismisses).
    let onExtract: (_ name: String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isExtracting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("New Component") {
                    TextField("Name", text: $name, prompt: Text("Hero"))
                }
                if !trimmedName.isEmpty && !nameIsValid {
                    Text("Component names must start with an uppercase letter.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 380, minHeight: 180)
            .navigationTitle("Extract into Component")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isExtracting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isExtracting ? "Extracting…" : "Extract") {
                        extract()
                    }
                    .disabled(isExtracting || !nameIsValid)
                }
            }
        }
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Non-empty and starts with an uppercase letter — mirrors the plugin's PascalCase-identifier
    /// requirement for `newName`.
    private var nameIsValid: Bool {
        trimmedName.first?.isUppercase == true
    }

    private func extract() {
        isExtracting = true
        errorMessage = nil
        Task {
            let error = await onExtract(trimmedName)
            await MainActor.run {
                isExtracting = false
                if let error {
                    errorMessage = error
                } else {
                    dismiss()
                }
            }
        }
    }
}

struct NewComponentSheet: View {
    let onCreate: (String) async -> ContentCreateResult

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Component") {
                    TextField("Name", text: $name, prompt: Text("MyComponent"))
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            .frame(minWidth: 380, minHeight: 160)
            .navigationTitle("New Component")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isCreating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "Creating…" : "Create") {
                        create()
                    }
                    .disabled(isCreating || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func create() {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        isCreating = true
        errorMessage = nil
        Task {
            let result = await onCreate(cleanName)
            await MainActor.run {
                isCreating = false
                switch result {
                case .created:
                    dismiss()
                case .siteNotFound:
                    errorMessage = "This site is no longer available."
                case .failed(let reason):
                    errorMessage = reason
                }
            }
        }
    }
}
