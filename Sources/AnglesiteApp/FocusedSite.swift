import SwiftUI
import AppKit
import AnglesiteCore
import AnglesiteIntents

private struct FocusedSiteIDKey: FocusedValueKey { typealias Value = String }
private struct FocusedNewContentActionsKey: FocusedValueKey { typealias Value = NewContentActions }
private struct FocusedNavigatorSelectionActionsKey: FocusedValueKey { typealias Value = NavigatorSelectionActions }
private struct FocusedSiteSearchActionsKey: FocusedValueKey { typealias Value = SiteSearchActions }

struct NewContentActions {
    let newPage: @MainActor () -> Void
    let newCollection: @MainActor () -> Void
    let newPost: @MainActor () -> Void
    let newComponent: @MainActor () -> Void
}

/// Delete/Duplicate/Publish/Unpublish acting on the Navigator's current selection (#516, #798).
/// Each action is `nil` when there is no selection, or the selection doesn't support that verb
/// (`SiteNavigatorModel.canDelete`/`canDuplicate`/`canPublish`/`canUnpublish`) — that's what lets
/// the Edit-menu items enable/disable correctly without the menu needing to know Navigator internals.
struct NavigatorSelectionActions {
    let delete: (@MainActor () -> Void)?
    let duplicate: (@MainActor () -> Void)?
    let publish: (@MainActor () -> Void)?
    let unpublish: (@MainActor () -> Void)?
}

/// Edit ▸ Find ▸ Search Site… acting on the focused window's toolbar search field (#520).
/// The menu item can't reach `.searchFocused` itself — focus state is scene-local — so the
/// window publishes the closure that flips it.
struct SiteSearchActions {
    let focusSearchField: @MainActor () -> Void
}

extension FocusedValues {
    var siteSearchActions: SiteSearchActions? {
        get { self[FocusedSiteSearchActionsKey.self] }
        set { self[FocusedSiteSearchActionsKey.self] = newValue }
    }

    var siteID: String? {
        get { self[FocusedSiteIDKey.self] }
        set { self[FocusedSiteIDKey.self] = newValue }
    }

    var newContentActions: NewContentActions? {
        get { self[FocusedNewContentActionsKey.self] }
        set { self[FocusedNewContentActionsKey.self] = newValue }
    }

    var navigatorSelectionActions: NavigatorSelectionActions? {
        get { self[FocusedNavigatorSelectionActionsKey.self] }
        set { self[FocusedNavigatorSelectionActionsKey.self] = newValue }
    }
}

/// Must be `Commands` (not `App`) so the focused scene values can flow into the menu state.
struct NewContentCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Site…") {
                openWindow(id: "sites")
                WindowRouter.shared.requestNewSite()
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])

            Button("Open Site…") {
                Task { await openSiteFromMenu() }
            }
            .keyboardShortcut("o")
        }
    }

    @MainActor
    private func openSiteFromMenu() async {
        do {
            guard let site = try await SiteActions.pickAndRegisterSite() else { return }
            openWindow(value: site.id)
        } catch {
            let alert = NSAlert()
            alert.messageText = String(localized: "Couldn't open that site")
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .warning
            alert.runModal()
        }
    }
}

/// Edit ▸ Delete (⌘⌫) / Duplicate (⌘D) / Publish / Unpublish for the focused window's Navigator
/// selection (#516, #798). Placed in the Edit menu next to Cut/Copy/Paste — the macOS convention
/// for selection-scoped destructive/duplicate actions — rather than the File menu.
struct NavigatorEditCommands: Commands {
    @FocusedValue(\.navigatorSelectionActions) private var actions

    var body: some Commands {
        CommandGroup(after: .pasteboard) {
            Button("Delete") {
                actions?.delete?()
            }
            .keyboardShortcut(.delete, modifiers: [.command])
            .disabled(actions?.delete == nil)

            Button("Duplicate") {
                actions?.duplicate?()
            }
            .keyboardShortcut("d", modifiers: [.command])
            .disabled(actions?.duplicate == nil)

            Divider()

            Button("Publish") {
                actions?.publish?()
            }
            .disabled(actions?.publish == nil)

            Button("Unpublish") {
                actions?.unpublish?()
            }
            .disabled(actions?.unpublish == nil)
        }
    }
}

/// Must be `Commands` (not `App`) — `@FocusedValue` only tracks scene focus inside a `View`/`Commands` node.
struct ExportSiteCommands: Commands {
    @FocusedValue(\.siteID) private var focusedSiteID

    var body: some Commands {
        // Export lives after the standard Save items. Enabled only when a site window is focused.
        CommandGroup(after: .importExport) {
            Menu("Export To") {
                Button("Astro Website…") {
                    // Capture now — focus may shift between press and Task execution.
                    guard let id = focusedSiteID else { return }
                    Task { @MainActor in
                        if let site = await SiteStore.shared.find(id: id) {
                            SiteActions.exportSource(of: site)
                        }
                    }
                }
                .disabled(focusedSiteID == nil)

                // Runs the build in the site runtime and saves dist/ (spec §2.2).
                PlannedItem("Built HTML…")
            }

            // Git-repo size reduction — unused binary blobs (spec §4.3).
            PlannedItem("Reduce File Size…")

            Menu("Advanced") {
                Menu("Change File Type") {
                    // Keynote semantics; single-file is an at-rest state (spec §4.2).
                    PlannedItem("Single File")
                    PlannedItem("Package")
                }

                PlannedItem("Language & Region…")
            }

            Divider()

            // iWork-style package encryption; at-rest state (spec §4.2).
            PlannedItem("Set Password…")
        }
    }
}
