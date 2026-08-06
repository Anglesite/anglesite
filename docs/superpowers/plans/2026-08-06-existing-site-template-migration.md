# Existing-Site Template Migration (#745) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `TemplateScriptsSync` (#1053) so an existing site's app-owned files never lose an owner's customization silently, backfill `SECURITY_TXT_MODE` (#743) with a legacy-`security.txt` Adopt/Preserve classification, migrate the narrow `.gitignore` rule that decision implies, and commit successful `Source/` changes to the site's git repo — for both the windowed app and the headless App Intents/Shortcuts/Siri path.

**Architecture:** Reuses `TemplateScriptsSyncChecker`/`Applier` unchanged except for one surgical fix (a legacy file with no baseline is now a divergence, never a silent overwrite). Adds a parallel, independently-testable `SecurityTxtMigrationChecker`/`Applier` pair for the mode-backfill/classification/`.gitignore` piece, a small `Config/`-side pending-commit record for resumability, and a commit step built on the existing `InboxSubmissionCommitter.processGitCommitBatch` primitive. The windowed path (`SiteWindowModel`) composes these pieces directly so it can show sheets and await real decisions; a new `ExistingSiteMigration.runNoninteractively` orchestrator gives the headless `SiteOperations` path the same coverage with every decision defaulted to Preserve.

**Tech Stack:** Swift 6.4, Foundation, Swift Testing (`@Suite`/`@Test`/`#expect`). No new dependencies.

**Design doc:** [`docs/superpowers/specs/2026-08-06-existing-site-template-migration-design.md`](../specs/2026-08-06-existing-site-template-migration-design.md) — read this first for the *why* behind every decision below; this plan only covers the *how*.

## Global Constraints

- Swift/SwiftUI with Apple frameworks only — no new dependencies.
- `Config/` files (the new pending-commit record) are app-owned state, never written into `Source/`, never committed to the site's git repo — same rule as `Config/dependency-baseline.json` and `Config/template-scripts-baseline.json`.
- `.site-config` and `.gitignore` writes go through `Source/` and **do** get committed — via `InboxSubmissionCommitter.processGitCommitBatch`, never a new commit primitive.
- User-facing copy must describe consequences to the owner's site, not git/diff/merge terminology (established `CLAUDE.md` principle: "the app advises; it does not delegate the decision").
- Every new public type lives in `AnglesiteCore` (portable, builds on Linux CI) except the two SwiftUI-adjacent presentation models, which live in `AnglesiteApp`.
- Conventional commits, subject ≤72 characters, reference `#745`.
- Keep `swift test --package-path .` and `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` green after every task.
- Task 10 adds new user-visible strings. Per `CONTRIBUTING.md`'s String Catalog step, these need an `xcrun xcstringstool sync` pass scoped to this worktree's own `BUILD_DIR` before the final commit — Task 12 covers this.

---

## Task 1: `SecurityTxtLegacyClassifier`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityTxtLegacyClassifier.swift`
- Create: `Tests/AnglesiteCoreTests/SecurityTxtLegacyClassifierTests.swift`

**Interfaces:**
- Produces: `public enum SecurityTxtLegacyClassifier { public enum Classification: Sendable, Equatable { case matchesLegacyShape; case doesNotMatch }; public static func classify(existingContent: String, rawContact: String?, siteURL: String?) -> Classification }` — Task 5 (`SecurityTxtMigrationChecker`) calls `classify(existingContent:rawContact:siteURL:)` by this exact name.

- [ ] **Step 1: Write `SecurityTxtLegacyClassifier.swift`**

```swift
import Foundation

/// Classifies a legacy `public/.well-known/security.txt` — written before #743 introduced
/// `SECURITY_TXT_MARKER` — as Anglesite's own historical output or hand-authored content
/// (design doc "Detection: security.txt (new: SecurityTxtModeMigration)"). Pure; no filesystem
/// access, no `.site-config` parsing — callers pass the already-read raw values.
public enum SecurityTxtLegacyClassifier {
    /// Whether `existingContent` matches exactly what the pre-#743 generator would have written
    /// from the site's *current* `SECURITY_CONTACT`/`SITE_URL`. `Expires` is inherently
    /// time-variant, so only its line shape is checked, never its value.
    public enum Classification: Sendable, Equatable {
        /// The content matches the old generator's shape exactly — safe to adopt as generated.
        case matchesLegacyShape
        /// The content doesn't match (different contact, extra content, hand-formatting, or no
        /// current contact to reconstruct against) — must be preserved as hand-authored.
        case doesNotMatch
    }

    /// Classifies `existingContent` (the file's current text) against `rawContact` (the site's
    /// current, undecoded `.site-config` `SECURITY_CONTACT` value — read as one whole string,
    /// matching what the pre-#843 generator read before comma-list support existed) and
    /// `siteURL` (the current `.site-config` `SITE_URL`).
    public static func classify(
        existingContent: String,
        rawContact: String?,
        siteURL: String?
    ) -> Classification {
        guard let reconstructed = legacyBody(rawContact: rawContact, siteURL: siteURL) else {
            return .doesNotMatch
        }
        return matches(existingContent, reconstructed) ? .matchesLegacyShape : .doesNotMatch
    }

    /// What the pre-#743 `buildSecurityTxt` would have emitted, or `nil` when no usable contact
    /// exists to reconstruct — mirrors `edge-artifacts.ts`'s exact shape as of commit
    /// `71301584^` (before #743's marker/RFC-9116-hardening rewrite): `Contact:`/`Expires:`/
    /// `Canonical:`, no marker, single contact only.
    private static func legacyBody(rawContact: String?, siteURL: String?) -> LegacyBody? {
        guard let contactURI = legacyContactURI(rawContact) else { return nil }
        let trimmedSiteURL = (siteURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let origin = (trimmedSiteURL.isEmpty ? "https://example.com" : trimmedSiteURL)
            .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        return LegacyBody(contactURI: contactURI, canonical: "\(origin)/.well-known/security.txt")
    }

    private struct LegacyBody {
        let contactURI: String
        let canonical: String
    }

    /// Reproduces the pre-#743 `buildSecurityTxt`'s contact normalization exactly: an
    /// `http(s):`/`mailto:`/`tel:` URI is used as-is (unlike the current generator, the old one
    /// accepted insecure `http://`), a bare value containing `@` becomes a `mailto:` URI,
    /// anything else is unusable.
    private static func legacyContactURI(_ raw: String?) -> String? {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.range(of: "^(https?:|mailto:|tel:)", options: [.regularExpression, .caseInsensitive]) != nil {
            return trimmed
        }
        if trimmed.contains("@") { return "mailto:\(trimmed)" }
        return nil
    }

    /// True when `content`'s `Contact:`/`Canonical:` lines match `expected` exactly and an
    /// `Expires:` line with a parseable ISO-8601 value sits between them — `Expires` itself is
    /// never compared since it's recomputed fresh on every build. Tolerates the file's trailing
    /// newline (an empty final element from the split) but nothing else past `Canonical:`.
    private static func matches(_ content: String, _ expected: LegacyBody) -> Bool {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard lines.count == 3 || (lines.count == 4 && lines[3].isEmpty) else { return false }
        guard lines[0] == "Contact: \(expected.contactURI)" else { return false }
        guard lines[1].hasPrefix("Expires: "), isPlausibleISO8601(String(lines[1].dropFirst("Expires: ".count)))
        else { return false }
        return lines[2] == "Canonical: \(expected.canonical)"
    }

    /// `ISO8601DateFormatter` needs `.withFractionalSeconds` to parse `Date.toISOString()`'s
    /// millisecond suffix (what the old generator emitted); falls back to the no-fraction variant
    /// so a hand-typed `Expires:` without milliseconds isn't misclassified as unparseable.
    private static func isPlausibleISO8601(_ value: String) -> Bool {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if withFraction.date(from: value) != nil { return true }
        return ISO8601DateFormatter().date(from: value) != nil
    }
}
```

- [ ] **Step 2: Write `SecurityTxtLegacyClassifierTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct SecurityTxtLegacyClassifierTests {
    @Test func exactLegacyShapeMatches() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: "https://example.org"
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func siteURLFallsBackToExampleDotComWhenUnset() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: nil
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func differentContactDoesNotMatch() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "someone-else@example.com", siteURL: "https://example.org"
        )
        #expect(result == .doesNotMatch)
    }

    @Test func handAuthoredContentWithExtraLinesDoesNotMatch() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\nPreferred-Languages: en\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: "https://example.org"
        )
        #expect(result == .doesNotMatch)
    }

    @Test func noCurrentContactNeverMatches() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: nil, siteURL: "https://example.org"
        )
        #expect(result == .doesNotMatch)
    }

    @Test func bareEmailContactIsNormalizedToMailto() {
        let content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: nil
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func httpsContactURIIsUsedAsIs() {
        let content = "Contact: https://example.org/security-report\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "https://example.org/security-report", siteURL: nil
        )
        #expect(result == .matchesLegacyShape)
    }

    @Test func unparseableExpiresDoesNotMatch() {
        let content = "Contact: mailto:security@example.com\nExpires: not-a-date\nCanonical: https://example.com/.well-known/security.txt\n"
        let result = SecurityTxtLegacyClassifier.classify(
            existingContent: content, rawContact: "security@example.com", siteURL: nil
        )
        #expect(result == .doesNotMatch)
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SecurityTxtLegacyClassifierTests`
Expected: PASS (8 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/SecurityTxtLegacyClassifier.swift Tests/AnglesiteCoreTests/SecurityTxtLegacyClassifierTests.swift
git commit -m "feat(#745): classify legacy security.txt against its old shape"
```

---

## Task 2: `SecurityTxtGitignoreSync`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityTxtGitignoreSync.swift`
- Create: `Tests/AnglesiteCoreTests/SecurityTxtGitignoreSyncTests.swift`

**Interfaces:**
- Produces: `public enum SecurityTxtGitignoreSync { public static func addingIgnoreEntry(to contents: String) -> String; public static func removingIgnoreEntry(from contents: String) -> String }` — Task 6 (`SecurityTxtMigrationApplier`) calls both by these exact names.

- [ ] **Step 1: Write `SecurityTxtGitignoreSync.swift`**

```swift
import Foundation

/// Narrow `.gitignore` migration for `public/.well-known/security.txt` — the one entry the
/// security.txt Adopt/Preserve decision needs (design doc "`.gitignore` migration"). Purely
/// additive on adopt, mirroring `SiteActions.ensureImportGitignore`'s pattern (header comment
/// plus the missing line, nothing else ever touched, never rewritten if already present). The one
/// deliberate exception is ``removingIgnoreEntry(from:)``, which drops exactly that one line when
/// a legacy file is classified as hand-authored, so it can actually be committed — "Preserve...
/// makes the file normally git-trackable" is false if it silently stays ignored.
public enum SecurityTxtGitignoreSync {
    private static let ignoredPath = "public/.well-known/security.txt"
    private static let header =
        "# Generated at build by scripts/edge-artifacts.ts (Expires changes every build)."

    /// Adds the header comment and ignore line if `ignoredPath` isn't already listed on its own
    /// line; returns `contents` byte-for-byte unchanged otherwise.
    public static func addingIgnoreEntry(to contents: String) -> String {
        var lines = normalizedLines(contents)
        guard !lines.contains(ignoredPath) else { return contents }
        if !lines.isEmpty { lines.append("") }
        lines.append(header)
        lines.append(ignoredPath)
        return lines.joined(separator: "\n") + "\n"
    }

    /// Removes exactly the `ignoredPath` line, if present; every other line — including the
    /// header comment, even if it becomes orphaned — is left untouched. Returns `contents`
    /// byte-for-byte unchanged if the line isn't there.
    public static func removingIgnoreEntry(from contents: String) -> String {
        var lines = normalizedLines(contents)
        guard lines.contains(ignoredPath) else { return contents }
        lines.removeAll { $0 == ignoredPath }
        return lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
    }

    /// Splits into lines with a normalized (absent) trailing empty element, so both functions can
    /// append/join without producing a doubled blank line at the end.
    private static func normalizedLines(_ contents: String) -> [String] {
        var lines = contents.isEmpty ? [] : contents.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if lines.last == "" { lines.removeLast() }
        return lines
    }
}
```

- [ ] **Step 2: Write `SecurityTxtGitignoreSyncTests.swift`**

```swift
import Testing
@testable import AnglesiteCore

@Suite struct SecurityTxtGitignoreSyncTests {
    @Test func addingToEmptyContentsWritesHeaderAndLine() {
        let result = SecurityTxtGitignoreSync.addingIgnoreEntry(to: "")
        #expect(result == "# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/security.txt\n")
    }

    @Test func addingAppendsAfterExistingContentWithoutTouchingIt() {
        let existing = "node_modules/\ndist/\n"
        let result = SecurityTxtGitignoreSync.addingIgnoreEntry(to: existing)
        #expect(result == "node_modules/\ndist/\n\n# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/security.txt\n")
    }

    @Test func addingIsANoOpWhenAlreadyPresent() {
        let existing = "node_modules/\npublic/.well-known/security.txt\n"
        #expect(SecurityTxtGitignoreSync.addingIgnoreEntry(to: existing) == existing)
    }

    @Test func removingDropsOnlyTheOneLine() {
        let existing = "node_modules/\n# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/security.txt\npublic/.well-known/mta-sts.txt\n"
        let result = SecurityTxtGitignoreSync.removingIgnoreEntry(from: existing)
        #expect(result == "node_modules/\n# Generated at build by scripts/edge-artifacts.ts (Expires changes every build).\npublic/.well-known/mta-sts.txt\n")
    }

    @Test func removingIsANoOpWhenAbsent() {
        let existing = "node_modules/\n"
        #expect(SecurityTxtGitignoreSync.removingIgnoreEntry(from: existing) == existing)
    }

    @Test func removingFromContentsThatBecomeEmptyReturnsEmptyString() {
        let existing = "public/.well-known/security.txt\n"
        #expect(SecurityTxtGitignoreSync.removingIgnoreEntry(from: existing) == "")
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SecurityTxtGitignoreSyncTests`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/SecurityTxtGitignoreSync.swift Tests/AnglesiteCoreTests/SecurityTxtGitignoreSyncTests.swift
git commit -m "feat(#745): add narrow .gitignore sync for security.txt"
```

---

## Task 3: Tighten `TemplateScriptsSyncChecker`'s legacy-file default

**Files:**
- Modify: `Sources/AnglesiteCore/TemplateScriptsSyncChecker.swift:77-91`
- Modify: `Tests/AnglesiteCoreTests/TemplateScriptsSyncCheckerTests.swift:78-93` (replaces one existing test)

**Interfaces:** No signature changes — `TemplateScriptsSyncChecker.check(sourceDirectory:configDirectory:templateDirectory:)` still returns `TemplateScriptsSyncPlan`; only which bucket (`toApply` vs. `divergences`) a no-baseline file lands in changes.

This is the one deliberate behavior reversal from #1053 (design doc "Relationship to `TemplateScriptsSync`"): a `scripts/` file with no recorded baseline that doesn't byte-match the template is no longer silently refreshed — it's queued as a divergence like a genuine hand-edit, with a provisional baseline entry recorded so `TemplateScriptsSyncApplier.resolve` has something to update.

- [ ] **Step 1: Update the failing-first test — rewrite `legacySiteWithNoBaselineSilentlyRefreshesOnFirstEncounter`**

In `Tests/AnglesiteCoreTests/TemplateScriptsSyncCheckerTests.swift`, replace the existing test (lines 78-93):

```swift
    @Test func legacySiteWithNoBaselineSilentlyRefreshesOnFirstEncounter() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("old site content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // No baseline file at all — a pre-existing site from before this mechanism shipped.

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply == [.refresh(relativePath: "scripts/pre-deploy-check.ts")])
        #expect(plan.divergences.isEmpty)

        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("old site content"))
    }
```

with:

```swift
    @Test func legacySiteWithNoBaselineAndDifferingContentIsQueuedAsADivergenceNotSilentlyOverwritten() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("old site content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // No baseline file at all — a pre-existing site from before #745 shipped. #745 changes
        // this case: the app can no longer tell "stale but never touched" from "the owner
        // customized this," so it must never silently overwrite it (design doc "Relationship to
        // TemplateScriptsSync").

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences == [
            TemplateScriptsDivergence(
                relativePath: "scripts/pre-deploy-check.ts",
                templateHash: VectorMath.stableHash("new template content")
            )
        ])

        // A provisional baseline is still recorded — `TemplateScriptsSyncApplier.resolve` needs
        // an entry to update regardless of which way the owner (or the noninteractive Preserve
        // default) decides.
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("old site content"))
    }

    @Test func legacySiteWithNoBaselineButContentMatchingTheTemplateIsStillANoOp() throws {
        let template = try makeTemplate("shared content")
        let (source, config) = makeSite()
        try writeFile("shared content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // No baseline recorded, but the site's content happens to already match the template
        // exactly — this never reaches the "no baseline" branch at all (it's caught by the
        // templateHash == siteHash check first), so it stays a silent no-op/backfill, unchanged
        // by #745.

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("shared content"))
    }
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `swift test --package-path . --filter TemplateScriptsSyncCheckerTests`
Expected: FAIL — `legacySiteWithNoBaselineAndDifferingContentIsQueuedAsADivergenceNotSilentlyOverwritten` fails because the checker still queues a silent `.refresh`, not a divergence.

- [ ] **Step 3: Apply the checker fix**

In `Sources/AnglesiteCore/TemplateScriptsSyncChecker.swift`, replace lines 77-91:

```swift
            if baseline.files[relativePath] == nil {
                // First encounter for this site: its current content becomes the assumed-untouched
                // baseline (design doc's legacy-site trade-off).
                baseline.files[relativePath] = TemplateScriptsBaseline.Entry(baselineHash: siteHash)
                baselineChanged = true
            }
            let entry = baseline.files[relativePath]!

            if entry.baselineHash == siteHash {
                toApply.append(.refresh(relativePath: relativePath))
            } else if entry.acknowledgedTemplateHash == templateHash {
                continue
            } else {
                divergences.append(TemplateScriptsDivergence(relativePath: relativePath, templateHash: templateHash))
            }
```

with:

```swift
            let hadNoBaseline = baseline.files[relativePath] == nil
            if hadNoBaseline {
                // First encounter for this site (#745 changed this branch): its current content
                // is recorded as a *provisional* baseline so `resolve()` has an entry to update,
                // but — unlike #1053's original behavior — it is never treated as reconciled on
                // this same pass. The app can't tell "stale but untouched" from "the owner
                // customized this" without a prior baseline, so it must fall through to the
                // divergence queue below rather than being silently refreshed.
                baseline.files[relativePath] = TemplateScriptsBaseline.Entry(baselineHash: siteHash)
                baselineChanged = true
            }
            let entry = baseline.files[relativePath]!

            if !hadNoBaseline && entry.baselineHash == siteHash {
                toApply.append(.refresh(relativePath: relativePath))
            } else if entry.acknowledgedTemplateHash == templateHash {
                continue
            } else {
                divergences.append(TemplateScriptsDivergence(relativePath: relativePath, templateHash: templateHash))
            }
```

**Addendum (found and fixed during Task 8's review, not part of this task's original scope — the two branches above must actually be swapped):** the `!hadNoBaseline && entry.baselineHash == siteHash` check must be evaluated *after* `entry.acknowledgedTemplateHash == templateHash`, not before. Reason: for the provisional-baseline path this task introduces, `baselineHash` is seeded to the *owner's own diverged content* on first encounter — unlike #1053's original invariant, where `baselineHash` only ever holds a genuinely-reconciled template hash. Once an owner's divergence is acknowledged via `TemplateScriptsSyncApplier.resolve(..., decision: .keepMine, ...)` and the file is never edited again, `siteHash` permanently equals that provisional `baselineHash` — so checking the refresh branch first would silently reclassify an acknowledged-Preserve file as safe-to-refresh and overwrite it on the very next check, making the acknowledgment meaningless. This only affects the new provisional-baseline path; every #1053-original scenario is unaffected (a genuine hand-edit always makes `baselineHash != siteHash`, since that baseline reflects a past *template* state, not the owner's own edited content — so which branch is checked first never mattered before this task introduced the provisional-baseline case). The corrected order:

```swift
            if !hadNoBaseline && entry.acknowledgedTemplateHash == templateHash {
                continue
            } else if !hadNoBaseline && entry.baselineHash == siteHash {
                toApply.append(.refresh(relativePath: relativePath))
            } else {
                divergences.append(TemplateScriptsDivergence(relativePath: relativePath, templateHash: templateHash))
            }
```

This wasn't caught by this task's own tests (Step 4 below) because none of them call `resolve(.keepMine)` and then re-run `check()` — that two-step sequence only became exercisable once Task 8's orchestrator actually started calling `resolve(..., decision: .keepMine, ...)` for a noninteractive Preserve default. If you are implementing this plan fresh (not resuming from a partially-completed run), apply the corrected order directly here rather than the original order — there's no need to reproduce the bug first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TemplateScriptsSyncCheckerTests`
Expected: PASS (9 tests — the 8 pre-existing ones, unaffected, plus the new one; the old single-purpose test was replaced by two).

- [ ] **Step 5: Run the full `TemplateScriptsSyncApplierTests` suite to confirm no regression**

Run: `swift test --package-path . --filter TemplateScriptsSyncApplierTests`
Expected: PASS — the applier itself is untouched by this task; this just confirms the checker change didn't break its downstream consumer's tests (it doesn't, since the applier only receives whatever plan the checker produces and has no logic of its own about baselines-that-didn't-exist).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/TemplateScriptsSyncChecker.swift Tests/AnglesiteCoreTests/TemplateScriptsSyncCheckerTests.swift
git commit -m "fix(#745): never silently overwrite an unbaselined legacy script file"
```

---

## Task 4: `ExistingSiteMigrationPendingCommit`

**Files:**
- Create: `Sources/AnglesiteCore/ExistingSiteMigrationPendingCommit.swift`
- Create: `Tests/AnglesiteCoreTests/ExistingSiteMigrationPendingCommitTests.swift`

**Interfaces:**
- Produces: `public struct ExistingSiteMigrationPendingCommit: Codable, Equatable, Sendable { public static let filename: String; public var pendingPaths: [String]; public init(pendingPaths: [String] = []); public static func load(from configDirectory: URL) -> ExistingSiteMigrationPendingCommit; public func save(to configDirectory: URL) throws }` — Task 7 (`ExistingSiteMigrationCommitter`) uses `pendingPaths`, `load(from:)`, and `save(to:)` by these exact names.

- [ ] **Step 1: Write `ExistingSiteMigrationPendingCommit.swift`**

```swift
import Foundation

/// Durable record of relative paths this migration (#745) wrote but hasn't yet confirmed
/// committed to the site's `Source/` git repo (design doc "Resumability without a transaction
/// log"). App-owned, `Config/`-only — never written into `Source/`, never committed to the
/// site's own repo — same placement rationale as `Config/dependency-baseline.json` and
/// `Config/template-scripts-baseline.json`.
public struct ExistingSiteMigrationPendingCommit: Codable, Equatable, Sendable {
    /// The record's filename inside `Config/` — public so tests and diagnostics can locate the
    /// file without duplicating the string.
    public static let filename = "existing-site-migration-pending-commit.json"

    /// Relative paths written but not yet confirmed committed. Empty is the normal, common state
    /// — every site-open's retry pass (`ExistingSiteMigrationCommitter.retryPendingCommit`) is a
    /// no-op unless a prior run wrote files and then failed (or was interrupted) before its
    /// commit landed.
    public var pendingPaths: [String]

    /// Creates a record; the empty default is the normal never-pending state ``load(from:)`` also
    /// falls back to.
    public init(pendingPaths: [String] = []) {
        self.pendingPaths = pendingPaths
    }

    /// Never fails — an absent or corrupt record reads as "nothing pending," which is the safe
    /// default (worst case, a genuinely-pending commit from a corrupted record is simply retried
    /// on next migration rather than lost, since the underlying files are still on disk either
    /// way).
    public static func load(from configDirectory: URL) -> ExistingSiteMigrationPendingCommit {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(ExistingSiteMigrationPendingCommit.self, from: data)
        else { return ExistingSiteMigrationPendingCommit() }
        return decoded
    }

    /// Writes the record atomically into `configDirectory` — unlike ``load(from:)`` this does
    /// throw, since silently losing a just-recorded pending list would mean a failed commit's
    /// files are never retried.
    public func save(to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(Self.filename)
        let data = try JSONEncoder().encode(self)
        try data.write(to: url, options: .atomic)
    }
}
```

- [ ] **Step 2: Write `ExistingSiteMigrationPendingCommitTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct ExistingSiteMigrationPendingCommitTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test func loadReturnsEmptyWhenFileIsAbsent() {
        let config = tmpDir()
        #expect(ExistingSiteMigrationPendingCommit.load(from: config) == ExistingSiteMigrationPendingCommit())
    }

    @Test func saveThenLoadRoundTrips() throws {
        let config = tmpDir()
        let record = ExistingSiteMigrationPendingCommit(pendingPaths: ["scripts/edge-artifacts.ts", ".gitignore"])
        try record.save(to: config)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config) == record)
    }

    @Test func loadReturnsEmptyWhenFileIsCorrupt() throws {
        let config = tmpDir()
        try Data("not json".utf8).write(to: config.appendingPathComponent(ExistingSiteMigrationPendingCommit.filename))
        #expect(ExistingSiteMigrationPendingCommit.load(from: config) == ExistingSiteMigrationPendingCommit())
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter ExistingSiteMigrationPendingCommitTests`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/ExistingSiteMigrationPendingCommit.swift Tests/AnglesiteCoreTests/ExistingSiteMigrationPendingCommitTests.swift
git commit -m "feat(#745): add Config/ pending-commit record"
```

---

## Task 5: `SecurityTxtMigrationChecker`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityTxtMigrationChecker.swift`
- Create: `Tests/AnglesiteCoreTests/SecurityTxtMigrationCheckerTests.swift`

**Interfaces:**
- Consumes: `SecurityTxtLegacyClassifier.classify(existingContent:rawContact:siteURL:)` (Task 1); existing `SiteConfigFile.value(forKey:in:)` (`Sources/AnglesiteCore/SiteConfigFile.swift:18`); existing `WebsiteAnalyticsAsset.configRelativePath` (`Sources/AnglesiteCore/WebsiteAnalyticsAsset.swift:60`, value `".site-config"`); existing `SecurityReportingAsset.Mode` (`Sources/AnglesiteCore/SecurityReportingAsset.swift:12`, cases `.generated`/`.manual`/`.disabled`); existing `GeneratedEndpoints.securityTxtMarker` (`Sources/AnglesiteCore/WellKnownInventory.swift:401`, the exact first-line marker string `edge-artifacts.ts`'s current generator writes).
- Produces: `public enum SecurityTxtMigrationPlan: Sendable, Equatable { case nothingToDo; case silentBackfillMode(SecurityReportingAsset.Mode); case silentAdopt; case needsDecision }`; `public enum SecurityTxtMigrationChecker { public static func check(sourceDirectory: URL) -> SecurityTxtMigrationPlan }` — Task 8 (`ExistingSiteMigration`) and Task 10 (`SiteWindowModel` wiring) both switch over `SecurityTxtMigrationPlan` by these exact case names, dispatching to Task 6's `SecurityTxtMigrationApplier.applyBackfill`/`.applyDecision` (which consume `SecurityReportingAsset.Mode`/`.Decision` directly and never reference `SecurityTxtMigrationPlan` themselves).

**Design note (fixed during this plan's self-review):** an unmarked file that positively matches the pre-#743 generator's exact old shape is *not* ambiguous — it's the same "app knows the right answer" situation as a byte-identical `scripts/` file (Task 3's untouched branch), so it must auto-apply, not ask. Only a genuine mismatch is a real decision. This is why `.needsDecision` carries no `matchesLegacyShape` payload: by construction, every case that reaches it already failed to match. `.silentAdopt` reuses `SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory:)` (Task 6) directly — no separate apply function is needed for it.

- [ ] **Step 1: Write `SecurityTxtMigrationChecker.swift`**

```swift
import Foundation

/// One `SecurityTxtMigrationChecker.check` outcome (design doc "Detection: security.txt").
public enum SecurityTxtMigrationPlan: Sendable, Equatable {
    /// `SECURITY_TXT_MODE` is already set in `.site-config` — nothing to migrate. The key's own
    /// presence is this mechanism's idempotency marker (design doc "Data model").
    case nothingToDo
    /// No file exists — the mode is inferred from whether a contact is configured, matching
    /// `resolveSecurityTxtMode`'s existing behavior. Mode-only write, no file to touch.
    case silentBackfillMode(SecurityReportingAsset.Mode)
    /// The file is already marker-owned (mode-only backfill to `.generated`), **or** it's
    /// unmarked but positively matches what the pre-#743 generator would have produced from the
    /// site's current settings — in both cases the app can resolve this on its own, the same way
    /// an unmodified `scripts/` file silently refreshes (Task 3). Apply via
    /// `SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory:)`.
    case silentAdopt
    /// An unmarked `security.txt` exists and does **not** match the old generator's shape — a
    /// genuine ambiguity needing an Adopt/Preserve decision, interactively, or defaulted to
    /// Preserve in a noninteractive flow (design doc "Noninteractive flows").
    case needsDecision
}

/// Detects whether a site's `SECURITY_TXT_MODE` needs backfilling and, if an unmarked
/// `public/.well-known/security.txt` exists, whether it can be positively classified as
/// Anglesite's own historical output (design doc "Detection: security.txt"). Pure; makes no
/// writes — only `SecurityTxtMigrationApplier` does that.
public enum SecurityTxtMigrationChecker {
    public static func check(sourceDirectory: URL) -> SecurityTxtMigrationPlan {
        let configURL = sourceDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "SECURITY_TXT_MODE", in: config) == nil else {
            return .nothingToDo
        }

        let rawContact = SiteConfigFile.value(forKey: "SECURITY_CONTACT", in: config)
        let siteURL = SiteConfigFile.value(forKey: "SITE_URL", in: config)
        let fileURL = sourceDirectory.appendingPathComponent("public/.well-known/security.txt")
        guard let existingContent = try? String(contentsOf: fileURL, encoding: .utf8) else {
            // No file at all: the mode is unambiguous from whether a contact is configured,
            // matching `resolveSecurityTxtMode`'s existing inference — nothing here for an owner
            // to lose, so this backfills silently.
            let hasContact = !(rawContact ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            return .silentBackfillMode(hasContact ? .generated : .disabled)
        }

        if isMarkerOwned(existingContent) {
            return .silentAdopt
        }

        let classification = SecurityTxtLegacyClassifier.classify(
            existingContent: existingContent, rawContact: rawContact, siteURL: siteURL
        )
        return classification == .matchesLegacyShape ? .silentAdopt : .needsDecision
    }

    /// True when `content`'s first line is exactly the current generator's marker — mirrors
    /// `isSecurityTxtMarkerOwned` on the TypeScript side.
    private static func isMarkerOwned(_ content: String) -> Bool {
        content.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first
            == GeneratedEndpoints.securityTxtMarker[...]
    }
}
```

- [ ] **Step 2: Write `SecurityTxtMigrationCheckerTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct SecurityTxtMigrationCheckerTests {
    private func tmpSite() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeConfig(_ contents: String, to source: URL) throws {
        try contents.write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
    }

    private func writeSecurityTxt(_ contents: String, to source: URL) throws {
        let wellKnown = source.appendingPathComponent("public/.well-known")
        try FileManager.default.createDirectory(at: wellKnown, withIntermediateDirectories: true)
        try contents.write(to: wellKnown.appendingPathComponent("security.txt"), atomically: true, encoding: .utf8)
    }

    @Test func modeAlreadySetIsNothingToDo() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_TXT_MODE=manual\n", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .nothingToDo)
    }

    @Test func noFileNoContactBackfillsDisabled() throws {
        let source = tmpSite()
        try writeConfig("", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentBackfillMode(.disabled))
    }

    @Test func noFileWithContactBackfillsGenerated() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\n", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentBackfillMode(.generated))
    }

    @Test func markerOwnedFileIsSilentAdopt() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\n", to: source)
        try writeSecurityTxt(
            "\(GeneratedEndpoints.securityTxtMarker)\nContact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\n",
            to: source
        )
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentAdopt)
    }

    @Test func unmarkedFileMatchingLegacyShapeIsSilentAdopt() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\nSITE_URL=https://example.org\n", to: source)
        try writeSecurityTxt(
            "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n",
            to: source
        )
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentAdopt)
    }

    @Test func unmarkedFileNotMatchingLegacyShapeNeedsDecision() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\n", to: source)
        try writeSecurityTxt("Contact: mailto:someone-else@example.com\n", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .needsDecision)
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SecurityTxtMigrationCheckerTests`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/SecurityTxtMigrationChecker.swift Tests/AnglesiteCoreTests/SecurityTxtMigrationCheckerTests.swift
git commit -m "feat(#745): add SecurityTxtMigrationChecker"
```

---

## Task 6: `SecurityTxtMigrationApplier`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityTxtMigrationApplier.swift`
- Create: `Tests/AnglesiteCoreTests/SecurityTxtMigrationApplierTests.swift`

**Interfaces:**
- Consumes: `SecurityTxtGitignoreSync.addingIgnoreEntry(to:)`/`.removingIgnoreEntry(from:)` (Task 2); existing `SecurityReportingAsset.Mode`; existing `GeneratedEndpoints.securityTxtMarker`; existing `SiteConfigFile.upsert(_:into:)` (`Sources/AnglesiteCore/SiteConfigFile.swift`); existing `WebsiteAnalyticsAsset.configRelativePath`.
- Produces: `public enum SecurityTxtMigrationApplier { public enum Decision: Sendable, Equatable { case adopt; case preserve }; public static func applyBackfill(mode: SecurityReportingAsset.Mode, sourceDirectory: URL) -> [String]; public static func applyDecision(_ decision: Decision, sourceDirectory: URL) -> [String] }` — both functions are **non-throwing** and return exactly the relative paths actually changed (`[]` if nothing needed writing, e.g. a re-run). Task 8 (`ExistingSiteMigration`), Task 9 (`SecurityTxtMigrationModel`), and Task 10 (`SiteWindowModel` wiring) call both by these exact names.

**Note on why `applyDecision`'s Adopt case doesn't rebuild the file's content:** the classifier (Task 1/5) already confirmed the existing content matches what regenerating from current settings would produce; Adopt only needs to make the file marker-owned (prepend the current marker line) and set the mode. `edge-artifacts.ts`'s own `applySecurityTxtPlan` already unconditionally rewrites a marker-owned file with fresh content (including a new `Expires`) on every subsequent build — so the very next `prebuild` finishes the job with the exact current generator, and this task never needs a Swift port of `buildSecurityTxt`.

**Note on why this is non-throwing, best-effort per sub-write (fixed during task review — an earlier throwing draft had a real bug):** a throwing design where a *later* step's failure discards the return value for the *whole* call would silently lose the record of an earlier sub-write that already landed on disk (e.g. `.site-config`'s `SECURITY_TXT_MODE` gets written successfully, then the file write fails, and the caller's `try?` throws away the entire `touched` array — including the real, already-committed-to-disk `.site-config` mutation, which then never reaches `ExistingSiteMigrationCommitter` and never gets git-added). Worse, since `SecurityTxtMigrationChecker.check` gates entirely on whether `SECURITY_TXT_MODE` is already set, that stranded mutation would make every future check return `.nothingToDo` forever, even though the file was never actually adopted. Each private helper (`writeMode`/`updateGitignore`) now swallows its own write failure via `try?` and simply returns `[]` for that one step (matching the established `DependencySyncApplier` "narrow failure modes, otherwise best-effort" precedent in this codebase, `Sources/AnglesiteCore/DependencySyncApplier.swift`) — so every sub-write that *did* land is always reflected in the return value, regardless of what happens to any other step.

- [ ] **Step 1: Write `SecurityTxtMigrationApplier.swift`**

```swift
import Foundation

/// Applies what `SecurityTxtMigrationChecker` found (design doc "Apply"). Two entry points:
/// `applyBackfill` for the two silently-appliable outcomes (no owner consent needed), and
/// `applyDecision` for the owner's (or a noninteractive caller's) Adopt/Preserve choice.
/// Non-throwing and best-effort per sub-write: each private write helper swallows its own
/// failure and returns `[]` for that one step, so a failure in one step never discards the
/// record of an earlier step that already succeeded (see the task's design note on why an
/// earlier throwing draft was wrong).
public enum SecurityTxtMigrationApplier {
    /// The owner's (or the noninteractive default's) answer to a `SecurityTxtMigrationPlan
    /// .needsDecision` — the only decision this mechanism ever delegates.
    public enum Decision: Sendable, Equatable {
        /// Adopt as generated: prepend the current marker so the next build's own generator
        /// treats this as its own output, and gitignore it as build output going forward.
        case adopt
        /// Preserve as hand-authored: leave file content untouched; ensure it's not gitignored,
        /// so it becomes normally git-trackable.
        case preserve
    }

    /// Writes only `SECURITY_TXT_MODE` (contacts are left exactly as they are — this never
    /// touches `SECURITY_CONTACT`). Returns `[".site-config"]` if the value changed and the
    /// write succeeded, `[]` if it was already correct (idempotent re-run) or the write failed.
    public static func applyBackfill(
        mode: SecurityReportingAsset.Mode, sourceDirectory: URL
    ) -> [String] {
        writeMode(mode, sourceDirectory: sourceDirectory)
    }

    /// Applies the owner's (or the noninteractive default's) Adopt/Preserve decision for an
    /// unmarked legacy `security.txt` (design doc "Apply" step 2-5). Each sub-step is
    /// independent: if the file write fails after the mode write already succeeded, the
    /// returned array still includes `.site-config` (it really did change) — it just omits
    /// whichever step failed.
    public static func applyDecision(
        _ decision: Decision, sourceDirectory: URL
    ) -> [String] {
        var touched: [String] = []
        switch decision {
        case .adopt:
            touched += writeMode(.generated, sourceDirectory: sourceDirectory)
            let fileURL = sourceDirectory.appendingPathComponent("public/.well-known/security.txt")
            if let existing = try? String(contentsOf: fileURL, encoding: .utf8) {
                let marked = GeneratedEndpoints.securityTxtMarker + "\n" + existing
                if (try? marked.write(to: fileURL, atomically: true, encoding: .utf8)) != nil {
                    touched.append("public/.well-known/security.txt")
                }
            }
            touched += updateGitignore(sourceDirectory: sourceDirectory, adopt: true)
        case .preserve:
            touched += writeMode(.manual, sourceDirectory: sourceDirectory)
            touched += updateGitignore(sourceDirectory: sourceDirectory, adopt: false)
        }
        return touched
    }

    private static func writeMode(
        _ mode: SecurityReportingAsset.Mode, sourceDirectory: URL
    ) -> [String] {
        let configURL = sourceDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([("SECURITY_TXT_MODE", mode.rawValue)], into: config)
        guard updated != config else { return [] }
        guard (try? updated.write(to: configURL, atomically: true, encoding: .utf8)) != nil else { return [] }
        return [WebsiteAnalyticsAsset.configRelativePath]
    }

    private static func updateGitignore(sourceDirectory: URL, adopt: Bool) -> [String] {
        let gitignoreURL = sourceDirectory.appendingPathComponent(".gitignore")
        let contents = (try? String(contentsOf: gitignoreURL, encoding: .utf8)) ?? ""
        let updated = adopt
            ? SecurityTxtGitignoreSync.addingIgnoreEntry(to: contents)
            : SecurityTxtGitignoreSync.removingIgnoreEntry(from: contents)
        guard updated != contents else { return [] }
        guard (try? updated.write(to: gitignoreURL, atomically: true, encoding: .utf8)) != nil else { return [] }
        return [".gitignore"]
    }
}
```

- [ ] **Step 2: Write `SecurityTxtMigrationApplierTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct SecurityTxtMigrationApplierTests {
    private func tmpSite() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeSecurityTxt(_ contents: String, to source: URL) throws {
        let wellKnown = source.appendingPathComponent("public/.well-known")
        try FileManager.default.createDirectory(at: wellKnown, withIntermediateDirectories: true)
        try contents.write(to: wellKnown.appendingPathComponent("security.txt"), atomically: true, encoding: .utf8)
    }

    @Test func applyBackfillWritesModeAndReturnsTouchedPath() throws {
        let source = tmpSite()
        let touched = SecurityTxtMigrationApplier.applyBackfill(mode: .disabled, sourceDirectory: source)
        #expect(touched == [".site-config"])
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=disabled"))
    }

    @Test func applyBackfillIsANoOpWhenAlreadyCorrect() throws {
        let source = tmpSite()
        try "SECURITY_TXT_MODE=generated\n".write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let touched = SecurityTxtMigrationApplier.applyBackfill(mode: .generated, sourceDirectory: source)
        #expect(touched.isEmpty)
    }

    @Test func applyDecisionAdoptPrependsMarkerSetsModeAndGitignoresTheFile() throws {
        let source = tmpSite()
        try writeSecurityTxt("Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\n", to: source)

        let touched = SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory: source)

        #expect(Set(touched) == Set([".site-config", "public/.well-known/security.txt", ".gitignore"]))
        let content = try String(contentsOf: source.appendingPathComponent("public/.well-known/security.txt"), encoding: .utf8)
        #expect(content.hasPrefix(GeneratedEndpoints.securityTxtMarker + "\n"))
        #expect(content.contains("Contact: mailto:security@example.com"))
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
        let gitignore = try String(contentsOf: source.appendingPathComponent(".gitignore"), encoding: .utf8)
        #expect(gitignore.contains("public/.well-known/security.txt"))
    }

    @Test func applyDecisionPreserveLeavesFileUntouchedSetsManualModeAndUngitignoresIt() throws {
        let source = tmpSite()
        try writeSecurityTxt("Contact: mailto:someone-else@example.com\n", to: source)
        try "public/.well-known/security.txt\n".write(
            to: source.appendingPathComponent(".gitignore"), atomically: true, encoding: .utf8
        )

        let touched = SecurityTxtMigrationApplier.applyDecision(.preserve, sourceDirectory: source)

        #expect(Set(touched) == Set([".site-config", ".gitignore"]))
        let content = try String(contentsOf: source.appendingPathComponent("public/.well-known/security.txt"), encoding: .utf8)
        #expect(content == "Contact: mailto:someone-else@example.com\n")
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=manual"))
        let gitignore = try String(contentsOf: source.appendingPathComponent(".gitignore"), encoding: .utf8)
        #expect(!gitignore.contains("public/.well-known/security.txt"))
    }

    @Test func applyDecisionPreserveWithNoExistingGitignoreEntryTouchesNothingForGitignore() throws {
        let source = tmpSite()
        try writeSecurityTxt("Contact: mailto:someone-else@example.com\n", to: source)

        let touched = SecurityTxtMigrationApplier.applyDecision(.preserve, sourceDirectory: source)

        #expect(touched == [".site-config"])
        #expect(!FileManager.default.fileExists(atPath: source.appendingPathComponent(".gitignore").path))
    }

    @Test func applyDecisionAdoptStillReportsAModeChangeEvenWhenTheFileDoesNotExist() throws {
        // No security.txt file on disk at all — the file-write branch is skipped entirely
        // (there's nothing to prepend the marker to), but the mode write is independent and
        // must still be reported, exercising the "one step's absence doesn't suppress another
        // step's real result" contract this task's design note describes.
        let source = tmpSite()
        let touched = SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory: source)
        #expect(touched == [".site-config"])
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SecurityTxtMigrationApplierTests`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/SecurityTxtMigrationApplier.swift Tests/AnglesiteCoreTests/SecurityTxtMigrationApplierTests.swift
git commit -m "feat(#745): add SecurityTxtMigrationApplier"
```

---

## Task 7: `ExistingSiteMigrationCommitter`

**Files:**
- Create: `Sources/AnglesiteCore/ExistingSiteMigrationCommitter.swift`
- Create: `Tests/AnglesiteCoreTests/ExistingSiteMigrationCommitterTests.swift`

**Interfaces:**
- Consumes: `ExistingSiteMigrationPendingCommit`/`.load(from:)`/`.save(to:)` (Task 4); existing `InboxSubmissionCommitter.processGitCommitBatch(_:_:_:)` (`Sources/AnglesiteCore/InboxSubmissionCommitter.swift`, signature `@Sendable (URL, [String], String) async -> String?`).
- Produces: `public enum ExistingSiteMigrationCommitter { public static func commit(touchedPaths: [String], sourceDirectory: URL, configDirectory: URL, message: String, gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch) async -> Bool; public static func retryPendingCommit(sourceDirectory: URL, configDirectory: URL, message: String, gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch) async -> Bool }` — Task 8 and Task 10 call both by these exact names, with the `gitCommitBatch` parameter overridden only in tests.

- [ ] **Step 1: Write `ExistingSiteMigrationCommitter.swift`**

```swift
import Foundation

/// Commits relative paths written by this issue's migration steps (script-file sync's create/
/// refresh/divergence-resolve, and `SecurityTxtMigrationApplier`) to the site's `Source/` git
/// repo, and retries a commit that didn't happen last time (design doc "Resumability without a
/// transaction log").
public enum ExistingSiteMigrationCommitter {
    /// Commits `touchedPaths` (deduplicated and filtered to paths that actually exist on disk —
    /// a path a failed write never produced would abort the whole batch commit in
    /// `InboxSubmissionCommitter.processGitCommitBatch`, since a failed `git add` on a missing
    /// path fails the entire call) via `gitCommitBatch`. Records the paths as pending *before*
    /// attempting the commit and clears the record only on success, so a crash between "files
    /// written" and "commit succeeded" leaves a durable retry list. Returns `true` when there was
    /// nothing to commit, or the commit succeeded; `false` only when there was something to
    /// commit and it failed.
    @discardableResult
    public static func commit(
        touchedPaths: [String],
        sourceDirectory: URL,
        configDirectory: URL,
        message: String,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> Bool {
        let paths = Array(Set(touchedPaths))
            .filter { FileManager.default.fileExists(atPath: sourceDirectory.appendingPathComponent($0).path) }
            .sorted()
        guard !paths.isEmpty else { return true }

        try? ExistingSiteMigrationPendingCommit(pendingPaths: paths).save(to: configDirectory)
        guard await gitCommitBatch(sourceDirectory, paths, message) != nil else { return false }
        try? ExistingSiteMigrationPendingCommit().save(to: configDirectory)
        return true
    }

    /// Retries committing whatever's left in `Config/existing-site-migration-pending-commit.json`
    /// from a prior interrupted or failed run. A no-op when the list is empty (the common case,
    /// every site-open). Callers should run this *before* checking for new migration work, so a
    /// stale pending commit doesn't sit alongside a fresh one from the same pass.
    @discardableResult
    public static func retryPendingCommit(
        sourceDirectory: URL,
        configDirectory: URL,
        message: String,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> Bool {
        let pending = ExistingSiteMigrationPendingCommit.load(from: configDirectory)
        guard !pending.pendingPaths.isEmpty else { return true }
        return await commit(
            touchedPaths: pending.pendingPaths,
            sourceDirectory: sourceDirectory,
            configDirectory: configDirectory,
            message: message,
            gitCommitBatch: gitCommitBatch
        )
    }
}
```

- [ ] **Step 2: Write `ExistingSiteMigrationCommitterTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct ExistingSiteMigrationCommitterTests {
    private func tmpDirs() -> (source: URL, config: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try? FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        return (source, config)
    }

    @Test func emptyTouchedPathsIsANoOpThatReturnsTrue() async throws {
        let (source, config) = tmpDirs()
        var callCount = 0
        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: [], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in callCount += 1; return "deadbeef" }
        )
        #expect(result == true)
        #expect(callCount == 0)
    }

    @Test func successfulCommitClearsThePendingRecord() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("file.txt"), atomically: true, encoding: .utf8)

        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: ["file.txt"], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in "deadbeef" }
        )

        #expect(result == true)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths.isEmpty)
    }

    @Test func failedCommitLeavesThePendingRecordSet() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("file.txt"), atomically: true, encoding: .utf8)

        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: ["file.txt"], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in nil }
        )

        #expect(result == false)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths == ["file.txt"])
    }

    @Test func pathsThatDoNotExistOnDiskAreExcludedFromTheCommit() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("real.txt"), atomically: true, encoding: .utf8)

        var committedPaths: [String] = []
        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: ["real.txt", "never-written.txt"], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, paths, _ in committedPaths = paths; return "deadbeef" }
        )

        #expect(result == true)
        #expect(committedPaths == ["real.txt"])
    }

    @Test func retryPendingCommitIsANoOpWhenNothingIsPending() async throws {
        let (source, config) = tmpDirs()
        var callCount = 0
        let result = await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in callCount += 1; return "deadbeef" }
        )
        #expect(result == true)
        #expect(callCount == 0)
    }

    @Test func retryPendingCommitRetriesAndClearsAPriorFailure() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("file.txt"), atomically: true, encoding: .utf8)
        try ExistingSiteMigrationPendingCommit(pendingPaths: ["file.txt"]).save(to: config)

        let result = await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in "deadbeef" }
        )

        #expect(result == true)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths.isEmpty)
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter ExistingSiteMigrationCommitterTests`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/ExistingSiteMigrationCommitter.swift Tests/AnglesiteCoreTests/ExistingSiteMigrationCommitterTests.swift
git commit -m "feat(#745): add ExistingSiteMigrationCommitter"
```

---

## Task 8: `ExistingSiteMigration.runNoninteractively` (headless orchestrator)

**Files:**
- Create: `Sources/AnglesiteCore/ExistingSiteMigration.swift`
- Create: `Tests/AnglesiteCoreTests/ExistingSiteMigrationTests.swift`

**Interfaces:**
- Consumes: `TemplateScriptsSyncChecker.check(sourceDirectory:configDirectory:templateDirectory:)` (existing, Task 3's fix), `TemplateScriptsSyncApplier.applyQueued(_:sourceDirectory:configDirectory:templateDirectory:)` (existing), `SecurityTxtMigrationChecker.check(sourceDirectory:)` (Task 5), `SecurityTxtMigrationApplier.applyBackfill(mode:sourceDirectory:)`/`.applyDecision(_:sourceDirectory:)` (Task 6), `ExistingSiteMigrationCommitter.commit(touchedPaths:sourceDirectory:configDirectory:message:gitCommitBatch:)`/`.retryPendingCommit(sourceDirectory:configDirectory:message:gitCommitBatch:)` (Task 7), existing `LogCenter`/`LogCenter.Stream`/`LogCenter.append(source:stream:text:)` (`Sources/AnglesiteCore/LogCenter.swift`).
- Produces: `public enum ExistingSiteMigration { public static func runNoninteractively(sourceDirectory: URL, configDirectory: URL, templateDirectory: URL?, source: String, logCenter: LogCenter = .shared) async }` — Task 11 (`SiteOperations` wiring) calls this by this exact name.

- [ ] **Step 1: Write `ExistingSiteMigration.swift`**

```swift
import Foundation

/// Runs every existing-site migration step (script-file sync's legacy-unclassified case,
/// `SecurityTxtMigrationChecker`/`Applier`) with every decision defaulted to Preserve, for a
/// caller with no UI to ask through — `SiteOperations`'s headless App Intents/Shortcuts/Siri path
/// (design doc "Noninteractive flows"). The windowed `SiteWindowModel.loadAndStart()` path does
/// **not** use this type — it composes the same checkers/appliers directly so it can show a sheet
/// and await a real decision; this exists so the headless path gets the same coverage without
/// re-implementing the same sequencing with different defaults.
public enum ExistingSiteMigration {
    private static let commitMessage = "chore: migrate existing site to current template baseline"

    /// Applies every silently-safe script action, defaults every script divergence to "keep
    /// mine" (Preserve), defaults every `security.txt` decision to Preserve, commits whatever
    /// changed, and logs an actionable message to `source` for anything left with unresolved
    /// ownership. Best-effort throughout — a failure at any step is logged and does not stop the
    /// rest, since this runs ahead of a deploy that should still proceed whenever possible.
    /// `templateDirectory` is `nil` when the bundled template can't be resolved (matches the
    /// existing `TemplateRuntime.bundledURL()` guard in `SiteWindowModel`); script-file migration
    /// is skipped in that case, but `security.txt`/`.gitignore` migration still runs since it
    /// needs no template.
    public static func runNoninteractively(
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL?,
        source: String,
        logCenter: LogCenter = .shared
    ) async {
        await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: sourceDirectory, configDirectory: configDirectory, message: commitMessage
        )

        var touched: [String] = []
        var unresolved: [String] = []

        if let templateDirectory {
            let plan = TemplateScriptsSyncChecker.check(
                sourceDirectory: sourceDirectory, configDirectory: configDirectory, templateDirectory: templateDirectory
            )
            // Applied one action at a time, not as a single batch: `applyQueued` throws on the
            // first file it can't process but leaves every earlier write (and its baseline entry)
            // intact — batching the call would silently drop those already-landed files from
            // `touched`, so they'd never reach the committer or its pending-commit retry record
            // (fixed during task review; the original single-batch-call draft had exactly this
            // bug).
            for action in plan.toApply {
                if (try? TemplateScriptsSyncApplier.applyQueued(
                    [action], sourceDirectory: sourceDirectory, configDirectory: configDirectory,
                    templateDirectory: templateDirectory
                )) != nil {
                    touched.append(action.relativePath)
                } else {
                    await logCenter.append(
                        source: source, stream: .stderr,
                        text: "Existing-site migration couldn't refresh \(action.relativePath) — it will be retried on the next open."
                    )
                }
            }
            // Every divergence — a genuine hand-edit or an unclassified legacy file (Task 3) — is
            // left exactly as-is: resolving it `.keepMine` writes nothing under `Source/`, only
            // records the acknowledgement in `Config/`, so there is nothing to add to `touched`.
            // The `resolve` call itself is NOT optional, despite writing nothing under `Source/`
            // (fixed during task review; the original draft skipped it entirely): without it, the
            // checker's provisional first-encounter baseline (set the first time it saw this file,
            // design doc "Detection: script files") stays unacknowledged, so the *next* run sees
            // `entry.baselineHash == siteHash` (nothing changed since that provisional baseline)
            // and silently reclassifies the exact same file as a safe `.refresh` — overwriting the
            // owner's content on the very next headless deploy, which is precisely what this
            // noninteractive path exists to prevent.
            for divergence in plan.divergences {
                try? TemplateScriptsSyncApplier.resolve(
                    divergence, decision: .keepMine,
                    sourceDirectory: sourceDirectory, configDirectory: configDirectory,
                    templateDirectory: templateDirectory
                )
                unresolved.append(divergence.relativePath)
            }
        }

        switch SecurityTxtMigrationChecker.check(sourceDirectory: sourceDirectory) {
        case .nothingToDo:
            break
        case .silentBackfillMode(let mode):
            touched += SecurityTxtMigrationApplier.applyBackfill(mode: mode, sourceDirectory: sourceDirectory)
        case .silentAdopt:
            // The app already positively resolved this — marker-owned, or an unmarked file that
            // exactly matches the old generator's shape — so it applies the same way an
            // unmodified `scripts/` file silently refreshes, no decision needed even
            // interactively.
            touched += SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory: sourceDirectory)
        case .needsDecision:
            // Noninteractive default: Preserve. `SECURITY_TXT_MODE=manual` is still an explicit,
            // durable decision — it just never rewrites the file or touches `.gitignore` toward
            // "ignored."
            touched += SecurityTxtMigrationApplier.applyDecision(.preserve, sourceDirectory: sourceDirectory)
            unresolved.append("public/.well-known/security.txt")
        }

        let committed = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: touched, sourceDirectory: sourceDirectory, configDirectory: configDirectory,
            message: commitMessage
        )
        if !committed {
            await logCenter.append(
                source: source, stream: .stderr,
                text: "Existing-site migration wrote files but couldn't commit them — they'll be retried on the next open."
            )
        }
        if !unresolved.isEmpty {
            await logCenter.append(
                source: source, stream: .stdout,
                text: "Existing-site migration left \(unresolved.count) file(s) with unresolved ownership (kept as-is): \(unresolved.joined(separator: ", "))."
            )
        }
    }
}
```

- [ ] **Step 2: Write `ExistingSiteMigrationTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct ExistingSiteMigrationTests {
    private func tmpDirs() -> (source: URL, config: URL, template: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        let template = root.appendingPathComponent("Template")
        for d in [source, config, template] {
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
        return (source, config, template)
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    @Test func cleanSiteWithNothingToMigrateCommitsNothingAndLogsNothing() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("shared", to: template.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("shared", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // SECURITY_TXT_MODE must already be set — an empty `.site-config` would still trigger a
        // real (if silent) SecurityTxtMigrationChecker backfill write, which isn't "nothing to
        // migrate" and would spuriously exercise the commit path this test isn't about.
        try writeFile("SECURITY_TXT_MODE=disabled\n", to: source.appendingPathComponent(".site-config"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let lines = await logCenter.snapshot()
        #expect(lines.isEmpty)
    }

    @Test func unbaselinedCustomizedScriptFileIsPreservedAndReportedAsUnresolved() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("new template content", to: template.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("owner's content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("", to: source.appendingPathComponent(".site-config"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let unchanged = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(unchanged == "owner's content")
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("scripts/pre-deploy-check.ts") && $0.text.contains("unresolved ownership") })
    }

    @Test func divergedScriptFileStaysPreservedAcrossRepeatedRuns() async throws {
        // Regression test for the Critical finding from task review: the first run must record a
        // durable acknowledgement (via `TemplateScriptsSyncApplier.resolve(..., decision:
        // .keepMine, ...)`), not just skip the file — otherwise the checker's provisional
        // first-encounter baseline makes the *second* run misclassify the untouched-since-then
        // file as safe-to-refresh and silently overwrite it.
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("new template content", to: template.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("owner's content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("", to: source.appendingPathComponent(".site-config"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )
        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let stillUnchanged = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(stillUnchanged == "owner's content")
    }

    @Test func unmarkedSecurityTxtNeedingDecisionDefaultsToPreserveAndIsReported() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("SECURITY_CONTACT=security@example.com\n", to: source.appendingPathComponent(".site-config"))
        try writeFile("Contact: mailto:someone-else@example.com\n", to: source.appendingPathComponent("public/.well-known/security.txt"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let unchanged = try String(contentsOf: source.appendingPathComponent("public/.well-known/security.txt"), encoding: .utf8)
        #expect(unchanged == "Contact: mailto:someone-else@example.com\n")
        let siteConfig = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(siteConfig.contains("SECURITY_TXT_MODE=manual"))
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("public/.well-known/security.txt") })
    }

    @Test func silentBackfillsCommitWithoutAnyLoggedFinding() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("SECURITY_CONTACT=security@example.com\n", to: source.appendingPathComponent(".site-config"))
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let siteConfig = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(siteConfig.contains("SECURITY_TXT_MODE=generated"))
        let lines = await logCenter.snapshot()
        #expect(!lines.contains { $0.text.contains("unresolved") })
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter ExistingSiteMigrationTests`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/ExistingSiteMigration.swift Tests/AnglesiteCoreTests/ExistingSiteMigrationTests.swift
git commit -m "feat(#745): add noninteractive existing-site migration orchestrator"
```

---

## Task 9: `SecurityTxtMigrationModel` (AnglesiteApp presentation layer)

**Files:**
- Create: `Sources/AnglesiteApp/SecurityTxtMigrationModel.swift`
- Create: `Tests/AnglesiteAppTests/SecurityTxtMigrationModelTests.swift`

**Interfaces:**
- Consumes: `SecurityTxtMigrationApplier.Decision` (Task 6, `AnglesiteCore`).
- Produces: `@MainActor final class SecurityTxtMigrationModel: Identifiable { nonisolated let id: UUID; init(onDecision: @escaping (SecurityTxtMigrationApplier.Decision) -> Void); func adopt(); func preserve() }` — Task 10 (`SiteWindow` sheet) uses `adopt()`/`preserve()` by these exact names. No `matchesLegacyShape` property: `SecurityTxtMigrationChecker` (Task 5) only ever routes to `.needsDecision` — and therefore only ever presents this sheet — for a file that already failed the shape match (a match auto-applies via `.silentAdopt`), so there is nothing left to hint at by the time this model exists.

- [ ] **Step 1: Write `SecurityTxtMigrationModel.swift`**

```swift
import Foundation
import AnglesiteCore

/// Thin, `Identifiable` model driving the `security.txt` Adopt/Preserve sheet (design doc "UX").
/// Mirrors `DependencyUpdateModel`'s shape (one whole decision, not a per-row list like
/// `ScriptSyncModel`) since at most one `security.txt` file exists per site. Only ever presented
/// for `SecurityTxtMigrationPlan.needsDecision` — a file the checker could *not* positively
/// classify (a positive match auto-applies via `.silentAdopt` and never reaches this sheet).
@MainActor
final class SecurityTxtMigrationModel: Identifiable {
    nonisolated let id = UUID()
    private let onDecision: (SecurityTxtMigrationApplier.Decision) -> Void

    init(onDecision: @escaping (SecurityTxtMigrationApplier.Decision) -> Void) {
        self.onDecision = onDecision
    }

    func adopt() { onDecision(.adopt) }
    func preserve() { onDecision(.preserve) }
}
```

- [ ] **Step 2: Write `SecurityTxtMigrationModelTests.swift`**

```swift
import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

@MainActor
@Suite struct SecurityTxtMigrationModelTests {
    @Test func adoptForwardsTheAdoptDecision() {
        var decisions: [SecurityTxtMigrationApplier.Decision] = []
        let model = SecurityTxtMigrationModel { decisions.append($0) }
        model.adopt()
        #expect(decisions == [.adopt])
    }

    @Test func preserveForwardsThePreserveDecision() {
        var decisions: [SecurityTxtMigrationApplier.Decision] = []
        let model = SecurityTxtMigrationModel { decisions.append($0) }
        model.preserve()
        #expect(decisions == [.preserve])
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SecurityTxtMigrationModelTests`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/SecurityTxtMigrationModel.swift Tests/AnglesiteAppTests/SecurityTxtMigrationModelTests.swift
git commit -m "feat(#745): add SecurityTxtMigrationModel"
```

---

## Task 10: Wire into `SiteWindowModel` and `SiteWindow` (windowed path)

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (new property near the existing `scriptSyncModel` property; replace the `loadAndStart()` block from the `DependencySyncChecker.check` call through the end of the existing `TemplateScriptsSync` block — the exact current text is quoted in Step 2 below — with an expanded version)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (new sheet, inserted right after the existing `scriptSyncModel` sheet)

**Interfaces:**
- Consumes: `ExistingSiteMigrationCommitter.retryPendingCommit(sourceDirectory:configDirectory:message:)`/`.commit(touchedPaths:sourceDirectory:configDirectory:message:)` (Task 7), `SecurityTxtMigrationChecker.check(sourceDirectory:)` (Task 5), `SecurityTxtMigrationApplier.applyBackfill(mode:sourceDirectory:)`/`.applyDecision(_:sourceDirectory:)`/`.Decision` (Task 6), `SecurityTxtMigrationModel` (Task 9).
- Produces: `SiteWindowModel.securityTxtMigrationModel: SecurityTxtMigrationModel?` — a `.sheet(item:)`-driven property nothing downstream in this plan consumes.

No new automated test for this task, following the same precedent `TemplateScriptsSync`'s own wiring used (design doc's testing section; `Tests/AnglesiteAppTests/SiteWindowModelTests.swift:114` confirms `loadAndStart()` itself has never had a dedicated test — every piece it calls is already fully covered on its own). Verify via build and the manual QA steps below.

- [ ] **Step 1: Add the `securityTxtMigrationModel` property**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, right after the existing `scriptSyncModel` property declaration:

```swift
    /// Non-nil ⟺ the security.txt Adopt/Preserve sheet is presented (`.sheet(item:)`), set by the
    /// detection hook in `loadAndStart()` when `SecurityTxtMigrationChecker` finds an unmarked
    /// legacy file needing a decision (#745).
    var securityTxtMigrationModel: SecurityTxtMigrationModel?
```

- [ ] **Step 2: Replace the existing sync wiring block in `loadAndStart()`**

The current block runs from the `DependencySyncChecker.check` call through the end of the `TemplateScriptsSync` block (unchanged in this plan except for path accumulation), reproduced here as it exists today so the diff is unambiguous:

```swift
        if let templateURL = TemplateRuntime.bundledURL(), let runningVersion = AppVersion.current() {
            let offers = DependencySyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL,
                runningAppVersion: runningVersion
            )
            if !offers.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    dependencyUpdateModel = DependencyUpdateModel(offers: offers) { [weak self] accepted in
                        guard let self else { continuation.resume(); return }
                        if accepted {
                            do {
                                try DependencySyncApplier.apply(
                                    offers,
                                    sourceDirectory: resolved.sourceDirectory,
                                    configDirectory: resolved.configDirectory,
                                    runningAppVersion: runningVersion
                                )
                                self.preview.isUpdatingDependencies = true
                            } catch {
                                // package.json rewrite failed — nothing was written, so
                                // the site opens against its unchanged files. Leave
                                // isUpdatingDependencies false: this boot is a normal
                                // one, not a post-update one.
                            }
                        }
                        self.dependencyUpdateModel = nil
                        continuation.resume()
                    }
                }
            }
        }
        await AppKitConstraintStormMitigation.settle()
        if let templateURL = TemplateRuntime.resolve().url {
            let plan = TemplateScriptsSyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL
            )
            if !plan.toApply.isEmpty {
                do {
                    try TemplateScriptsSyncApplier.applyQueued(
                        plan.toApply,
                        sourceDirectory: resolved.sourceDirectory,
                        configDirectory: resolved.configDirectory,
                        templateDirectory: templateURL
                    )
                } catch {
                    Self.logger.error(
                        "scripts/ silent refresh failed for \(resolved.id, privacy: .public): \(String(describing: error), privacy: .public)"
                    )
                }
            }
            if !plan.divergences.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    scriptSyncModel = ScriptSyncModel(
                        divergences: plan.divergences,
                        onResolve: { [weak self] divergence, decision in
                            guard let self else { return false }
                            do {
                                try TemplateScriptsSyncApplier.resolve(
                                    divergence,
                                    decision: decision,
                                    sourceDirectory: resolved.sourceDirectory,
                                    configDirectory: resolved.configDirectory,
                                    templateDirectory: templateURL
                                )
                                return true
                            } catch {
                                Self.logger.error(
                                    "scripts/ divergence resolve failed for \(divergence.relativePath, privacy: .public): \(String(describing: error), privacy: .public)"
                                )
                                return false
                            }
                        },
                        onFinished: { [weak self] in
                            self?.scriptSyncModel = nil
                            continuation.resume()
                        }
                    )
                }
            }
        }
```

Replace it with:

```swift
        if let templateURL = TemplateRuntime.bundledURL(), let runningVersion = AppVersion.current() {
            let offers = DependencySyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL,
                runningAppVersion: runningVersion
            )
            if !offers.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    dependencyUpdateModel = DependencyUpdateModel(offers: offers) { [weak self] accepted in
                        guard let self else { continuation.resume(); return }
                        if accepted {
                            do {
                                try DependencySyncApplier.apply(
                                    offers,
                                    sourceDirectory: resolved.sourceDirectory,
                                    configDirectory: resolved.configDirectory,
                                    runningAppVersion: runningVersion
                                )
                                self.preview.isUpdatingDependencies = true
                            } catch {
                                // package.json rewrite failed — nothing was written, so
                                // the site opens against its unchanged files. Leave
                                // isUpdatingDependencies false: this boot is a normal
                                // one, not a post-update one.
                            }
                        }
                        self.dependencyUpdateModel = nil
                        continuation.resume()
                    }
                }
            }
        }
        await AppKitConstraintStormMitigation.settle()

        // #745: retry a commit an interrupted prior migration didn't finish, before looking for
        // any new work — otherwise a stale pending commit could sit alongside a fresh one.
        await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: resolved.sourceDirectory,
            configDirectory: resolved.configDirectory,
            message: "chore: migrate existing site to current template baseline"
        )
        var migrationTouchedPaths: [String] = []
        // `SiteRuntimeState.ready` carries associated values (siteID/url/workersDevURL), so this
        // is a pattern match, not `== .ready` (`Sources/AnglesiteCore/SiteRuntime.swift:15`).
        let wasRuntimeAlreadyReady: Bool = {
            if case .ready = preview.state { return true }
            return false
        }()

        if let templateURL = TemplateRuntime.resolve().url {
            let plan = TemplateScriptsSyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL
            )
            if !plan.toApply.isEmpty {
                do {
                    try TemplateScriptsSyncApplier.applyQueued(
                        plan.toApply,
                        sourceDirectory: resolved.sourceDirectory,
                        configDirectory: resolved.configDirectory,
                        templateDirectory: templateURL
                    )
                    migrationTouchedPaths += plan.toApply.map(\.relativePath)
                } catch {
                    Self.logger.error(
                        "scripts/ silent refresh failed for \(resolved.id, privacy: .public): \(String(describing: error), privacy: .public)"
                    )
                }
            }
            if !plan.divergences.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    scriptSyncModel = ScriptSyncModel(
                        divergences: plan.divergences,
                        onResolve: { [weak self] divergence, decision in
                            guard let self else { return false }
                            do {
                                try TemplateScriptsSyncApplier.resolve(
                                    divergence,
                                    decision: decision,
                                    sourceDirectory: resolved.sourceDirectory,
                                    configDirectory: resolved.configDirectory,
                                    templateDirectory: templateURL
                                )
                                if decision == .update {
                                    migrationTouchedPaths.append(divergence.relativePath)
                                }
                                return true
                            } catch {
                                Self.logger.error(
                                    "scripts/ divergence resolve failed for \(divergence.relativePath, privacy: .public): \(String(describing: error), privacy: .public)"
                                )
                                return false
                            }
                        },
                        onFinished: { [weak self] in
                            self?.scriptSyncModel = nil
                            continuation.resume()
                        }
                    )
                }
            }
        }

        switch SecurityTxtMigrationChecker.check(sourceDirectory: resolved.sourceDirectory) {
        case .nothingToDo:
            break
        case .silentBackfillMode(let mode):
            migrationTouchedPaths += SecurityTxtMigrationApplier.applyBackfill(
                mode: mode, sourceDirectory: resolved.sourceDirectory
            )
        case .silentAdopt:
            // Already positively resolved by the checker (marker-owned, or an exact match against
            // the old generator's shape) — applies the same way an unmodified `scripts/` file
            // silently refreshes above, no decision needed even interactively.
            migrationTouchedPaths += SecurityTxtMigrationApplier.applyDecision(
                .adopt, sourceDirectory: resolved.sourceDirectory
            )
        case .needsDecision:
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                securityTxtMigrationModel = SecurityTxtMigrationModel { [weak self] decision in
                    guard let self else { continuation.resume(); return }
                    migrationTouchedPaths += SecurityTxtMigrationApplier.applyDecision(
                        decision, sourceDirectory: resolved.sourceDirectory
                    )
                    self.securityTxtMigrationModel = nil
                    continuation.resume()
                }
            }
        }

        let migrationCommitted = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: migrationTouchedPaths,
            sourceDirectory: resolved.sourceDirectory,
            configDirectory: resolved.configDirectory,
            message: "chore: migrate existing site to current template baseline"
        )
        if !migrationCommitted {
            // Files are correctly migrated on disk (git-recoverable either way) but the commit
            // itself failed — surfaced per the design doc's "surface partial failures"
            // requirement rather than silently retrying forever with no signal. The pending-commit
            // record (Task 7) already ensures the next site-open retries it.
            Self.logger.error(
                "existing-site migration wrote files for \(resolved.id, privacy: .public) but couldn't commit them — will retry on next open"
            )
        }
        if migrationCommitted, !migrationTouchedPaths.isEmpty, wasRuntimeAlreadyReady {
            // The common case (a fresh site-open) hasn't started the runtime yet at this point in
            // `loadAndStart()`, so `preview.open()` below naturally picks up the migrated files.
            // This only fires for the narrow case where the runtime was already running before
            // this pass began (design doc "Runtime refresh").
            preview.restartDevServer()
        }
```

Note: `migrationTouchedPaths` is captured by the two `onResolve`/decision closures above as a mutable local — Swift closures capture a local `var` by reference, so appends inside either closure are visible to the final `commit(touchedPaths:)` call. `decision == .update` requires `TemplateScriptsSyncApplier.DivergenceDecision` to be `Equatable` — it already is (`Sources/AnglesiteCore/TemplateScriptsSyncApplier.swift`).

- [ ] **Step 3: Add the sheet in `SiteWindow.swift`**

In `Sources/AnglesiteApp/SiteWindow.swift`, right after the existing `.sheet(item: $bindableModel.scriptSyncModel)` block's closing `}`:

```swift
        .sheet(item: $bindableModel.securityTxtMigrationModel) { migrationModel in
            NavigationStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Hand-Authored security.txt Found")
                        .font(.headline)
                    Text("This site publishes a security.txt Anglesite didn't generate. Adopt it so Anglesite keeps it current going forward, or leave it as yours to maintain.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Preserve as Hand-Authored") { migrationModel.preserve() }
                        Spacer()
                        Button("Adopt as Generated") { migrationModel.adopt() }
                            .buttonStyle(.borderedProminent)
                    }
                }
                .padding()
                .navigationTitle("security.txt")
            }
            .frame(minWidth: 420, minHeight: 220)
            // Mirrors the scripts-sync sheet immediately above: `loadAndStart()` suspends on a
            // `CheckedContinuation` that only Adopt/Preserve resume. Block outside-tap/swipe
            // dismissal so those two buttons are structurally the only way out.
            .interactiveDismissDisabled()
        }
```

- [ ] **Step 4: Build to confirm it compiles**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`. If `Anglesite.xcodeproj` doesn't exist yet in this worktree, run `xcodegen generate` first.

- [ ] **Step 5: Run the full Swift package test suite**

Run: `swift test --package-path .`
Expected: PASS — every test from Tasks 1–9 plus the existing suite, none broken by the new wiring.

- [ ] **Step 6: Manual QA**

Using a scaffolded site (or a temp copy of one), simulate each legacy scenario and reopen the site in Anglesite each time:
- **Unbaselined, hand-edited script file**: delete `Config/template-scripts-baseline.json`, hand-edit `Source/scripts/pre-deploy-check.ts` (append a comment), and edit the app-bundled `Resources/Template/scripts/pre-deploy-check.ts` so it differs too. Confirm the "Site Scripts Customized" sheet appears (not a silent overwrite) and that "Update This File"/"Keep My Version" both work as before.
- **Unmarked legacy `security.txt` matching the old shape**: set `SECURITY_CONTACT`/`SITE_URL` in `.site-config`, remove any `SECURITY_TXT_MODE` line, and hand-write `public/.well-known/security.txt` to exactly the pre-#743 shape (`Contact:`/`Expires:`/`Canonical:`, matching current settings, no marker). Confirm **no sheet appears** — this is the `.silentAdopt` path — and that `SECURITY_TXT_MODE=generated` is set, the marker is prepended, and the `.gitignore` line is added automatically; confirm the next dev-server build regenerates the file with current formatting.
- **Unmarked `security.txt` not matching**: same setup, but with a different contact in the file than in `.site-config`. Confirm the "Hand-Authored security.txt Found" sheet **does** appear this time (the `.needsDecision` path); confirm Preserve sets `SECURITY_TXT_MODE=manual`, leaves the file byte-for-byte unchanged, and does not gitignore it; confirm Adopt (on a fresh copy of this same scenario) sets `SECURITY_TXT_MODE=generated` and prepends the marker despite the mismatch, since Adopt is always available as an explicit owner override.
- **Git commit**: after any of the above, confirm `git -C Source log -1` shows a new `chore: migrate existing site to current template baseline` commit covering exactly the files that changed.
- **Clean site**: a site with no customizations and `SECURITY_TXT_MODE` already set opens with no sheets and no new commit.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#745): wire existing-site migration into site-open flow"
```

---

## Task 11: Wire into `SiteOperations` (headless path)

**Files:**
- Modify: `Sources/AnglesiteCore/SiteOperations.swift:60-68` (the `deploy(site:onProgress:)` function)
- Modify: `Tests/AnglesiteCoreTests/SiteOperationsTests.swift` (new test)

**Interfaces:**
- Consumes: `ExistingSiteMigration.runNoninteractively(sourceDirectory:configDirectory:templateDirectory:source:)` (Task 8).

- [ ] **Step 1: Add a call to `ExistingSiteMigration.runNoninteractively` before the deploy proceeds**

In `Sources/AnglesiteCore/SiteOperations.swift`, replace:

```swift
    public func deploy(site: SiteStore.Site, onProgress: ProgressHandler? = nil) async -> DeployCommand.Result {
        do {
            return try await SiteAccess.withScopedAccess(to: site, in: store) { url in
                await self.deployWithWorkerComposition(site: site, siteDirectory: url, onProgress: onProgress)
            }
        } catch let SiteAccess.AccessError.noGrant(message) {
            return .failed(reason: message, exitCode: nil)
        } catch {
            return .failed(reason: error.localizedDescription, exitCode: nil)
        }
    }
```

with:

```swift
    public func deploy(site: SiteStore.Site, onProgress: ProgressHandler? = nil) async -> DeployCommand.Result {
        do {
            return try await SiteAccess.withScopedAccess(to: site, in: store) { url in
                // #745: this headless path (App Intents/Shortcuts/Siri) skipped both
                // DependencySync and TemplateScriptsSync entirely before this — a site only ever
                // operated on via Shortcuts never got migrated. Runs ahead of the deploy build
                // with every decision defaulted to Preserve (design doc "Noninteractive flows");
                // never blocks the deploy itself.
                await ExistingSiteMigration.runNoninteractively(
                    sourceDirectory: url,
                    configDirectory: site.configDirectory,
                    templateDirectory: TemplateRuntime.bundledURL(),
                    source: "deploy:\(site.id)"
                )
                return await self.deployWithWorkerComposition(site: site, siteDirectory: url, onProgress: onProgress)
            }
        } catch let SiteAccess.AccessError.noGrant(message) {
            return .failed(reason: message, exitCode: nil)
        } catch {
            return .failed(reason: error.localizedDescription, exitCode: nil)
        }
    }
```

**Note on why this task's test targets `security.txt`, not `scripts/`:** `SiteOperations.deploy` runs inside a `swift test` (SwiftPM) process, where `TemplateRuntime.bundledURL()` (`Bundle.main`) can't resolve the app's `Resources/Template` — so `ExistingSiteMigration.runNoninteractively`'s `templateDirectory` argument is `nil` in this test environment and its script-file branch is a no-op by design (Task 8's guard). `SecurityTxtMigrationChecker.check(sourceDirectory:)` has no such dependency — it only reads the site's own `.site-config`/`public/.well-known/security.txt` — so it's the part of this task's wiring an automated test here can actually exercise. The `scripts/` branch is covered by Task 10's manual QA instead, in the real app where the bundle resolves.

- [ ] **Step 2: Add a test confirming the migration runs before deploy**

In `Tests/AnglesiteCoreTests/SiteOperationsTests.swift`, add, reusing this file's existing `temporaryPackage()` and `makeSite(name:packageURL:)` fixture helpers and the `SocialWorkerFactory`/`SocialWorkerRecorder` pair already defined at the bottom of the file (the same pattern `headlessDeployWithNoActiveWorkers` above uses):

```swift
    @Test("headless deploy backfills SECURITY_TXT_MODE before the deploy proceeds (#745)")
    func headlessDeployBackfillsSecurityTxtMode() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        try "SECURITY_CONTACT=security@example.com\n".write(
            to: site.sourceDirectory.appendingPathComponent(".site-config"),
            atomically: true, encoding: .utf8
        )
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: SocialWorkerRecorder()), store: throwawayStore())

        let result = await ops.deploy(site: site)

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        let config = try String(contentsOf: site.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
    }
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SiteOperationsTests`
Expected: PASS — the new test plus every pre-existing one in this file, unaffected.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/SiteOperations.swift Tests/AnglesiteCoreTests/SiteOperationsTests.swift
git commit -m "feat(#745): run existing-site migration before a headless deploy"
```

---

## Task 12: Final verification and String Catalog sync

**Files:**
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (String Catalog sync output, if the CLI recipe below finds new keys)

**Interfaces:** None.

- [ ] **Step 1: Run the full Swift package test suite one more time**

Run: `swift test --package-path .`
Expected: PASS, no regressions across every task in this plan.

- [ ] **Step 2: Build the app target**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Sync the new user-visible strings into the String Catalog**

Task 10 introduced several new literals ("Hand-Authored security.txt Found", "Adopt as Generated", "Preserve as Hand-Authored", the two explanation strings). Per `CONTRIBUTING.md`'s String Catalog step, a CLI-only build emits `.stringsdata` but never merges it into `Localizable.xcstrings`. Run, scoped to this worktree's own build:

```bash
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

- [ ] **Step 4: Review the resulting diff**

Run: `git diff Sources/AnglesiteApp/Localizable.xcstrings`
Expected: only the new keys from Task 10 added, no unrelated keys touched or removed. If the diff contains anything else (keys from other in-flight branches, or the catalog emptied out), do **not** commit it — re-run Step 3 after a clean build (`xcodebuild ... clean build`) instead, per `CONTRIBUTING.md`'s caveat.

- [ ] **Step 5: Commit the catalog update, if any**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(#745): sync String Catalog for existing-site migration sheets"
```

If Step 4 found no diff (e.g. an interactive Xcode session already merged these strings during Task 10's build), skip this commit.

- [ ] **Step 6: Re-check against CONTRIBUTING.md before opening the PR**

Re-read `CONTRIBUTING.md` ▸ "Commits and pull requests" and confirm: subject lines ≤72 characters (all commits above already are), the PR body uses `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan), and the PR body includes `Closes #745`. This issue is app-only (template + Swift changes, no MCP message schema change), so the Paired PR check section should say so explicitly rather than being left blank.
