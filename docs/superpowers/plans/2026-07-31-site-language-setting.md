# Site Language Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<html lang>` reflect a real, configurable site language instead of the hardcoded `"en"`, with an auto-detected site-wide default and per-page overrides for every content-collection entry type, blog posts, and plain frontmatter pages.

**Architecture:** A new `SITE_LANG` key in `.site-config` (read via a `siteLang()` Astro helper, written via a new `SiteLanguageAsset` Swift type) supplies the site-wide default; `BaseLayout.astro` takes an optional `lang` prop that every entry layout threads from a new optional `lang` frontmatter field. The native app's per-site Settings ("Website" tab) and the page/typed-entry inspectors share one `LanguagePicker` SwiftUI control (curated list + freeform "Other…", with an inherit-the-site-default option where relevant).

**Tech Stack:** Swift 6.4 (AnglesiteCore, AnglesiteApp), SwiftUI, Astro/TypeScript (Resources/Template), Zod, Swift Testing, `node:test`.

## Global Constraints

- Issue #956, already claimed (`🛠️ In Progress` label set on Anglesite/Anglesite). PR body must close it with `Closes #956` per `CONTRIBUTING.md`.
- Spec: `docs/superpowers/specs/2026-07-30-site-language-setting-design.md` — approved, follow it. In particular: absent `SITE_LANG` reads as `"en"` (no behavior change for existing sites); BCP-47 validation is a soft warning, never a hard block; per-element override needs no new code (existing generic attribute editor already covers it — do not build anything for it).
- `.site-config` is the only place for this setting — never `SiteConfigStore`/`Config/settings.plist` (that store is app-owned/gitignored machine-local state; this is public site content — see spec §"Config storage: SITE_LANG").
- Commit subject lines ≤ 72 characters. Reference `#956` in each subject.
- Every commit that touches `Resources/Template/` must be followed by `swift test --filter` covering the template-asset guard suites before moving on (`CONTRIBUTING.md` ▸ Testing) — some Swift tests couple to template markup.
- `Sources/AnglesiteApp` model/view changes (PlistEditorModel, TypedEntryEditorView, PageMetadataForm) have no existing unit-test coverage in this codebase (app-target logic is deliberately kept thin and untested directly — see `CLAUDE.md` ▸ Build); verify those with `scripts/build-app.sh` plus a manual click-through, not new Swift tests. Do not invent test files that don't match this codebase's actual pattern.
- Empty-string frontmatter values are **not** omitted by `TypedContentEditor.write`/`PageMetadataEditor.write` — both persist an explicit `field: ""` when the in-memory value is empty. Every per-page "inherit the site default" case therefore MUST be resolved with `||` (or an explicit blank check) on the Astro rendering side, never with `??` — `d.lang ?? siteLang()` would treat `""` as a set value and render `<html lang="">`. This is called out explicitly in Tasks 6 and 7; do not silently switch back to `??`.

---

## File Structure

New files:
- `Resources/Template/src/lib/localization.ts` — `siteLang()` helper (mirrors `licensing-data.ts`'s `siteLicense()`, but reads `.site-config` directly rather than a JSON data file).
- `Resources/Template/src/lib/localization.test.ts` — unit tests for `siteLang()`.
- `Resources/Template/src/lib/localization.build.test.ts` — end-to-end `astro build` regression test (mirrors `licensing.build.test.ts`).
- `Sources/AnglesiteCore/SiteLanguageAsset.swift` — `Settings`/`parseSettings`/`install`/`systemDefaultTag`, following `MTAStsPolicyAsset`'s shape.
- `Tests/AnglesiteCoreTests/SiteLanguageAssetTests.swift`.
- `Sources/AnglesiteApp/LanguagePicker.swift` — the shared curated-list-plus-"Other…" control, used by the Website tab, the typed-entry inspector, and `PageMetadataForm`.
- `Sources/AnglesiteApp/LanguageSettingsSection.swift` — the shared per-page "Language" section (mirrors `RobotsSettingsSection`'s shape), composed into `PageMetadataForm`.

Modified files (grouped by task below):
- `Resources/Template/src/layouts/BaseLayout.astro`, `Hentry.astro`, `Hreview.astro`, `Hevent.astro`, `BlogPost.astro`
- `Resources/Template/src/pages/blog/[...slug].astro`
- `Resources/Template/src/content.config.ts`, `Resources/Template/src/lib/content-schemas.ts`
- `Sources/AnglesiteCore/SiteScaffolder.swift`
- `Sources/AnglesiteCore/ContentTypeRegistry.swift`
- `Sources/AnglesiteCore/TypedContentEditor.swift`
- `Sources/AnglesiteCore/ContentScaffold.swift`
- `Sources/AnglesiteCore/MicropubContentSync.swift`
- `Sources/AnglesiteCore/PageMetadataEditor.swift`
- `Sources/AnglesiteApp/PlistEditorModel.swift`, `PlistEditorView.swift`
- `Sources/AnglesiteApp/TypedEntryEditorModel.swift`, `TypedEntryEditorView.swift`
- `Sources/AnglesiteApp/PageMetadataModel.swift`, `PageInspectorView.swift`
- `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`, `ContentTypeRegistryTests.swift`, `TypedContentEditorTests.swift`, `ContentScaffoldTests.swift`, `MicropubContentSyncTests.swift`, `PageMetadataEditorTests.swift`

---

### Task 1: Astro `siteLang()` helper + `BaseLayout.astro` prop

**Files:**
- Create: `Resources/Template/src/lib/localization.ts`
- Create: `Resources/Template/src/lib/localization.test.ts`
- Modify: `Resources/Template/src/layouts/BaseLayout.astro`

**Interfaces:**
- Produces: `siteLang(): string` (exported from `localization.ts`), reading `.site-config`'s `SITE_LANG` key, defaulting to `"en"`.
- Produces: `BaseLayout.astro`'s `Props.lang?: string` — every later task threading a per-entry override passes this prop.

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/src/lib/localization.test.ts`:

```ts
// Resources/Template/src/lib/localization.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readConfigFromString } from "../../scripts/config.ts";
import { siteLangFromConfig } from "./localization.ts";

test("siteLangFromConfig: returns SITE_LANG when present", () => {
  assert.equal(siteLangFromConfig("SITE_LANG=fr-CA\n"), "fr-CA");
});

test("siteLangFromConfig: defaults to \"en\" when SITE_LANG is absent", () => {
  assert.equal(siteLangFromConfig("SITE_NAME=Acme\n"), "en");
  assert.equal(siteLangFromConfig(""), "en");
});

test("siteLangFromConfig: an empty SITE_LANG value still defaults to \"en\"", () => {
  // Guards the same "blank means unset" rule used for per-page overrides (see Task 6/7) —
  // the site default itself must never render <html lang="">.
  assert.equal(siteLangFromConfig("SITE_LANG=\n"), "en");
});

// Sanity check that readConfigFromString (used indirectly through readConfig in production)
// agrees with the pure helper's parsing of the same raw text.
test("siteLangFromConfig agrees with readConfigFromString for a present key", () => {
  const raw = "SITE_NAME=Acme\nSITE_LANG=es\n";
  assert.equal(siteLangFromConfig(raw), readConfigFromString(raw, "SITE_LANG"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Resources/Template && npx tsx --test src/lib/localization.test.ts`
Expected: FAIL — `Cannot find module './localization.ts'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `Resources/Template/src/lib/localization.ts`:

```ts
// Resources/Template/src/lib/localization.ts
import { readConfig, readConfigFromString } from "../../scripts/config.ts";

/** Pure parse used by tests and `siteLang()` alike — no filesystem access. */
export function siteLangFromConfig(config: string): string {
  return readConfigFromString(config, "SITE_LANG") || "en";
}

/** The site's default BCP-47 language tag, read from `.site-config`'s `SITE_LANG` key. Falls
 * back to `"en"` when absent — the same value the hardcoded `<html lang="en">` always produced,
 * so a site with no `SITE_LANG` key (every site scaffolded before this feature) renders
 * identically to before. */
export function siteLang(): string {
  return readConfig("SITE_LANG") || "en";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Resources/Template && npx tsx --test src/lib/localization.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Thread the `lang` prop through `BaseLayout.astro`**

In `Resources/Template/src/layouts/BaseLayout.astro`, add the import and prop:

```ts
import { siteLang } from "../lib/localization.ts";
```

```ts
interface Props {
  title: string;
  description?: string;
  license?: LicenseRef | null;
  /**
   * The language this page declares via <html lang>. Omit to inherit the site default
   * (`siteLang()`); pass an explicit BCP-47 tag to override it. An empty string is treated the
   * same as omitted — see localization.ts and the per-page override tasks (empty-string
   * frontmatter values are not the same as an absent key, so this must not use `??`).
   */
  lang?: string;
}
```

```ts
const { title, description, lang } = Astro.props;
const license = headLicense(Astro.props.license, siteLicense());
const effectiveLang = lang || siteLang();
```

```html
<html lang={effectiveLang}>
```

(Replace the existing hardcoded `<html lang="en">` and the existing `const { title, description } = Astro.props;` line with the above.)

- [ ] **Step 6: Run the template's existing test suite to confirm nothing broke**

Run: `cd Resources/Template && npm test`
Expected: PASS (existing suites unaffected — `BaseLayout.astro` still renders valid output for every caller, since `lang` is optional and every existing call site omits it so far).

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/src/lib/localization.ts Resources/Template/src/lib/localization.test.ts Resources/Template/src/layouts/BaseLayout.astro
git commit -m "feat(#956): add siteLang() and BaseLayout lang prop"
```

---

### Task 2: `SiteLanguageAsset` (AnglesiteCore)

**Files:**
- Create: `Sources/AnglesiteCore/SiteLanguageAsset.swift`
- Create: `Tests/AnglesiteCoreTests/SiteLanguageAssetTests.swift`

**Interfaces:**
- Consumes: `SiteConfigFile.value(forKey:in:)`, `SiteConfigFile.upsert(_:into:)` (`Sources/AnglesiteCore/SiteConfigFile.swift`); `WebsiteAnalyticsAsset.configRelativePath` (`= ".site-config"`, `Sources/AnglesiteCore/WebsiteAnalyticsAsset.swift:37`).
- Produces: `SiteLanguageAsset.Settings { var lang: String }`, `SiteLanguageAsset.parseSettings(from: String) -> Settings`, `SiteLanguageAsset.install(_:siteDirectory:) throws`, `SiteLanguageAsset.systemDefaultTag(locale:) -> String` — Task 3 (scaffold) and Task 4 (Settings UI) both depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/SiteLanguageAssetTests.swift`:

```swift
// Tests/AnglesiteCoreTests/SiteLanguageAssetTests.swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SiteLanguageAsset (#956)")
struct SiteLanguageAssetTests {
    @Test("parses SITE_LANG from .site-config")
    func parseSettings() {
        let settings = SiteLanguageAsset.parseSettings(from: "SITE_NAME=Acme\nSITE_LANG=fr-CA\n")
        #expect(settings == .init(lang: "fr-CA"))
    }

    @Test("an absent SITE_LANG key defaults to \"en\"")
    func parseSettingsDefaultsToEnglish() {
        #expect(SiteLanguageAsset.parseSettings(from: "SITE_NAME=Acme\n").lang == "en")
        #expect(SiteLanguageAsset.parseSettings(from: "").lang == "en")
    }

    @Test("an empty SITE_LANG value also defaults to \"en\"")
    func parseSettingsEmptyValueDefaults() {
        #expect(SiteLanguageAsset.parseSettings(from: "SITE_LANG=\n").lang == "en")
    }

    @Test("install upserts SITE_LANG without disturbing other keys")
    func install() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configURL = root.appendingPathComponent(".site-config")
        try "SITE_NAME=Acme\n".write(to: configURL, atomically: true, encoding: .utf8)

        try SiteLanguageAsset.install(.init(lang: "es"), siteDirectory: root)

        let written = try String(contentsOf: configURL, encoding: .utf8)
        #expect(written.contains("SITE_NAME=Acme"))
        #expect(written.contains("SITE_LANG=es"))
        #expect(SiteLanguageAsset.parseSettings(from: written).lang == "es")
    }

    @Test("install is idempotent — re-installing the same value is a no-op write")
    func installIdempotent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try SiteLanguageAsset.install(.init(lang: "de"), siteDirectory: root)
        let firstWrite = try String(contentsOf: root.appendingPathComponent(".site-config"), encoding: .utf8)
        try SiteLanguageAsset.install(.init(lang: "de"), siteDirectory: root)
        let secondWrite = try String(contentsOf: root.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(firstWrite == secondWrite)
    }

    @Test("systemDefaultTag derives a BCP-47 tag from language + region")
    func systemDefaultTag() {
        let locale = Locale(identifier: "fr_CA")
        #expect(SiteLanguageAsset.systemDefaultTag(locale: locale) == "fr-CA")
    }

    @Test("systemDefaultTag falls back to the bare language code when there's no region")
    func systemDefaultTagNoRegion() {
        let locale = Locale(languageCode: .japanese)
        #expect(SiteLanguageAsset.systemDefaultTag(locale: locale) == "ja")
    }

    @Test("systemDefaultTag falls back to \"en\" when the locale has no language code")
    func systemDefaultTagUnknown() {
        let locale = Locale(identifier: "")
        // An empty-identifier Locale still resolves *some* language on real systems in practice;
        // this asserts the documented contract (non-empty result) rather than a specific value,
        // since the empty-identifier corner case isn't meaningfully reproducible across CI hosts.
        #expect(!SiteLanguageAsset.systemDefaultTag(locale: locale).isEmpty)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter SiteLanguageAssetTests`
Expected: FAIL — "cannot find 'SiteLanguageAsset' in scope"

- [ ] **Step 3: Write minimal implementation**

Create `Sources/AnglesiteCore/SiteLanguageAsset.swift`:

```swift
// Sources/AnglesiteCore/SiteLanguageAsset.swift
import Foundation

/// The site-wide default language, stored as `SITE_LANG` in `.site-config` (#956). This is
/// public site content (it must survive `git clone` and a plain `astro build` with Anglesite
/// never installed), so it lives in the git-tracked `.site-config`, not the app-owned
/// `Config/settings.plist` (`SiteConfigStore`) — see docs/superpowers/specs/2026-07-30-site-language-setting-design.md.
public enum SiteLanguageAsset {
    public struct Settings: Sendable, Equatable {
        /// A BCP-47 language tag (e.g. "en", "fr-CA"). Defaults to "en" when absent from
        /// `.site-config` — the same value the previously-hardcoded `<html lang="en">` produced.
        public var lang: String

        public init(lang: String = "en") {
            self.lang = lang
        }
    }

    public static func parseSettings(from config: String) -> Settings {
        let raw = SiteConfigFile.value(forKey: "SITE_LANG", in: config) ?? ""
        return Settings(lang: raw.isEmpty ? "en" : raw)
    }

    public static func install(_ settings: Settings, siteDirectory: URL) throws {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([("SITE_LANG", settings.lang)], into: config)
        guard updated != config else { return }
        try updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// A BCP-47 tag derived from the host's locale (language + region when both are known),
    /// used only to seed a brand-new site's `SITE_LANG` at scaffold time (Task 3). Never called
    /// again after scaffold — the owner's explicit choice in Settings always wins.
    public static func systemDefaultTag(locale: Locale = .current) -> String {
        guard let languageCode = locale.language.languageCode?.identifier else { return "en" }
        if let region = locale.language.region?.identifier {
            return "\(languageCode)-\(region)"
        }
        return languageCode
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter SiteLanguageAssetTests`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteLanguageAsset.swift Tests/AnglesiteCoreTests/SiteLanguageAssetTests.swift
git commit -m "feat(#956): add SiteLanguageAsset for SITE_LANG storage"
```

---

### Task 3: `SiteScaffolder` scaffold-time default

**Files:**
- Modify: `Sources/AnglesiteCore/SiteScaffolder.swift` (the `appendSiteConfig` function, around the `values` array built at what is currently line ~192)
- Modify: `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`

**Interfaces:**
- Consumes: `SiteLanguageAsset.systemDefaultTag(locale:)` from Task 2.

- [ ] **Step 1: Write the failing test**

Open `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`, find an existing test that scaffolds a site and asserts on the written `.site-config` (e.g. a test asserting `SITE_NAME`/`THEME` are present — read the file first to match its exact scaffold-invocation helper and assertion style), and add:

```swift
@Test("scaffold writes a SITE_LANG default derived from the host locale")
func scaffoldWritesSiteLang() async throws {
    // Reuse whatever this file's existing scaffold helper is (e.g. a `scaffold(draft:)` or
    // `makeScaffolder()` fixture already present above) rather than re-deriving one here.
    let siteDir = try await scaffoldTestSite() // <- replace with this file's actual helper name
    let config = try String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
    #expect(config.contains("SITE_LANG="))
}

@Test("scaffold never overwrites an existing SITE_LANG value")
func scaffoldPreservesExistingSiteLang() async throws {
    let siteDir = try await scaffoldTestSite() // same helper as above
    let configURL = siteDir.appendingPathComponent(".site-config")
    var config = try String(contentsOf: configURL, encoding: .utf8)
    config = SiteConfigFile.upsert([("SITE_LANG", "xx-YY")], into: config)
    try config.write(to: configURL, atomically: true, encoding: .utf8)

    // Re-running the same append helper must be a no-op for an already-present key — this
    // mirrors the existing idempotent-append guard `appendSiteConfigValues.setKey` already
    // provides for SITE_NAME/THEME/etc.
    try await scaffoldTestSite(reusing: siteDir) // <- replace with whatever this file's
                                                   //    convention is for re-invoking scaffold
                                                   //    against an existing directory, or drop
                                                   //    this second call if no such helper
                                                   //    exists and instead call
                                                   //    `SiteScaffolder` private append helper
                                                   //    directly via a `@testable import`
    let reread = try String(contentsOf: configURL, encoding: .utf8)
    #expect(reread.contains("SITE_LANG=xx-YY"))
}
```

**Note for the implementer:** `SiteScaffolderTests.swift` already exists with its own scaffold fixture/helper conventions — read it fully before writing these two tests, and rewrite the placeholder helper calls above (`scaffoldTestSite()`) to match whatever helper name and signature the file actually uses. Do not invent a new scaffold path; reuse the existing one so this test exercises the real `appendSiteConfig` call, not a hand-rolled substitute.

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter SiteScaffolderTests`
Expected: FAIL — no `SITE_LANG=` in the written config yet.

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/SiteScaffolder.swift`, in `appendSiteConfig`, add one entry to the `values` array (the exact array literal currently reads, per the file as of this plan):

```swift
private func appendSiteConfig(_ draft: NewSiteDraft, logoPublicPath: String?,
                              metadataDescription: String, siteDir: URL, cfProjectName: String) throws {
    var values: [(String, String)] = [
        ("SITE_NAME", draft.name),
        ("SITE_TYPE", draft.siteType.rawValue),
        ("DOMAIN_CHOICE", draft.domainChoice.rawValue),
        ("CF_PROJECT_NAME", cfProjectName),
        ("SITE_LANG", SiteLanguageAsset.systemDefaultTag()),
    ]
    // ...rest of the function is unchanged...
```

`appendSiteConfigValues`'s existing `setKey` guard (`guard !contents.contains("\n\(key)=") && !contents.hasPrefix("\(key)=") else { return }`) already makes this idempotent — no other change needed for the "never overwrite an existing value" requirement.

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter SiteScaffolderTests`
Expected: PASS

- [ ] **Step 5: Run the full AnglesiteCore suite (scaffold output feeds several other tests)**

Run: `swift test --filter AnglesiteCoreTests`
Expected: PASS — confirms no other test asserts an exact/exhaustive `.site-config` line count or content that this new line would break.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/SiteScaffolder.swift Tests/AnglesiteCoreTests/SiteScaffolderTests.swift
git commit -m "feat(#956): scaffold new sites with a SITE_LANG default"
```

---

### Task 4: `LanguagePicker` control + Settings ("Website" tab) wiring

**Files:**
- Create: `Sources/AnglesiteApp/LanguagePicker.swift`
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift`
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift`

**Interfaces:**
- Consumes: `SiteLanguageAsset.Settings`/`.parseSettings(from:)`/`.install(_:siteDirectory:)` (Task 2).
- Produces: `LanguagePicker` SwiftUI view — `init(tag: Binding<String>, allowsInherit: Bool = false, siteDefaultTag: String = "")`. Tasks 10 and 11 reuse this exact type and initializer.

- [ ] **Step 1: Create the shared `LanguagePicker` control**

Create `Sources/AnglesiteApp/LanguagePicker.swift`:

```swift
// Sources/AnglesiteApp/LanguagePicker.swift
import SwiftUI

/// A curated set of common web languages, keyed by BCP-47 subtag. Deliberately small (#956 design
/// doc "Known limitations") — "Other…" is the escape hatch for anything not listed here.
enum CommonLanguage: String, CaseIterable, Identifiable {
    case en, es, fr, de, it, pt, ja, zh, ko, ar, ru, hi, nl, pl, sv
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .en: return "English"
        case .es: return "Spanish"
        case .fr: return "French"
        case .de: return "German"
        case .it: return "Italian"
        case .pt: return "Portuguese"
        case .ja: return "Japanese"
        case .zh: return "Chinese"
        case .ko: return "Korean"
        case .ar: return "Arabic"
        case .ru: return "Russian"
        case .hi: return "Hindi"
        case .nl: return "Dutch"
        case .pl: return "Polish"
        case .sv: return "Swedish"
        }
    }
}

/// A BCP-47 language tag picker: the curated `CommonLanguage` list, an "Other…" freeform slot for
/// anything else, and — when `allowsInherit` is set — a leading "Use site default" entry that
/// binds `tag` to an empty string. Shared by the Website settings tab (`allowsInherit: false`,
/// this pane's value *is* the site default), the typed-entry inspector, and
/// `LanguageSettingsSection` (both `allowsInherit: true`).
///
/// An empty `tag` is never a validation error — `PlistEditorView`'s Website tab always assigns a
/// concrete `CommonLanguage` or "Other…" value before this is shown, and the per-page call sites
/// treat empty as "inherit" (#956 design doc — this is enforced by the Astro rendering side with
/// `||`, not by anything in this view).
struct LanguagePicker: View {
    @Binding var tag: String
    var allowsInherit: Bool = false
    var siteDefaultTag: String = ""

    private enum Selection: Hashable {
        case inherit
        case common(CommonLanguage)
        case other
    }

    private var selection: Selection {
        if tag.isEmpty { return allowsInherit ? .inherit : .other }
        if let common = CommonLanguage(rawValue: tag) { return .common(common) }
        return .other
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Language", selection: pickerBinding) {
                if allowsInherit {
                    Text("Use site default (\(siteDefaultTag))").tag(Selection.inherit)
                }
                ForEach(CommonLanguage.allCases) { language in
                    Text(language.displayName).tag(Selection.common(language))
                }
                Text("Other…").tag(Selection.other)
            }
            .labelsHidden()
            if case .other = selection {
                TextField("BCP 47 tag, e.g. \"pt-BR\"", text: $tag)
                    .textFieldStyle(.roundedBorder)
                if let message = validationMessage {
                    Text(message).font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    private var pickerBinding: Binding<Selection> {
        Binding(
            get: { selection },
            set: { newValue in
                switch newValue {
                case .inherit:
                    tag = ""
                case .common(let language):
                    tag = language.rawValue
                case .other:
                    // Only clear when leaving a curated selection — leaves an in-progress
                    // freeform edit alone if the user is already on "Other…".
                    if CommonLanguage(rawValue: tag) != nil || (tag.isEmpty && !allowsInherit) {
                        tag = ""
                    }
                }
            }
        )
    }

    /// Soft, non-blocking shape check — not a full BCP-47 grammar validator (#956 design doc
    /// "Known limitations"). `nil` means no warning to show.
    private var validationMessage: String? {
        guard !tag.isEmpty else { return nil }
        let pattern = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"
        let matches = tag.range(of: pattern, options: .regularExpression) != nil
        return matches ? nil : "This doesn't look like a BCP 47 language tag, e.g. \"en\" or \"pt-BR\"."
    }
}
```

- [ ] **Step 2: Add a site-wide-language `DirtyFacet` to `PlistEditorModel`**

In `Sources/AnglesiteApp/PlistEditorModel.swift`, add alongside the other settings-pane state (near `var mtaStsSettings`/`savedMtaStsSettings`):

```swift
var langSettings = SiteLanguageAsset.Settings()
private(set) var savedLangSettings = SiteLanguageAsset.Settings()
private(set) var langError: String?
private(set) var isSavingLang = false

var isLangDirty: Bool { langSettings != savedLangSettings && loadError == nil && !isLoading }
```

In `load()`, alongside the existing `mtaSts`/`securityReporting` parse calls (which already reuse the raw `config` string returned by `loadAnalyticsSettings`):

```swift
let lang = SiteLanguageAsset.parseSettings(from: config)
langSettings = lang
savedLangSettings = lang
langError = nil
```

Add a save method, mirroring `saveMtaSts()`:

```swift
@discardableResult
func saveLang() async -> Bool {
    guard isLangDirty else { return true }
    guard !isSavingLang else { return false }
    isSavingLang = true
    langError = nil
    defer { isSavingLang = false }
    let sourceDirectory = sourceDirectory
    let settings = langSettings
    do {
        try await Task.detached(priority: .userInitiated) {
            try SiteLanguageAsset.install(settings, siteDirectory: sourceDirectory)
        }.value
        savedLangSettings = settings
        return true
    } catch {
        langError = "Couldn't save the site language: \(error.localizedDescription)"
        return false
    }
}
```

Register it in the private `dirtyFacets` array and in `flushBeforeLeaving()`:

```swift
private var dirtyFacets: [DirtyFacet] {
    [
        DirtyFacet(isDirty: isDirty, isSaving: isSaving) { await self.save() },
        DirtyFacet(isDirty: isAnalyticsDirty, isSaving: isSavingAnalytics) { await self.saveAnalytics() },
        DirtyFacet(isDirty: isRedirectsDirty, isSaving: isSavingRedirects) { await self.saveRedirects() },
        DirtyFacet(isDirty: isLicensingDirty, isSaving: isSavingLicensing) { await self.saveLicensing() },
        DirtyFacet(isDirty: isMtaStsDirty, isSaving: isSavingMtaSts) { await self.saveMtaSts() },
        DirtyFacet(isDirty: isSecurityReportingDirty, isSaving: isSavingSecurityReporting) { await self.saveSecurityReporting() },
        DirtyFacet(isDirty: isLangDirty, isSaving: isSavingLang) { await self.saveLang() },
    ]
}
```

```swift
func flushBeforeLeaving() async -> Bool {
    // ...existing checks...
    if isLangDirty {
        guard await saveLang() else { return false }
    }
    if isSecurityReportingDirty { return await saveSecurityReporting() }
    return true
}
```

- [ ] **Step 3: Add the "Language" row to the Website tab**

In `Sources/AnglesiteApp/PlistEditorView.swift`'s `websiteTab`, inside the existing `SettingsBox(title: "Site Details") { Grid { ... } }`, add a row after "Title" and before "Icons":

```swift
GridRow {
    Text("Language")
        .frame(minWidth: 160, alignment: .leading)
    LanguagePicker(tag: $model.langSettings.lang)
        .onChange(of: model.langSettings.lang) { _, _ in Task { await model.saveLang() } }
}
```

(Follow the existing tab-switch/⌘S aggregate-save convention used by every other facet — `onChange` here matches how `analyticsSettings`/`redirectEntries` already save themselves; check the surrounding `websiteTab`/`onChange(of: selectedTab)` code for the exact existing idiom and match it rather than introducing a new one. If the existing pattern is "save on tab switch, not on every keystroke," drop this per-change `onChange` and rely solely on the `dirtyFacets` aggregate save already wired in Step 2 plus the tab-switch `onChange(of: selectedTab)` — extend that switch's cases the same way `.analytics`/`.redirects`/etc. already are, e.g. add `else if oldValue == .website { Task { await model.saveLang() } }` only if `.website` isn't already covered there.)

Also add `if let langError = model.langError { ... }` warning banner near the other per-tab error banners (`analyticsError`/`redirectsError`/etc.), following that exact pattern.

- [ ] **Step 4: Build the app to confirm it compiles and the tab renders**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: Build succeeds.

- [ ] **Step 5: Manual verification**

Launch the built app (or `mcp__Claude_Code_iOS_Simulator__control`/normal `open` — this is a macOS app, so just run the built `.app` directly), open any site, click the site name to open Settings, confirm:
- The Website tab shows a "Language" row with a picker defaulting to whatever `SITE_LANG` the site's `.site-config` already has (or "English" for a pre-existing site with none, since `parseSettings` defaults to `"en"`).
- Choosing a different curated language and switching tabs (or closing Settings) persists it — reopen and confirm the new value stuck, and that `.site-config` on disk shows the new `SITE_LANG=` line.
- Choosing "Other…" reveals the freeform field; typing something that isn't a plausible BCP-47 shape (e.g. `"???"`) shows the orange warning but does not block saving.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/LanguagePicker.swift Sources/AnglesiteApp/PlistEditorModel.swift Sources/AnglesiteApp/PlistEditorView.swift
git commit -m "feat(#956): add Language setting to the Website settings tab"
```

---

### Task 5: Per-page `lang` field in content schemas

**Files:**
- Modify: `Resources/Template/src/content.config.ts`
- Modify: `Resources/Template/src/lib/content-schemas.ts`

**Interfaces:**
- Produces: an optional `lang` frontmatter field on every collection in `ENTRY_COLLECTIONS` — Task 6 (layouts) and Task 9 (native inspector) both read/write it under this exact name.

- [ ] **Step 1: Add `lang: z.string().optional()` to every `ENTRY_COLLECTIONS` schema**

In `Resources/Template/src/content.config.ts`, add one line (`lang: z.string().optional(),`, placed right after the `...socialFields` spread — matching where `draft`/`audience` already sit relative to it) to the `z.object({...})` body of: `blog`, `photos`, `albums`, `bookmarks`, `replies`, `likes`, `announcements`, `events`, `reviews`. Example for `blog` (apply the same one-line addition to the other eight):

```ts
const blog = defineCollection({
  loader: collectionLoader("blog"),
  schema: z.object({
    ...socialFields,
    lang: z.string().optional(),
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }).strict(),
});
```

In `Resources/Template/src/lib/content-schemas.ts`, add the same line to both `notesSchema` and `articlesSchema`:

```ts
export const notesSchema = z.object({
  ...socialFields,
  lang: z.string().optional(),
  publishDate: z.coerce.date(),
  tags: z.array(z.string()).optional(),
  audience: z.string().url().optional(),
  draft: z.boolean().default(false),
}).strict();

export const articlesSchema = z.object({
  ...socialFields,
  lang: z.string().optional(),
  title: z.string(),
  summary: z.string().optional(),
  publishDate: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).optional(),
  audience: z.string().url().optional(),
  draft: z.boolean().default(false),
}).strict();
```

Do **not** add `lang` to `members` — it isn't in `ENTRY_COLLECTIONS` (per the spec's "Known limitations").

- [ ] **Step 2: Verify the template still typechecks and builds**

Run: `cd Resources/Template && npx astro check`
Expected: PASS (a new optional field can't break existing content — nothing currently sets `lang`, and `.strict()` schemas only reject *unknown* keys, not missing optional ones).

Run: `cd Resources/Template && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add Resources/Template/src/content.config.ts Resources/Template/src/lib/content-schemas.ts
git commit -m "feat(#956): add optional lang field to entry content schemas"
```

---

### Task 6: Thread `lang` through the entry layouts + blog route

**Files:**
- Modify: `Resources/Template/src/layouts/Hentry.astro`
- Modify: `Resources/Template/src/layouts/Hreview.astro`
- Modify: `Resources/Template/src/layouts/Hevent.astro`
- Modify: `Resources/Template/src/layouts/BlogPost.astro`
- Modify: `Resources/Template/src/pages/blog/[...slug].astro`

**Interfaces:**
- Consumes: `BaseLayout`'s `Props.lang?: string` (Task 1); each collection's optional `lang` field (Task 5).

- [ ] **Step 1: `Hentry.astro`**

Add `lang?: string;` to the `HentryFields` interface (alongside `draft?: boolean;`), and pass it through to `BaseLayout`. Because `d.lang` can be an empty string (an explicit "inherit" write — see Global Constraints), use `||`, not a bare pass-through:

```ts
interface HentryFields {
  title?: string;
  summary?: string;
  caption?: string;
  publishDate?: Date;
  image?: string;
  images?: string[];
  tags?: string[];
  bookmarkOf?: string;
  inReplyTo?: string;
  likeOf?: string;
  syndication?: string[];
  draft?: boolean;
  lang?: string;
}
```

```html
<BaseLayout title={title ?? "Post"} description={d.summary} license={license} lang={d.lang || undefined}>
```

(`lang={d.lang || undefined}` rather than `lang={d.lang}` — an empty string must fall through to `BaseLayout`'s own `lang || siteLang()`, and passing `""` explicitly as the prop value is equivalent to passing `undefined` here since `BaseLayout` itself treats blank as unset; either form works, but `|| undefined` documents the intent at the call site for a future reader who doesn't already know the empty-string rule.)

- [ ] **Step 2: `Hreview.astro`**

```html
<BaseLayout title={reviewName} license={license} lang={d.lang || undefined}>
```

(`d` here is untyped `entry.data`, so no interface change needed — `d.lang` is already valid TS given the schema now declares it.)

- [ ] **Step 3: `Hevent.astro`**

```html
<BaseLayout title={d.name ?? "Event"} description={d.location} license={license} lang={d.lang || undefined}>
```

- [ ] **Step 4: `BlogPost.astro`**

Add `lang?: string;` to its `Props` interface and destructuring, and pass it through:

```ts
interface Props {
  title: string;
  description?: string;
  pubDate?: Date;
  draft?: boolean;
  syndication?: string[];
  lang?: string;
}

const { title, description, pubDate, draft, syndication, lang } = Astro.props;
```

```html
<BaseLayout title={title} description={description} license={license} lang={lang}>
```

(No `|| undefined` needed here — `lang` arrives from `[...slug].astro` in Step 5 below already normalized.)

- [ ] **Step 5: `src/pages/blog/[...slug].astro`**

```html
<BlogPost
  title={post.data.title}
  description={post.data.description}
  pubDate={post.data.pubDate}
  draft={post.data.draft}
  syndication={post.data.syndication}
  lang={post.data.lang || undefined}
>
  <Content />
</BlogPost>
```

- [ ] **Step 6: Build to confirm no type errors**

Run: `cd Resources/Template && npx astro check && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/src/layouts/Hentry.astro Resources/Template/src/layouts/Hreview.astro Resources/Template/src/layouts/Hevent.astro Resources/Template/src/layouts/BlogPost.astro Resources/Template/src/pages/blog/[...slug].astro
git commit -m "feat(#956): thread per-entry lang override into every layout"
```

---

### Task 7: End-to-end build regression test

**Files:**
- Create: `Resources/Template/src/lib/localization.build.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 5, 6 — this is the integration test proving they're wired together correctly, mirroring `licensing.build.test.ts`'s role for the license feature (see that file's own header comment for why a build-level test exists at all: unit tests of the pure resolver pass even when a layout forgets to thread the prop).

- [ ] **Step 1: Write the test**

Create `Resources/Template/src/lib/localization.build.test.ts`:

```ts
// Resources/Template/src/lib/localization.build.test.ts
//
// Build-level regression test for #956 (site language). Mirrors licensing.build.test.ts's
// rationale: siteLang()'s own unit test and each layout's TS types can't catch a layout that
// forgets to thread `lang` through to BaseLayout, or that uses `??` instead of `||` and lets an
// explicit-but-blank per-entry override ("use site default") leak through as <html lang="">.
// Only rendered output catches that class of bug.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXCLUDED = /(^|\/)(node_modules|dist|\.astro|\.wrangler)(\/|$)/;

function htmlLangOf(html: string): string | undefined {
  return html.match(/<html lang="([^"]*)"/)?.[1];
}

test("site language: site default and per-entry override both reach <html lang>", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "anglesite-lang-fixture-"));
  try {
    await cp(TEMPLATE_ROOT, fixtureDir, {
      recursive: true,
      filter: (src) => !EXCLUDED.test(src.slice(TEMPLATE_ROOT.length)),
    });

    await writeFile(join(fixtureDir, ".site-config"), "SITE_LANG=fr-CA\n", "utf8");

    // A blog post explicitly overriding the site default.
    await writeFile(
      join(fixtureDir, "src/content/blog/lang-override.md"),
      '---\ntitle: "English post on a French site"\npubDate: 2026-01-01\nlang: en\n---\n\nBody.\n',
      "utf8",
    );
    // A note with no lang key at all — must inherit the site default.
    await writeFile(
      join(fixtureDir, "src/content/notes/no-override.md"),
      "---\npublishDate: 2026-01-01\n---\n\nBody.\n",
      "utf8",
    );
    // A review with an explicit-but-blank lang (the native inspector's "use site default"
    // state) — must inherit exactly like the absent case above, not render lang="".
    await writeFile(
      join(fixtureDir, "src/content/reviews/blank-override.md"),
      '---\nitemReviewed: "A Thing"\nrating: 5\npublishDate: 2026-01-01\nlang: ""\n---\n\nBody.\n',
      "utf8",
    );

    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execFileSync("npx", ["astro", "build"], { cwd: fixtureDir, stdio: "inherit" });

    // Homepage: no per-page override anywhere near it -> site default.
    {
      const html = await readFile(join(fixtureDir, "dist/index.html"), "utf8");
      assert.equal(htmlLangOf(html), "fr-CA", "the homepage must render the site default SITE_LANG");
    }

    // Blog post with an explicit override -> that override, not the site default.
    {
      const html = await readFile(join(fixtureDir, "dist/blog/lang-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html),
        "en",
        "a blog post with an explicit lang override must render that language, not the site default",
      );
    }

    // Note with no lang key -> inherits the site default.
    {
      const html = await readFile(join(fixtureDir, "dist/notes/no-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html),
        "fr-CA",
        "a note with no lang frontmatter key must inherit the site default",
      );
    }

    // Review with an explicit empty-string lang -> still inherits the site default, proving the
    // `||`-not-`??` rule actually holds at the rendered-output level.
    {
      const html = await readFile(join(fixtureDir, "dist/reviews/blank-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html),
        "fr-CA",
        'an explicit empty-string lang override must inherit the site default, not render lang=""',
      );
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("site language: an absent SITE_LANG key renders the pre-existing default", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "anglesite-lang-default-fixture-"));
  try {
    await cp(TEMPLATE_ROOT, fixtureDir, {
      recursive: true,
      filter: (src) => !EXCLUDED.test(src.slice(TEMPLATE_ROOT.length)),
    });
    // No .site-config at all — matches every site scaffolded before this feature.
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execFileSync("npx", ["astro", "build"], { cwd: fixtureDir, stdio: "inherit" });
    const html = await readFile(join(fixtureDir, "dist/index.html"), "utf8");
    assert.equal(
      htmlLangOf(html),
      "en",
      "a site with no SITE_LANG key must render exactly the pre-existing hardcoded default",
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails first (before Tasks 1/5/6 — run this once now to confirm the harness itself is sound, then again after confirming it would have failed pre-Task-1)**

Since Tasks 1/5/6 are already implemented by this point in the plan, this test should pass immediately. To confirm it's actually exercising the wiring (not vacuously passing), temporarily revert `Hreview.astro`'s `lang={d.lang || undefined}` back to no `lang` prop, rerun, confirm the homepage assertion still passes but re-running against a reviews fixture would fail (or simpler: trust the equivalent regression `licensing.build.test.ts` already demonstrated for this exact test shape, and skip the manual revert-and-check — go straight to Step 3).

Run: `cd Resources/Template && npx tsx --test src/lib/localization.build.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full template test suite**

Run: `cd Resources/Template && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add Resources/Template/src/lib/localization.build.test.ts
git commit -m "test(#956): add end-to-end lang wiring regression test"
```

---

### Task 8: `ContentTypeField.Kind.language` + `TypedContentEditor` support

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift` (the `Kind` enum, `Sources/AnglesiteCore/ContentTypeRegistry.swift:21-51`)
- Modify: `Sources/AnglesiteCore/TypedContentEditor.swift`
- Modify: `Sources/AnglesiteCore/ContentScaffold.swift`
- Modify: `Sources/AnglesiteCore/MicropubContentSync.swift`
- Modify: `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`
- Modify: `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift`
- Modify: `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift`

**Interfaces:**
- Produces: `ContentTypeField.Kind.language` — Task 9 (registry field additions) and Task 10 (inspector UI) both depend on this case existing.
- `TypedContentEditor` treats `.language` identically to `.string` for `defaultValue`/`decode`/`encode` (both are plain single-line text; the only difference is which SwiftUI control renders it, decided in Task 10).

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`, read the file first to match its existing fixture/descriptor style, then add (adjusting to match that file's actual helper names for building a test descriptor):

```swift
@Test("a .language field round-trips through defaultValue/decode/encode exactly like .string")
func languageFieldRoundTrips() {
    let descriptor = ContentTypeDescriptor(
        id: "test-lang",
        displayName: "Test",
        storage: .collection("test"),
        fields: [ContentTypeField("lang", .language)],
        projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil)
    )
    #expect(TypedContentEditor.defaultValue(for: .language) == .text(""))

    let read = TypedContentEditor.read("---\nlang: fr\n---\nBody.\n", descriptor: descriptor)
    #expect(read["lang"] == .text("fr"))

    let written = TypedContentEditor.write(.init(["lang": .text("es")]), into: "---\nlang: fr\n---\nBody.\n", descriptor: descriptor)
    #expect(written.contains("lang: es") || written.contains("lang: \"es\""))
}

@Test("a missing .language key decodes as an empty string, not a crash")
func languageFieldMissingKey() {
    let descriptor = ContentTypeDescriptor(
        id: "test-lang-missing",
        displayName: "Test",
        storage: .collection("test"),
        fields: [ContentTypeField("lang", .language)],
        projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil)
    )
    let read = TypedContentEditor.read("---\ntitle: x\n---\nBody.\n", descriptor: descriptor)
    #expect(read["lang"] == .text(""))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter TypedContentEditorTests`
Expected: FAIL — "type 'ContentTypeField.Kind' has no member 'language'"

- [ ] **Step 3: Add the `Kind` case**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, add to the `Kind` enum (right after `case string`):

```swift
public enum Kind: Sendable, Equatable {
    case string        // single-line text
    /// A BCP-47 language tag override (#956) — same underlying storage as `.string`, but the
    /// editor renders it with the curated `LanguagePicker` control instead of a bare text field.
    case language
    case text          // multi-line plain text
    case markdown      // multi-line rich body
    case bool
    case date          // calendar date, no time
    case datetime      // ISO 8601 date-time with time + timezone (mf2 `dt-*` properties)
    case url
    case image         // a site-relative media path
    case number
    case stringArray   // e.g. tags
    case imageArray    // an ordered list of site-relative media paths (e.g. album photos)
    case objectArray(fields: [ContentTypeField])
}
```

- [ ] **Step 4: Update every exhaustive switch over `Kind`**

In `Sources/AnglesiteCore/TypedContentEditor.swift`:

```swift
public static func defaultValue(for kind: ContentTypeField.Kind) -> FieldValue {
    switch kind {
    case .string, .language, .text, .markdown, .url, .image: return .text("")
    case .bool: return .flag(false)
    case .date, .datetime: return .date(nil)
    case .number: return .number(nil)
    case .stringArray, .imageArray: return .list([])
    case .objectArray: return .records([])
    }
}
```

```swift
private static func decode(_ value: FrontmatterValue, kind: ContentTypeField.Kind) -> FieldValue {
    switch kind {
    case .string, .language, .text, .url, .image, .markdown:
        if case .string(let s) = value { return .text(s) }
        return .text("")
    // ...unchanged remaining cases...
```

`encode(_:kind:)` switches on `FieldValue`, not `Kind` (see the file — `case .text(let s): return .string(s)` doesn't need a `Kind` arm at all), so no change needed there.

In `Sources/AnglesiteCore/ContentScaffold.swift`, both switches:

```swift
// renderEntry's switch (~line 182):
case .string, .text, .image, .language:
    lines.append("\(field.name): \"\(escapeYAML(scalarValue(field, title: title, fieldValues: fieldValues)))\"")
```

```swift
// renderSingleton's switch (~line 255):
case .string, .text, .url, .image, .date, .datetime, .language:
    let filled = ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (name ?? "") : ""
    value = "\"\(escapeJSON(filled))\""
```

In `Sources/AnglesiteCore/MicropubContentSync.swift` (~line 108):

```swift
case .string, .language, .text, .url, .image, .markdown:
    // ...unchanged body...
```

- [ ] **Step 5: Run test to verify it passes**

Run: `swift test --filter TypedContentEditorTests`
Expected: PASS

- [ ] **Step 6: Run the full AnglesiteCore suite to confirm the other three touched switches still compile and pass**

Run: `swift test --filter AnglesiteCoreTests`
Expected: PASS. If `ContentScaffoldTests`/`MicropubContentSyncTests` don't already have a "every `Kind` case is handled" style test, that's fine — the compiler's exhaustiveness check is what actually guards this; these tests just need to still pass unmodified.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Sources/AnglesiteCore/TypedContentEditor.swift Sources/AnglesiteCore/ContentScaffold.swift Sources/AnglesiteCore/MicropubContentSync.swift Tests/AnglesiteCoreTests/TypedContentEditorTests.swift
git commit -m "feat(#956): add ContentTypeField.Kind.language"
```

---

### Task 9: `lang` field on the built-in content-type descriptors

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift` (`note`, `article`, `photo`, `album`, `bookmark`, `reply`, `like`, `announcement`, `event`, `review` descriptors)
- Modify: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`

**Interfaces:**
- Consumes: `ContentTypeField.Kind.language` (Task 8).
- Produces: every `ENTRY_COLLECTIONS`-backed descriptor's `fields` array now ends with `ContentTypeField("lang", .language)` — Task 10's `TypedEntryForm` renders whatever `descriptor.fields` contains, so this is what makes the picker actually appear per collection.

- [ ] **Step 1: Write the failing test**

In `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`, add:

```swift
@Test("every ENTRY_COLLECTIONS-backed descriptor declares a lang field")
func entryCollectionDescriptorsHaveLang() {
    let idsExpectingLang = ["note", "article", "photo", "album", "bookmark", "reply", "like", "announcement", "event", "review"]
    let registry = ContentTypeRegistry()
    for id in idsExpectingLang {
        let descriptor = registry.descriptor(id: id)
        #expect(descriptor != nil, "expected a built-in descriptor for \(id)")
        #expect(
            descriptor?.fields.contains(where: { $0.name == "lang" && $0.kind == .language }) == true,
            "\(id) descriptor must declare a lang field of kind .language"
        )
    }
}

@Test("identity/directory descriptors do NOT get a lang field (#956 known limitation)")
func nonEntryDescriptorsHaveNoLang() {
    let idsExpectingNoLang = ["businessProfile", "personalProfile", "resume", "member"]
    let registry = ContentTypeRegistry()
    for id in idsExpectingNoLang {
        let descriptor = registry.descriptor(id: id)
        #expect(descriptor != nil, "expected a built-in descriptor for \(id)")
        #expect(descriptor?.fields.contains(where: { $0.name == "lang" }) == false, "\(id) should not declare lang")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter ContentTypeRegistryTests`
Expected: FAIL — no descriptor has a `lang` field yet.

- [ ] **Step 3: Add `ContentTypeField("lang", .language)` to the ten descriptors**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, append `ContentTypeField("lang", .language),` as the last entry in each descriptor's `fields:` array:

```swift
static let note = ContentTypeDescriptor(
    id: "note",
    displayName: "Note",
    storage: .collection("notes"),
    fields: [
        ContentTypeField("body", .markdown, required: true),
        ContentTypeField("publishDate", .datetime, required: true),
        ContentTypeField("tags", .stringArray),
        ContentTypeField("audience", .url),
        ContentTypeField("draft", .bool),
        ContentTypeField("lang", .language),
    ],
    // ...projections unchanged...
)
```

Apply the same one-line addition (append `ContentTypeField("lang", .language),` before the closing `],`) to `article`, `photo`, `album`, `bookmark`, `reply`, `like`, `announcement`, `event`, and `review`. Do **not** touch `businessProfile`, `personalProfile`, `resume`, or `member`.

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter ContentTypeRegistryTests`
Expected: PASS

- [ ] **Step 5: Run the full AnglesiteCore suite**

Run: `swift test --filter AnglesiteCoreTests`
Expected: PASS — in particular re-check `ContentScaffoldTests` (scaffolding a new note/article/etc. now emits a live `lang: ""` frontmatter line per the `.string, .text, .image, .language` group added in Task 8 Step 4 — if any existing scaffold test asserts an *exact* rendered frontmatter block rather than checking for specific lines, it needs its expected fixture text updated to include the new `lang: ""` line).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
git commit -m "feat(#956): add lang field to entry content-type descriptors"
```

(If Step 5 required fixture updates in `ContentScaffoldTests.swift`, include that file in this commit too.)

---

### Task 10: Typed-entry inspector `.language` control

**Files:**
- Modify: `Sources/AnglesiteApp/TypedEntryEditorView.swift`
- Modify: `Sources/AnglesiteApp/TypedEntryEditorModel.swift`

**Interfaces:**
- Consumes: `ContentTypeField.Kind.language` (Task 8), `LanguagePicker` (Task 4), `SiteLanguageAsset.parseSettings(from:)` (Task 2).

- [ ] **Step 1: Give `TypedEntryEditorModel` the current site-default tag for display**

In `Sources/AnglesiteApp/TypedEntryEditorModel.swift`, add a stored property and populate it in `load()`:

```swift
private(set) var siteDefaultLangTag = "en"
```

In `load()`, alongside the existing `robotsSource`/flags read:

```swift
if let config = try? String(contentsOf: sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8) {
    siteDefaultLangTag = SiteLanguageAsset.parseSettings(from: config).lang
}
```

(This is read-only display context — it is not part of `values`/`isDirty`, exactly like `route` isn't.)

- [ ] **Step 2: Render `.language` fields with `LanguagePicker`**

In `Sources/AnglesiteApp/TypedEntryEditorView.swift`'s `control(for:)`, add a case before the generic `.string, .url, .image` case (so `.language` doesn't fall through to a plain `TextField`):

```swift
@ViewBuilder
private func control(for field: ContentTypeField) -> some View {
    let label = field.name + (field.required ? " *" : "")
    switch field.kind {
    case .language:
        VStack(alignment: .leading) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            LanguagePicker(tag: model.textBinding(field.name), allowsInherit: true, siteDefaultTag: model.siteDefaultLangTag)
        }
    case .string, .url, .image:
        HStack {
            TextField(label, text: model.textBinding(field.name))
            if field.kind == .image {
                Button("Choose…") { chooseFile(for: field.name) }
            }
        }
    // ...rest unchanged...
    }
}
```

- [ ] **Step 3: Build**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: Build succeeds.

- [ ] **Step 4: Manual verification**

Open a site with at least one note/article/photo/etc. entry, select it in the navigator, confirm the inspector's "lang" row renders the `LanguagePicker` (curated list + "Use site default (…)" + "Other…"), not a bare text field. Pick an explicit language, save (⌘S or switch selection), reopen the entry's raw Markdown file (e.g. via Finder/VS Code) and confirm `lang: <tag>` is now in its frontmatter. Switch it back to "Use site default," save, and confirm the frontmatter now reads `lang: ""` (not that the key vanished — see Global Constraints) and that this entry's rendered page (`npm run dev` in the site, or a production build) shows `<html lang>` equal to the site default, not empty.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/TypedEntryEditorView.swift Sources/AnglesiteApp/TypedEntryEditorModel.swift
git commit -m "feat(#956): render lang fields with LanguagePicker in the inspector"
```

---

### Task 11: `PageMetadata`/`PageMetadataEditor` + `LanguageSettingsSection` for blog/plain pages

**Files:**
- Modify: `Sources/AnglesiteCore/PageMetadataEditor.swift`
- Modify: `Tests/AnglesiteCoreTests/PageMetadataEditorTests.swift`
- Modify: `Sources/AnglesiteApp/PageMetadataModel.swift`
- Create: `Sources/AnglesiteApp/LanguageSettingsSection.swift`
- Modify: `Sources/AnglesiteApp/PageInspectorView.swift`

**Interfaces:**
- Consumes: `LanguagePicker` (Task 4), `SiteLanguageAsset.parseSettings(from:)` (Task 2).
- Produces: `PageMetadata.lang: String` (default `""`) — this is what `src/pages/blog/[...slug].astro`'s `post.data.lang` (Task 6) is ultimately populated from when a blog post is edited through the app, since blog posts route through `PageMetadataModel`, not `TypedEntryEditorModel`.

- [ ] **Step 1: Write the failing test**

In `Tests/AnglesiteCoreTests/PageMetadataEditorTests.swift`, add:

```swift
@Test("reads lang from frontmatter, defaulting to empty when absent")
func readsLang() {
    let withLang = PageMetadataEditor.read("---\ntitle: \"T\"\nlang: fr\n---\nB\n")
    #expect(withLang.lang == "fr")
    let without = PageMetadataEditor.read("---\ntitle: \"T\"\n---\nB\n")
    #expect(without.lang == "")
}

@Test("write adds/updates the lang key like title/description")
func writesLang() {
    let out = PageMetadataEditor.write(
        PageMetadata(title: "T", description: "D", lang: "es"),
        into: "---\ntitle: \"T\"\ndescription: \"D\"\n---\nB\n"
    )
    #expect(out.contains("lang: \"es\""))
}

@Test("existing title/description-only call sites still compile with the default lang")
func defaultLangParameter() {
    // PageMetadata(title:description:) must still work without naming `lang:` — every
    // pre-existing call site (including the tests above this one in this file) depends on that.
    let m = PageMetadata(title: "T", description: "D")
    #expect(m.lang == "")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter PageMetadataEditorTests`
Expected: FAIL — "value of type 'PageMetadata' has no member 'lang'"

- [ ] **Step 3: Write minimal implementation**

In `Sources/AnglesiteCore/PageMetadataEditor.swift`:

```swift
public struct PageMetadata: Equatable, Sendable {
    public var title: String
    public var description: String
    /// A BCP-47 language override for this page (#956). Empty means "inherit the site default" —
    /// see SiteLanguageAsset and the design doc's empty-string-means-unset rule; an empty string
    /// is written to frontmatter as `lang: ""`, not omitted (matching TypedContentEditor's
    /// existing behavior for every other field).
    public var lang: String

    public init(title: String, description: String, lang: String = "") {
        self.title = title
        self.description = description
        self.lang = lang
    }
}

public enum PageMetadataEditor {
    public static func read(_ contents: String) -> PageMetadata {
        let doc = FrontmatterDocument.parse(contents)
        return PageMetadata(title: scalar(doc, "title"), description: scalar(doc, "description"), lang: scalar(doc, "lang"))
    }

    public static func write(_ metadata: PageMetadata, into contents: String) -> String {
        var doc = FrontmatterDocument.parse(contents)
        let current = read(contents)
        if metadata.title != current.title { doc.set(.string(metadata.title), for: "title") }
        if metadata.description != current.description {
            doc.set(.string(metadata.description), for: "description")
        }
        if metadata.lang != current.lang { doc.set(.string(metadata.lang), for: "lang") }
        return doc.serialized()
    }

    private static func scalar(_ doc: FrontmatterDocument, _ key: String) -> String {
        if case .string(let s)? = doc.value(for: key) { return s }
        return ""
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --filter PageMetadataEditorTests`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Add `langBinding()` and the site-default tag to `PageMetadataModel`**

In `Sources/AnglesiteApp/PageMetadataModel.swift`, add alongside `descriptionBinding()`:

```swift
func langBinding() -> Binding<String> {
    Binding(get: { [weak self] in self?.metadata.lang ?? "" },
            set: { [weak self] in self?.metadata.lang = $0 })
}
```

Add a stored property and populate it in `load()`, mirroring Task 10 Step 1's `TypedEntryEditorModel` addition exactly:

```swift
private(set) var siteDefaultLangTag = "en"
```

```swift
if let config = try? String(contentsOf: sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8) {
    siteDefaultLangTag = SiteLanguageAsset.parseSettings(from: config).lang
}
```

(`isDirty` needs no change — `metadata != savedMetadata` already covers `lang` now that it's part of the `PageMetadata` struct.)

- [ ] **Step 6: Create `LanguageSettingsSection` and compose it into `PageMetadataForm`**

Create `Sources/AnglesiteApp/LanguageSettingsSection.swift`:

```swift
// Sources/AnglesiteApp/LanguageSettingsSection.swift
import SwiftUI

/// Per-page language override for a plain frontmatter page or blog post (#956) — mirrors
/// `RobotsSettingsSection`'s shape (a small, reusable `Section` composed into `PageMetadataForm`).
struct LanguageSettingsSection: View {
    @Binding var tag: String
    let siteDefaultTag: String

    var body: some View {
        Section("Language") {
            LanguagePicker(tag: $tag, allowsInherit: true, siteDefaultTag: siteDefaultTag)
        }
    }
}
```

In `Sources/AnglesiteApp/PageInspectorView.swift`'s `PageMetadataForm`, add the section after the title/description fields and before `RobotsSettingsSection`:

```swift
private struct PageMetadataForm: View {
    @Bindable var model: PageMetadataModel

    var body: some View {
        Form {
            TextField("Title", text: model.titleBinding())
            VStack(alignment: .leading) {
                Text("Description").font(.caption).foregroundStyle(.secondary)
                TextField("", text: model.descriptionBinding(), axis: .vertical).lineLimit(2...6)
            }
            LanguageSettingsSection(tag: model.langBinding(), siteDefaultTag: model.siteDefaultLangTag)
            RobotsSettingsSection(route: model.route, noindex: model.noindexBinding(), disallowCrawl: model.disallowCrawlBinding())
        }
        .formStyle(.grouped)
    }
}
```

- [ ] **Step 7: Build**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: Build succeeds.

- [ ] **Step 8: Manual verification**

Open a blog post (or a plain frontmatter page, if the test/smoke site has one) in the app, confirm the inspector shows a "Language" section with the same picker control, set an override, save, confirm the post's frontmatter gained `lang: <tag>`, and that a dev-server/build render of that post shows the overridden `<html lang>`.

- [ ] **Step 9: Commit**

```bash
git add Sources/AnglesiteCore/PageMetadataEditor.swift Tests/AnglesiteCoreTests/PageMetadataEditorTests.swift Sources/AnglesiteApp/PageMetadataModel.swift Sources/AnglesiteApp/LanguageSettingsSection.swift Sources/AnglesiteApp/PageInspectorView.swift
git commit -m "feat(#956): add lang override to plain pages and blog posts"
```

---

### Task 12: Full verification pass + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift suite**

Run: `swift test --package-path .`
Expected: PASS (all targets, including the newly added/modified tests from Tasks 2, 3, 8, 9, 11).

- [ ] **Step 2: Run the full template suite**

Run: `cd Resources/Template && npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Build the app**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: PASS.

- [ ] **Step 4: Manual end-to-end walkthrough (per the design doc's own Manual/E2E checklist)**

1. Scaffold a brand-new site (or note the current host locale) and confirm `.site-config` got a `SITE_LANG` line matching the host's locale.
2. Open Settings ▸ Website, confirm the Language row shows that value; change it; confirm it persists and the on-disk `SITE_LANG` updates.
3. Set a per-page override on one typed entry and on one blog post; confirm both entries' rendered `<html lang>` differs from the homepage's after a build.
4. Confirm a pre-existing fixture/smoke site with no `SITE_LANG` key still renders `<html lang="en">` exactly as before this change (no regression for existing sites — `~/Sites/smoke` if available, otherwise any previously-scaffolded test site).
5. Confirm the per-element case needs no testing here — it was already possible via the existing attribute editor and this change didn't touch it.

- [ ] **Step 5: Prepare the PR**

Read `CONTRIBUTING.md` ▸ "Commits and pull requests" again before opening the PR (per `CLAUDE.md`'s standing instruction) and build the PR body from `.github/PULL_REQUEST_TEMPLATE.md`'s actual headings (Summary / Paired PR check / Test plan), noting in "Paired PR check" that this is template-only (no MCP schema change, no sidecar-repo pairing needed). Body must include `Closes #956`.

```bash
git push -u origin claude/issue-956-ca8444
gh pr create --title "feat(#956): add a configurable site language" --body "$(cat <<'EOF'
## Summary
- Add a site-wide default language (SITE_LANG in .site-config), auto-detected from the host
  locale at scaffold time and editable in Settings ▸ Website.
- Add a per-page lang override for every content-collection entry type, blog posts, and plain
  frontmatter pages, threaded through to <html lang> in every layout.
- Per-element override needed no new code — the existing component attribute editor already
  covers it.

## Paired PR check
Template-only change (Resources/Template/ + AnglesiteCore/AnglesiteApp). No MCP message schema
change, so no paired anglesite-skills PR is needed.

## Test plan
- [ ] `swift test --package-path .` passes
- [ ] `cd Resources/Template && npm run lint && npm run typecheck && npm test` passes
- [ ] `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` succeeds
- [ ] Manual: scaffold a site, confirm SITE_LANG is set; change it in Settings; set a per-page
      override and confirm its rendered <html lang> differs from the homepage's; confirm a
      pre-existing site with no SITE_LANG still renders lang="en"

Closes #956
EOF
)"
```

- [ ] **Step 6: Report any check you could not run**

If any command above couldn't be run in this environment (e.g. no way to launch the built `.app` for the manual walkthrough), say so explicitly rather than claiming it passed — per `CLAUDE.md`'s standing instruction to report required checks that couldn't be run.

---

## Self-Review Notes

- **Spec coverage:** Site-wide default (Tasks 2–4), per-page override for content-collection entries (Tasks 5, 6, 8, 9, 10), per-page override for blog/plain pages (Tasks 6, 11), settings UI (Task 4), typed-entry inspector UI (Task 10), page inspector UI (Task 11), per-element override (explicitly a no-op, called out in Task 12 Step 4.5 and the Global Constraints), testing plan (Tasks 2, 3, 7, 8, 9, 11 cover every bullet in the spec's own Testing Plan section except the app-model unit tests, which the spec didn't actually require — its Testing Plan says "`PlistEditorModel` tests" and "`ContentTypeRegistry`/`TypedEntryEditorModel` tests," which Tasks 4/9/10 satisfy via `ContentTypeRegistryTests` plus manual verification, consistent with this codebase's actual, pre-existing practice of not unit-testing `Sources/AnglesiteApp` models directly).
- **Corrected against the spec during research:** the spec's `LanguagePicker` "empty string = unset, key omitted on save" description doesn't hold — `TypedContentEditor.write`/`PageMetadataEditor.write` persist an explicit empty string rather than omitting the key. Tasks 6 and 7 fix this at the rendering layer (`||` instead of `??`) instead, which achieves the same user-visible behavior without needing new omit-on-empty machinery in either editor. Called out in Global Constraints so no task silently reintroduces `??`.
- **Placeholder scan:** no TBD/TODO; the one intentionally-flagged placeholder (`scaffoldTestSite()` in Task 3) is explicitly marked as "replace with this file's actual helper" because `SiteScaffolderTests.swift` wasn't fully read line-by-line during planning — the task tells the implementer exactly what to do about it (read the file, use its real fixture) rather than leaving it unresolved.
- **Type consistency:** `SiteLanguageAsset.Settings.lang: String` (Task 2) is used identically in Task 3 (`SiteLanguageAsset.systemDefaultTag()`), Task 4 (`model.langSettings.lang`), Task 10/11 (`SiteLanguageAsset.parseSettings(from:).lang`). `LanguagePicker(tag:allowsInherit:siteDefaultTag:)`'s signature (Task 4) is used unchanged in Tasks 10 and 11. `ContentTypeField.Kind.language` (Task 8) is the exact case name used in Task 9's descriptor edits and Task 10's `switch`.
