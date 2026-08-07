import SwiftUI
import AppKit

/// The Website menu (menu-bar spec §2.9): the single home for "operate the site". Absorbs the
/// former Site menu (#511) and regroups it Configure → Preview → Publish → Quality → Grow →
/// Source → Run → Provider. Reads the `\.siteWindowModel` focused scene value; every live item
/// disables when no site window is focused, mirroring the toolbar via the shared `canRun…`
/// properties on `SiteWindowModel`.
struct WebsiteCommands: Commands {
    @FocusedValue(\.siteWindowModel) private var model

    var body: some Commands {
        CommandMenu("Website") {
            // Configure — in-app provider-backed views (spec §2.9). No site-settings
            // sheet exists yet, so all three are planned.
            PlannedItem("Website Settings…")
            PlannedItem("Analytics…")
            PlannedItem("Logs…")

            Divider()

            Menu("Preview in") {
                Button("Default Browser") { model?.openPreviewInBrowser() }
                    .disabled(model?.canOpenPreviewInBrowser != true)

                Divider()

                PlannedItem("Safari")
                PlannedItem("Chrome")
                PlannedItem("Firefox")
            }

            Divider()

            // "Publish" is the user-facing verb (Personal Publishing OS, #334); the
            // pre-deploy check still gates it, no override (spec §2.9).
            Button("Publish…") { model?.deploySite() }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(model?.canRunDeploy != true)

            Button("Recheck Readiness") { model?.recheckHealth() }
                .disabled(model?.canRecheckHealth != true)

            Button("Backup") { model?.backupSite() }
                .disabled(model?.canRunBackup != true)

            Divider()

            Button("Audit") { model?.auditSite() }
                .disabled(model?.canRunAudit != true)

            Button("Cleanup…") { model?.presentCleanup() }
                .disabled(model == nil)

            Button("Reader…") { model?.presentReader() }
                .disabled(model == nil)

            Button("Followers…") { model?.presentFollowers() }
                .disabled(model == nil)

            Button("Communities…") { model?.presentCommunities() }
                .disabled(model == nil)

            // Ellipsis items open a sheet for further input, per the HIG.
            Button("Harden…") { model?.harden.openSheet() }
                .disabled(model?.canRunHarden != true)

            Button("Onion Routing…") { model?.onionRouting.openSheet() }
                .disabled(model?.canRunOnionRouting != true)

            Button("Siri AI Readiness…") { model?.openSiriReadiness() }
                .disabled(model?.canOpenSiriReadiness != true)

            Divider()

            Button("Domain…") { model?.domain.openSheet() }
                .disabled(model?.canOpenDomain != true)

            Button("Connect a Domain…") { model?.connectDomain.openSheet() }
                .disabled(model?.site == nil)

            Button("Email Setup…") { model?.presentEmailSetup() }
                .disabled(model?.canOpenEmailSetup != true)

            Button("Add Integration…") { model?.openIntegrationWizard() }
                .disabled(model?.canOpenIntegrationWizard != true)

            Button("Animations…") { model?.presentAnimations() }
                .disabled(model?.canOpenAnimations != true)

            Button("Apply a Theme…") { model?.openThemeApplyWizard() }
                .disabled(model?.canOpenThemeApplyWizard != true)

            Menu("Assistant") {
                Button("Review Copy…") { model?.presentCopyEdit() }
                    .disabled(model?.canOpenCopyEdit != true)

                Button("Social Media Plan…") { model?.presentSocialPlan() }
                    .disabled(model?.canOpenSocialPlan != true)

                Button("Design Interview…") { model?.presentDesignInterview() }
                    .disabled(model?.canOpenDesignInterview != true)

                Button("Experiment Results…") { model?.presentExperimentStats() }
                    .disabled(model?.canOpenExperimentStats != true)
            }

            Menu("GitHub") {
                // Same identity swap as the toolbar: menus rebuild on every open, so a
                // state-dependent item is fine here (unlike the customizable toolbar, #519).
                if let remote = model?.publish.existingRemote {
                    Button("View on GitHub") { NSWorkspace.shared.open(remote.url) }
                } else {
                    Button("Publish to GitHub…") {
                        guard let model, let site = model.site else { return }
                        model.publish.publish(source: site.sourceDirectory, repoName: site.name)
                    }
                    .disabled(model?.canPublishToGitHub != true)
                }
            }

            Divider()

            Menu("Dev Server") {
                // Dev-server lifecycle (#515). Start covers the stopped and failed states;
                // Restart is for a wedged Astro process. Enablement rules are
                // `DevServerControls` in AnglesiteCore.
                Button("Start") { model?.startDevServer() }
                    .disabled(model?.canStartDevServer != true)

                Button("Stop") { model?.stopDevServer() }
                    .disabled(model?.canStopDevServer != true)

                // ⌥⌘R: plain ⌘R stays reserved for preview reload (#514).
                Button("Restart") { model?.restartDevServer() }
                    .keyboardShortcut("r", modifiers: [.command, .option])
                    .disabled(model?.canRestartDevServer != true)
            }

            Divider()

            Menu("Cloudflare") {
                PlannedItem("Dashboard")
                PlannedItem("Config…")
            }
        }
    }
}
