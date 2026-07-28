import Testing
import Foundation
@testable import AnglesiteCore

/// A `final class` (not a `struct`) so `deinit` can drop the throwaway `UserDefaults` suite,
/// mirroring the former `tearDown`.
final class AppSettingsTests {
    private let suiteName: String
    private let defaults: UserDefaults

    init() {
        let suite = "test-anglesite-\(UUID().uuidString)"
        suiteName = suite
        defaults = UserDefaults(suiteName: suite)!
    }

    deinit {
        defaults.removePersistentDomain(forName: suiteName)
    }

    @Test("Sites root falls back to home Sites") func sitesRootFallsBackToHomeSites() {
        let settings = AppSettings(defaults: defaults)
        let expected = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Sites", isDirectory: true)
        #expect(settings.sitesRoot.path == expected.path)
    }

    @Test("Sites root honors override") func sitesRootHonorsOverride() {
        let settings = AppSettings(defaults: defaults)
        let url = URL(fileURLWithPath: "/tmp/anglesite-sites", isDirectory: true)
        settings.sitesRootOverride = url
        #expect(settings.sitesRoot.path == url.path)
    }

    @Test("Debug pane enabled defaults to false") func debugPaneEnabledDefaultsToFalse() {
        let settings = AppSettings(defaults: defaults)
        #expect(!settings.debugPaneEnabled)
    }

    @Test("Debug pane enabled round trip") func debugPaneEnabledRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.debugPaneEnabled = true
        #expect(settings.debugPaneEnabled)
        settings.debugPaneEnabled = false
        #expect(!settings.debugPaneEnabled)
    }

    // MARK: Auto alt-text (C.7 — vision alt-text pipeline)

    @Test("autoGenerateAltText defaults to true (on)") func autoAltTextDefaultsToTrue() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.autoGenerateAltText)
    }

    @Test("autoGenerateAltText round trip") func autoAltTextRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.autoGenerateAltText = false
        #expect(!settings.autoGenerateAltText)
        settings.autoGenerateAltText = true
        #expect(settings.autoGenerateAltText)
    }

    // MARK: Auto page-copy (Slice 2 — FM short-copy for create page/post)

    @Test("autoGeneratePageCopy defaults to true (on)") func autoPageCopyDefaultsToTrue() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.autoGeneratePageCopy)
    }

    @Test("autoGeneratePageCopy round trip") func autoPageCopyRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.autoGeneratePageCopy = false
        #expect(!settings.autoGeneratePageCopy)
        settings.autoGeneratePageCopy = true
        #expect(settings.autoGeneratePageCopy)
    }

    @Test("announcesLiveUpdates defaults to true (on)") func announcesLiveUpdatesDefaultsToTrue() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.announcesLiveUpdates)
    }

    @Test("announcesLiveUpdates round trip") func announcesLiveUpdatesRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.announcesLiveUpdates = false
        #expect(!settings.announcesLiveUpdates)
        settings.announcesLiveUpdates = true
        #expect(settings.announcesLiveUpdates)
    }

    @Test("notifiesOnCompletion defaults to true (on)") func notifiesOnCompletionDefaultsToTrue() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.notifiesOnCompletion)
    }

    @Test("notifiesOnCompletion round trip") func notifiesOnCompletionRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.notifiesOnCompletion = false
        #expect(!settings.notifiesOnCompletion)
        settings.notifiesOnCompletion = true
        #expect(settings.notifiesOnCompletion)
    }

    @Test("playsDialupSoundEffect defaults to false") func playsDialupSoundEffectDefaultsToFalse() {
        let settings = AppSettings(defaults: defaults)
        #expect(!settings.playsDialupSoundEffect)
    }

    @Test("playsDialupSoundEffect round trip") func playsDialupSoundEffectRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.playsDialupSoundEffect = true
        #expect(settings.playsDialupSoundEffect)
        settings.playsDialupSoundEffect = false
        #expect(!settings.playsDialupSoundEffect)
    }

    @Test("legacy chat backend defaults are cleaned once") func legacyChatBackendDefaultsCleanedOnce() {
        defaults.set(false, forKey: "anglesite.preferFoundationModels")
        defaults.set(true, forKey: "anglesite.didMigrateAssistantDefault")
        defaults.set("privateCloudCompute", forKey: "anglesite.foundationModelTier")

        let settings = AppSettings(defaults: defaults)
        settings.removeLegacyChatBackendDefaultsIfNeeded()

        #expect(defaults.object(forKey: "anglesite.preferFoundationModels") == nil)
        #expect(defaults.object(forKey: "anglesite.didMigrateAssistantDefault") == nil)
        #expect(defaults.object(forKey: "anglesite.foundationModelTier") == nil)
        #expect(defaults.bool(forKey: AppSettings.Key.didCleanLegacyChatBackendDefaults))

        defaults.set(false, forKey: "anglesite.preferFoundationModels")
        settings.removeLegacyChatBackendDefaultsIfNeeded()
        #expect(defaults.object(forKey: "anglesite.preferFoundationModels") != nil)
    }

    // MARK: DebugPaneVisibility

    @Test("Debug menu always visible in debug builds") func debugMenuAlwaysVisibleInDebugBuilds() {
        #expect(DebugPaneVisibility.menuItemVisible(isDebugBuild: true, settingEnabled: false, optionHeldAtLaunch: false))
    }

    @Test("Debug menu hidden in release by default") func debugMenuHiddenInReleaseByDefault() {
        #expect(!DebugPaneVisibility.menuItemVisible(isDebugBuild: false, settingEnabled: false, optionHeldAtLaunch: false))
    }

    @Test("Debug menu revealed by setting in release") func debugMenuRevealedBySettingInRelease() {
        #expect(DebugPaneVisibility.menuItemVisible(isDebugBuild: false, settingEnabled: true, optionHeldAtLaunch: false))
    }

    @Test("Debug menu revealed by option key in release") func debugMenuRevealedByOptionKeyInRelease() {
        #expect(DebugPaneVisibility.menuItemVisible(isDebugBuild: false, settingEnabled: false, optionHeldAtLaunch: true))
    }

    // MARK: Cached verified-account identity (Settings "surfaced like Xcode does")

    @Test("GitHub account defaults to nil") func gitHubAccountDefaultsToNil() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.gitHubAccount == nil)
    }

    @Test("GitHub account round trip, including a nil name/avatar") func gitHubAccountRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        let account = GitHubAccount(login: "octocat", name: "The Octocat", avatarURL: URL(string: "https://example.com/a.png"))
        settings.gitHubAccount = account
        #expect(settings.gitHubAccount == account)

        settings.gitHubAccount = GitHubAccount(login: "octocat2", name: nil, avatarURL: nil)
        #expect(settings.gitHubAccount == GitHubAccount(login: "octocat2", name: nil, avatarURL: nil))
    }

    @Test("Clearing the GitHub account removes all its fields") func gitHubAccountClear() {
        let settings = AppSettings(defaults: defaults)
        settings.gitHubAccount = GitHubAccount(login: "octocat", name: "The Octocat", avatarURL: nil)
        settings.gitHubAccount = nil
        #expect(settings.gitHubAccount == nil)
        #expect(defaults.string(forKey: AppSettings.Key.gitHubAccountName) == nil)
    }

    @Test("Cloudflare account defaults to nil") func cloudflareAccountDefaultsToNil() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.cloudflareAccount == nil)
    }

    @Test("Cloudflare account round trip, distinguishing a nameless-but-verified account from unset")
    func cloudflareAccountRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.cloudflareAccount = CloudflareAccount(name: "Acme Corp", email: nil)
        #expect(settings.cloudflareAccount == CloudflareAccount(name: "Acme Corp", email: nil))

        // A verified token whose account lookup returned nothing still counts as "connected" —
        // must not read back the same as "never verified".
        settings.cloudflareAccount = CloudflareAccount(name: nil, email: nil)
        #expect(settings.cloudflareAccount == CloudflareAccount(name: nil, email: nil))
    }

    @Test("Clearing the Cloudflare account removes all its fields") func cloudflareAccountClear() {
        let settings = AppSettings(defaults: defaults)
        settings.cloudflareAccount = CloudflareAccount(name: "Acme Corp", email: "a@example.com")
        settings.cloudflareAccount = nil
        #expect(settings.cloudflareAccount == nil)
        #expect(defaults.string(forKey: AppSettings.Key.cloudflareAccountName) == nil)
    }

    @Test("Active assistant backend defaults to foundationModels") func activeAssistantBackendDefaultsToFoundationModels() {
        let settings = AppSettings(defaults: defaults)
        #expect(settings.activeAssistantBackend == "foundationModels")
    }

    @Test("Active assistant backend round trip") func activeAssistantBackendRoundTrip() {
        let settings = AppSettings(defaults: defaults)
        settings.activeAssistantBackend = "acp:\(UUID().uuidString)"
        #expect(settings.activeAssistantBackend.hasPrefix("acp:"))
    }
}
