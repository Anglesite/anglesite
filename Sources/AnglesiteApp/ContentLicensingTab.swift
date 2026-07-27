import SwiftUI
import AnglesiteCore

/// The Website Settings ▸ Licensing facet (#991). One surface for the whole content licensing
/// policy: the site default license, per-collection overrides, and the AI usage permissions that
/// `robots.txt`'s Content-Signal directive and crawler blocklist are both derived from.
///
/// It absorbed the former Crawlers facet rather than sitting beside it. Two independently-editable
/// controls over the same subject let a site say "you may train on this, if you attribute" and
/// "GPTBot: Disallow: /" at once; deriving both from one policy makes that unrepresentable.
struct ContentLicensingTab: View {
    @Bindable var model: PlistEditorModel

    /// Picking "Custom…" but not yet typing a URL, held as view-local state rather than in
    /// `model.licensingPolicy`. Extracted as a plain value type (not held directly in `@State`
    /// fields) so its logic is unit-testable without a live SwiftUI view hierarchy: `@State`'s
    /// writes are silently dropped when a `View` value is constructed and driven directly (as a
    /// unit test must, absent a hosted render pass) rather than mounted by SwiftUI, so a test that
    /// mutates `@State` across separate statements can't observe its own writes. Testing this
    /// struct's methods directly sidesteps that entirely. `LicensingStore` also treats an
    /// empty-URL default license as "no license" as a second, independent line of defense, in case
    /// any other path ever produces one (#991 review finding 1).
    struct PendingCustomLicense: Equatable {
        /// True once "Custom…" is picked but no URL has been typed yet.
        var isPending = false
        /// The name typed before a URL exists yet to attach it to.
        var pendingName = ""

        /// Reveals the URL/name fields without writing anything into the model — picking
        /// "Custom…" is a navigational act, not an edit worth persisting on its own.
        mutating func select() {
            isPending = true
        }

        /// Clears pending state — used when the picker moves to "All rights reserved" or a
        /// catalog entry instead.
        mutating func clear() {
            self = PendingCustomLicense()
        }

        /// Records name text typed before a URL exists to attach it to.
        mutating func recordName(_ name: String) {
            pendingName = name
        }

        /// Consumes the pending name for a license a typed URL is about to create, and resets —
        /// the first keystroke into the URL field is what actually creates the license.
        mutating func consumeForNewLicense() -> String {
            defer { self = PendingCustomLicense() }
            return pendingName
        }
    }

    @State var customDraft = PendingCustomLicense()

    /// A site default license choice. Tagged by catalog id rather than by `LicenseRef` so a
    /// hand-edited `name` still selects the right row. Internal (not `private`) so tests can drive
    /// the picker binding directly without a live view hierarchy.
    enum LicenseChoice: Hashable {
        case allRightsReserved
        case catalog(String)
        case custom
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            siteDefaultSection
            Divider()
            perCollectionSection
            Divider()
            aiUsageSection
            if model.isSavingLicensing {
                ProgressView().controlSize(.small)
            }
        }
    }

    // MARK: Site default

    private var siteDefaultSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Site License")
                .font(.headline)
            Text("The license offered for your content. Anglesite never picks one for you — until you choose, your site says all rights reserved.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Picker("Site License", selection: defaultChoice) {
                Text("All rights reserved").tag(LicenseChoice.allRightsReserved)
                ForEach(LicenseCatalog.entries) { entry in
                    Text(entry.name).tag(LicenseChoice.catalog(entry.id))
                }
                Text("Custom…").tag(LicenseChoice.custom)
            }
            .labelsHidden()
            .frame(width: 240, alignment: .leading)

            if defaultChoice.wrappedValue == .custom {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                    GridRow {
                        Text("Address").frame(minWidth: 100, alignment: .leading)
                        TextField("https://example.com/license", text: customURL)
                            .frame(minWidth: 280)
                    }
                    GridRow {
                        Text("Name").frame(minWidth: 100, alignment: .leading)
                        TextField("My license", text: customName)
                            .frame(minWidth: 280)
                    }
                }
            }

            if let error = model.licensingError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }
        }
    }

    var defaultChoice: Binding<LicenseChoice> {
        Binding(
            get: {
                guard let ref = model.licensingPolicy.defaultLicense else {
                    return customDraft.isPending ? .custom : .allRightsReserved
                }
                if let entry = LicenseCatalog.entry(for: ref) { return .catalog(entry.id) }
                return .custom
            },
            set: { choice in
                switch choice {
                case .allRightsReserved:
                    customDraft.clear()
                    model.licensingPolicy.defaultLicense = nil
                case .catalog(let id):
                    customDraft.clear()
                    guard let entry = LicenseCatalog.entries.first(where: { $0.id == id }) else { return }
                    model.licensingPolicy.defaultLicense = entry.ref
                    model.licensingPolicy.usage = LicenseCatalog.prefilled(
                        model.licensingPolicy.usage, for: entry.ref)
                case .custom:
                    // Reveal the URL/name fields only; leave the model untouched until a URL is
                    // typed (see `customURL` and `PendingCustomLicense`'s doc comment). A ref that
                    // already exists (a saved custom license, or one already being edited) keeps
                    // showing as `.custom` via the branch above, so there's nothing to do here in
                    // that case.
                    if model.licensingPolicy.defaultLicense == nil {
                        customDraft.select()
                    }
                }
            })
    }

    // Internal (not `private`) so tests can simulate typing into these fields directly.
    var customURL: Binding<String> {
        Binding(
            get: { model.licensingPolicy.defaultLicense?.url ?? "" },
            set: { newValue in
                if model.licensingPolicy.defaultLicense != nil {
                    model.licensingPolicy.defaultLicense?.url = newValue
                } else if !newValue.isEmpty {
                    // The first keystroke is what actually creates the license — see
                    // `PendingCustomLicense`'s doc comment.
                    model.licensingPolicy.defaultLicense = LicenseRef(
                        url: newValue, name: customDraft.consumeForNewLicense())
                }
            })
    }

    var customName: Binding<String> {
        Binding(
            get: { model.licensingPolicy.defaultLicense?.name ?? customDraft.pendingName },
            set: { newValue in
                if model.licensingPolicy.defaultLicense != nil {
                    model.licensingPolicy.defaultLicense?.name = newValue
                } else {
                    // No license exists yet to attach the name to; hold it until `customURL`
                    // creates one.
                    customDraft.recordName(newValue)
                }
            })
    }

    // MARK: Per collection

    private var perCollectionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("By Content Type")
                .font(.headline)
            Text("Override the site license for one kind of content. Bookmarks, replies, likes, and reviews assert nothing by default — those entries are about someone else's work.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                ForEach(LicensableCollection.allCases) { collection in
                    GridRow {
                        Text(displayName(collection))
                            .frame(minWidth: 160, alignment: .leading)
                        Picker(displayName(collection), selection: rule(for: collection)) {
                            Text(collection.assertsNothingByDefault
                                 ? "Asserts nothing by default"
                                 : "Use site license")
                                .tag(CollectionLicenseRule.inherit)
                            Text("Assert nothing").tag(CollectionLicenseRule.assertNothing)
                            ForEach(LicenseCatalog.entries) { entry in
                                Text(entry.name).tag(CollectionLicenseRule.license(entry.ref))
                            }
                            // A hand-written override outside the catalog would otherwise have no
                            // matching tag and render as a blank selection — worse, picking any
                            // row would silently discard it.
                            if case .license(let ref) = model.licensingPolicy.rule(for: collection),
                               LicenseCatalog.entry(for: ref) == nil {
                                Text(ref.name).tag(CollectionLicenseRule.license(ref))
                            }
                        }
                        .labelsHidden()
                        .frame(width: 240, alignment: .leading)
                    }
                }
            }
        }
    }

    private func rule(for collection: LicensableCollection) -> Binding<CollectionLicenseRule> {
        Binding(
            get: { model.licensingPolicy.rule(for: collection) },
            set: { model.licensingPolicy.setRule($0, for: collection) })
    }

    private func displayName(_ collection: LicensableCollection) -> LocalizedStringKey {
        switch collection {
        case .notes: "Notes"
        case .articles: "Articles"
        case .photos: "Photos"
        case .albums: "Albums"
        case .bookmarks: "Bookmarks"
        case .replies: "Replies"
        case .likes: "Likes"
        case .announcements: "Announcements"
        case .events: "Events"
        case .reviews: "Reviews"
        case .blog: "Blog"
        }
    }

    // MARK: AI usage

    private var aiUsageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("AI and Crawlers")
                .font(.headline)
            Text("States a usage preference per purpose in robots.txt, using Cloudflare's Content Signals Policy. It's a signal well-behaved crawlers honor, not an enforced block.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                usageRow(
                    "Search",
                    help: "Show this content in traditional search results.",
                    value: $model.licensingPolicy.usage.search)
                usageRow(
                    "AI Answers",
                    help: "Let AI assistants use this content to answer a live question.",
                    value: $model.licensingPolicy.usage.aiInput)
                usageRow(
                    "AI Training",
                    help: "Let AI systems use this content to train models.",
                    value: $model.licensingPolicy.usage.aiTrain)
            }

            if let warning = LicenseCatalog.coherenceWarning(
                for: model.licensingPolicy.defaultLicense, usage: model.licensingPolicy.usage),
               case .licensePermitsDeniedUse(let licenseName) = warning {
                Label(
                    "\(licenseName) already permits this use. Crawlers reading both your license and these signals will see them disagree.",
                    systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Toggle(
                    "Refuse AI crawlers in robots.txt",
                    isOn: $model.licensingPolicy.usage.blockAICrawlers)
                    .toggleStyle(.switch)
                    .disabled(!model.licensingPolicy.usage.mayBlockAICrawlers)
                Text(model.licensingPolicy.usage.mayBlockAICrawlers
                     ? "Adds robots.txt rules refusing 17 known AI crawlers (GPTBot, ClaudeBot, and others). This reduces your site's visibility to AI assistants and AI-generated search summaries — it does not affect traditional search engines."
                     : "Available once both AI Answers and AI Training are set to Disallow. Refusing a crawler while still permitting what it does would contradict itself.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func usageRow(
        _ title: LocalizedStringKey,
        help: LocalizedStringKey,
        value: Binding<UsagePermission>
    ) -> some View {
        GridRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(help)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(minWidth: 260, alignment: .leading)
            Picker(title, selection: value) {
                Text("Unspecified").tag(UsagePermission.unset)
                Text("Allow").tag(UsagePermission.yes)
                Text("Disallow").tag(UsagePermission.no)
            }
            .labelsHidden()
            .frame(width: 140)
        }
    }
}
