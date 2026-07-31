import AppIntents

/// Curated Siri phrases. They appear in Spotlight and Siri suggestions. `\(.applicationName)`
/// resolves to the app's display name ("Anglesite") on both targets.
///
/// The audit→deploy chain is composed in the Shortcuts editor: `AuditSiteIntent` returns a
/// `SiteEntity` value that the user pipes into `DeploySiteIntent`, whose confirmation still
/// gates the deploy. No extra `opensIntent` plumbing is needed for v0.
public struct AnglesiteShortcuts: AppShortcutsProvider {
    /// The curated phrase list, built with `AppShortcutsProvider`'s result builder. Apple caps
    /// this at 10 shortcuts, and the ten below spend the whole budget — which is why the Bucket 3
    /// integration intents get no phrase (see the note at the end of the builder). When adding or
    /// removing an entry, update `phraseExposedIntentNames` in the same commit; a sync-guard test
    /// compares the two counts.
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: DeploySiteIntent(),
            phrases: ["Deploy my site with \(.applicationName)"],
            shortTitle: "Deploy Site",
            systemImageName: "arrow.up.circle"
        )
        AppShortcut(
            intent: BackupSiteIntent(),
            phrases: ["Back up my site with \(.applicationName)"],
            shortTitle: "Back Up Site",
            systemImageName: "externaldrive.badge.timemachine"
        )
        AppShortcut(
            intent: AuditSiteIntent(),
            phrases: ["Check my site with \(.applicationName)"],
            shortTitle: "Check Site",
            systemImageName: "checkmark.seal"
        )
        // Phase A content intents (A.7, #141). Phrases avoid colliding with "Check my site"
        // (AuditSiteIntent) above. Each intent's required parameters (site, query, name, …) are
        // prompted by Siri when not supplied in the phrase, same as deploy/backup/audit.
        AppShortcut(
            intent: SearchContentIntent(),
            phrases: [
                "What's on my site with \(.applicationName)",
                "Search my site with \(.applicationName)",
            ],
            shortTitle: "Search Content",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: SiteStatusIntent(),
            phrases: [
                "How is my site doing with \(.applicationName)",
                "My site status with \(.applicationName)",
            ],
            shortTitle: "Site Status",
            systemImageName: "chart.bar.doc.horizontal"
        )
        AppShortcut(
            intent: AddPageIntent(),
            phrases: [
                "Add a page to my site with \(.applicationName)",
                "Add a page with \(.applicationName)",
            ],
            shortTitle: "Add Page",
            systemImageName: "doc.badge.plus"
        )
        AppShortcut(
            intent: AddPostIntent(),
            phrases: [
                "Add a post to my site with \(.applicationName)",
                "Add a post with \(.applicationName)",
            ],
            shortTitle: "Add Post",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: PreviewSiteIntent(),
            phrases: [
                "Preview my site with \(.applicationName)",
                "Open my site preview with \(.applicationName)",
            ],
            shortTitle: "Preview Site",
            systemImageName: "eye"
        )
        // B.5 (#149). Phrases resolve `element` via the WKWebView's `appEntityUIElementProvider`
        // (#148), so "edit this" naturally maps to whatever the user is looking at. The
        // `instruction` parameter is the user's NL phrase — Siri prompts for it when omitted.
        AppShortcut(
            intent: EditContentIntent(),
            phrases: [
                "Edit this with \(.applicationName)",
                "Change this with \(.applicationName)",
            ],
            shortTitle: "Edit Content",
            systemImageName: "pencil"
        )
        AppShortcut(
            intent: StartDesignInterviewIntent(),
            phrases: [
                "Redesign my site with \(.applicationName)",
                "Design my site with \(.applicationName)",
            ],
            shortTitle: "Design Interview",
            systemImageName: "paintpalette"
        )
        // NOTE: the Bucket 3 integration intents (AddBookingIntent / AddDonationsIntent /
        // AddGiscusIntent) are deliberately NOT registered as `AppShortcut`s. `AppShortcutsProvider`
        // allows at most 10 curated phrases and the ten above already fill the budget. The
        // integration intents remain fully first-class — they keep their `OperationDescriptor`s,
        // are invocable from the Shortcuts app, the FM chat tool (`SetupIntegrationTool`), and the
        // GUI "Add Integration…" wizard. Only the zero-setup Siri phrase is omitted. Reinstate a
        // phrase (and drop a less voice-natural one to stay within 10) if a future iteration wants
        // Siri-first integration setup. See PR discussion.
    }
}

extension AnglesiteShortcuts {
    /// Intent type names that have a curated Siri phrase in `appShortcuts` above. Kept beside the
    /// phrase definitions so adding/removing a phrase naturally updates this — it is the anchor for
    /// operation-descriptor coverage (`OperationDescriptorTests`). Apple's `appShortcuts` is a
    /// type-erased `[AppShortcut]` with no public way to read back the intent type, so this hand
    /// list is required; a sync-guard test asserts its size matches `appShortcuts.count`.
    static let phraseExposedIntentNames: Set<String> = [
        "DeploySiteIntent",
        "BackupSiteIntent",
        "AuditSiteIntent",
        "SearchContentIntent",
        "SiteStatusIntent",
        "AddPageIntent",
        "AddPostIntent",
        "PreviewSiteIntent",
        "EditContentIntent",
        "StartDesignInterviewIntent",
    ]
}
