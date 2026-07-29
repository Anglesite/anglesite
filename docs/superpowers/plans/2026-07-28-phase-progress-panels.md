# Three-Panel Phase Progress Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain progress indicator during dev-server startup and deploy with a three-panel, cumulative-fill strip inspired by AOL's classic sign-on animation.

**Architecture:** Two small, pure phase→panel-count mappings live in `AnglesiteCore` (one for `StartupPhase`, one new `DeployPanelProgress` for deploy milestones) and are unit-tested there. A single reusable SwiftUI view, `PhaseProgressStrip`, renders the three cells in two sizes (full/compact) and lives in `AnglesiteApp`. It's wired into `StartupProgressView` (full size) and `DeployDrawerView` (compact size, replacing the `.running`-case spinner), each driven by its own pure mapping.

**Tech Stack:** Swift 6.4, SwiftPM (`AnglesiteCore`, `AnglesiteAppCore`), SwiftUI, Swift Testing.

## Global Constraints

- This is a cumulative-fill strip — a cell that becomes filled **stays** filled at every later phase. It is never a single badge that swaps in place.
- No settings toggle — this redesign is always on.
- Cell 1 glyph: 🚶. Cell 2 glyph: 🏃. Cell 3: 👥 rendered over the real app icon (`NSApp.applicationIconImage`), not a generic glyph alone.
- Status/caption text reuses each surface's existing phase-message strings (`StartupProgressModel.message`, `DeployModel.currentMilestone`) — no new copy is introduced by this plan.
- `DeployPanelProgress` must NOT be built on top of `DeployDockProgress.fraction(forPhase:)` — that table has no entry for `websubPing`/`activityPubBackfill` and would regress the panel count. It is a small, self-contained mapping over the known milestone-phase strings.
- Deploy's terminal states (`.failed`, `.blocked`, `.workerNameConflict`, `.webmentionPaidPlanConfirmationNeeded`) keep their existing icon treatment in `DeployDrawerView` — the strip only replaces the `.running`-case spinner.
- `PhaseProgressStrip` (the SwiftUI view) stays untested directly — this codebase's convention for presentational views (verified by successful build, matching `StartupProgressView`/`DeployDrawerView` themselves, which also have no dedicated view tests).
- The two pure mapping functions (`StartupPhase.panelFillCount`, `DeployPanelProgress.filledCount`) DO get unit tests, following `StartupProgressEstimatorTests`'s existing style.
- Conventional commit subjects, ≤72 characters.

---

### Task 1: `StartupPhase.panelFillCount` (`AnglesiteCore`)

**Files:**
- Modify: `Sources/AnglesiteCore/StartupProgressEstimator.swift:40-48` (the `StartupPhase` enum)
- Test: `Tests/AnglesiteCoreTests/StartupProgressEstimatorTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StartupPhase.panelFillCount: Int` (0...3). Task 5 (`StartupProgressView`) reads `model.phase.panelFillCount`.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/StartupProgressEstimatorTests.swift` (anywhere in the `StartupProgressEstimatorTests` struct):

```swift
    @Test("panelFillCount maps each phase to the three-panel strip's fill count")
    func panelFillCountMapsPhases() {
        #expect(StartupPhase.idle.panelFillCount == 0)
        #expect(StartupPhase.launching.panelFillCount == 1)
        #expect(StartupPhase.building.panelFillCount == 1)
        #expect(StartupPhase.connecting.panelFillCount == 2)
        #expect(StartupPhase.ready.panelFillCount == 3)
        #expect(StartupPhase.failed.panelFillCount == 0)
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --package-path . --filter StartupProgressEstimatorTests`
Expected: FAIL to build — `panelFillCount` is not a member of `StartupPhase`.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/StartupProgressEstimator.swift`, add this computed property to the `StartupPhase` enum, right after the existing `message` property (currently ending at line 47, just before the enum's closing `}`):

```swift
    /// How many of the three phase-progress-strip panels (see
    /// docs/superpowers/specs/2026-07-28-phase-progress-panels-design.md) should read as filled
    /// for this phase. Cumulative: once a panel fills at an earlier phase it stays filled at every
    /// later phase — this only ever needs to name the count for the *current* phase because the
    /// view renders "filled" as "index < filledCount", not a stateful toggle.
    public var panelFillCount: Int {
        switch self {
        case .idle, .failed:        return 0
        case .launching, .building: return 1
        case .connecting:           return 2
        case .ready:                return 3
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --package-path . --filter StartupProgressEstimatorTests`
Expected: PASS — including the new test.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/StartupProgressEstimator.swift Tests/AnglesiteCoreTests/StartupProgressEstimatorTests.swift
git commit -m "feat: map StartupPhase to phase-progress-strip fill count"
```

---

### Task 2: `DeployPanelProgress` (`AnglesiteCore`)

**Files:**
- Create: `Sources/AnglesiteCore/DeployPanelProgress.swift`
- Test: `Tests/AnglesiteCoreTests/DeployPanelProgressTests.swift`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `public enum DeployPanelProgress` with `public static func filledCount(currentMilestonePhase: String?, succeeded: Bool) -> Int`. Task 3 (`DeployModel`) provides the milestone phase string; Task 6 (`DeployDrawerView`) calls this function.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/DeployPanelProgressTests.swift`:

```swift
import Testing
@testable import AnglesiteCore

struct DeployPanelProgressTests {

    @Test("No milestone yet reads as zero filled panels")
    func noMilestone() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: nil, succeeded: false) == 0)
    }

    @Test("preflightScan and building read as one filled panel")
    func earlyMilestones() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "preflightScan", succeeded: false) == 1)
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "building", succeeded: false) == 1)
    }

    @Test("deploying and every later milestone read as two filled panels")
    func lateMilestones() {
        let phases = ["deploying", "finalizing", "webmentions", "syndicating", "websubPing", "activityPubBackfill"]
        for phase in phases {
            #expect(DeployPanelProgress.filledCount(currentMilestonePhase: phase, succeeded: false) == 2)
        }
    }

    @Test("An unrecognized milestone string reads forward as two filled panels, not back to zero")
    func unrecognizedMilestoneDefaultsForward() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "someFutureMilestone", succeeded: false) == 2)
    }

    @Test("succeeded always reads as three filled panels, regardless of milestone")
    func succeededWins() {
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: "preflightScan", succeeded: true) == 3)
        #expect(DeployPanelProgress.filledCount(currentMilestonePhase: nil, succeeded: true) == 3)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter DeployPanelProgressTests`
Expected: FAIL to build — `DeployPanelProgress` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/DeployPanelProgress.swift`:

```swift
import Foundation

/// Maps a deploy's current milestone to how many of the three phase-progress-strip panels
/// (see docs/superpowers/specs/2026-07-28-phase-progress-panels-design.md) should read as
/// filled.
///
/// Deliberately NOT built on `DeployDockProgress.fraction(forPhase:)`
/// (`Sources/AnglesiteCore/CompletionNotice.swift`): that table has no entry for
/// `websubPing`/`activityPubBackfill` (returns `nil`, meant for "don't move the Dock tile"
/// semantics), which would regress this panel count from 2 back to 1 on those two late-stage
/// milestones. This is a small, self-contained switch over the known milestone-phase strings
/// instead, with an unrecognized phase defaulting forward to 2 rather than back to 1 — a milestone
/// this function doesn't recognize by name is still assumed to be past "deploying," since new
/// milestones only ever get added after that step in practice.
public enum DeployPanelProgress {
    /// `succeeded` takes priority — a finished deploy always shows all three panels filled,
    /// regardless of the last milestone phase seen.
    public static func filledCount(currentMilestonePhase phase: String?, succeeded: Bool) -> Int {
        if succeeded { return 3 }
        switch phase {
        case nil: return 0
        case "preflightScan", "building": return 1
        default: return 2
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter DeployPanelProgressTests`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DeployPanelProgress.swift Tests/AnglesiteCoreTests/DeployPanelProgressTests.swift
git commit -m "feat: map deploy milestones to phase-progress-strip fill count"
```

---

### Task 3: Track the milestone's phase id on `DeployModel`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift` — property declaration near line 35, and 7 assignment sites (listed below)

**Interfaces:**
- Consumes: `OperationProgress.phase: String` (existing, `Sources/AnglesiteCore/OperationProgress.swift:17`).
- Produces: `DeployModel.currentMilestonePhase: String?`. Task 6 (`DeployDrawerView`) reads this and passes it to `DeployPanelProgress.filledCount(currentMilestonePhase:succeeded:)`.

`DeployModel.currentMilestone` (existing) holds the human-readable *label* ("Deploying to production…") — `DeployPanelProgress` needs the stable *phase id* ("deploying") instead, which `DeployModel` doesn't currently expose. This task adds a sibling property tracking it, kept in lockstep with `currentMilestone` at every site that sets or clears it.

No new tests for this task — `currentMilestone` itself (the property this mirrors) has no dedicated test coverage in `Tests/AnglesiteAppTests/DeployModelTests.swift` today either; the full suite passing is the verification.

- [ ] **Step 1: Add the property**

In `Sources/AnglesiteApp/DeployModel.swift`, find:

```swift
    private(set) var currentMilestone: String?
```

Change to:

```swift
    private(set) var currentMilestone: String?
    /// The stable milestone-phase id (`OperationProgress.phase`, e.g. `"deploying"`) behind
    /// `currentMilestone`'s human-readable label — kept in lockstep with it everywhere it's set
    /// or cleared. `DeployDrawerView` feeds this to `DeployPanelProgress.filledCount(...)`.
    private(set) var currentMilestonePhase: String?
```

- [ ] **Step 2: Set it alongside every `currentMilestone = progress.label` assignment**

There are two sites. First, find:

```swift
                    onProgress: { [weak self] progress in
                        Task { @MainActor in
                            self?.currentMilestone = progress.label
                            self?.onMilestone?(siteID, progress)
                        }
                    }
```

Change to:

```swift
                    onProgress: { [weak self] progress in
                        Task { @MainActor in
                            self?.currentMilestone = progress.label
                            self?.currentMilestonePhase = progress.phase
                            self?.onMilestone?(siteID, progress)
                        }
                    }
```

Second, find:

```swift
    private func emitPostDeployMilestone(_ progress: OperationProgress, siteID: String) {
        currentMilestone = progress.label
        onMilestone?(siteID, progress)
    }
```

Change to:

```swift
    private func emitPostDeployMilestone(_ progress: OperationProgress, siteID: String) {
        currentMilestone = progress.label
        currentMilestonePhase = progress.phase
        onMilestone?(siteID, progress)
    }
```

- [ ] **Step 3: Clear it alongside every `currentMilestone = nil` reset**

There are five sites, all of the literal form `currentMilestone = nil` (two different indentation levels — 8 spaces at two sites, 12 spaces at three sites). For **every** occurrence of the line `currentMilestone = nil` in this file, add a `currentMilestonePhase = nil` line immediately after it, matching that occurrence's exact indentation. Use `grep -n "currentMilestone = nil" Sources/AnglesiteApp/DeployModel.swift` to find all five current line numbers before editing (line numbers shift after each edit, so re-run the grep after each one, or edit from the bottom of the file upward so earlier line numbers stay valid).

For example, one site (8-space indent) looks like:

```swift
        logLines = []
        currentMilestone = nil
        failureSummary = nil
```

becomes:

```swift
        logLines = []
        currentMilestone = nil
        currentMilestonePhase = nil
        failureSummary = nil
```

Another site (12-space indent) looks like:

```swift
            _ = await logTask.value
            currentMilestone = nil
            workerNameConflictPresented = false
```

becomes:

```swift
            _ = await logTask.value
            currentMilestone = nil
            currentMilestonePhase = nil
            workerNameConflictPresented = false
```

Apply the same pattern (insert `currentMilestonePhase = nil` at matching indentation, immediately after `currentMilestone = nil`) at all five sites. When done, `grep -c "currentMilestonePhase = nil" Sources/AnglesiteApp/DeployModel.swift` must report `5`, and `grep -c "currentMilestone = nil" Sources/AnglesiteApp/DeployModel.swift` must also still report `5` (unchanged count — you added lines, not replaced them).

- [ ] **Step 4: Run the full test suite and build**

Run: `swift test --package-path .`
Expected: PASS — no regressions.

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift
git commit -m "feat: track deploy milestone phase id alongside its label"
```

---

### Task 4: `PhaseProgressStrip` SwiftUI view (`AnglesiteApp`)

**Files:**
- Create: `Sources/AnglesiteApp/PhaseProgressStrip.swift`

**Interfaces:**
- Consumes: `NSApp.applicationIconImage` (AppKit, already used the same way at `Sources/AnglesiteApp/DockProgressController.swift:61`).
- Produces: `struct PhaseProgressStrip: View` with `init(filledCount: Int, size: PhaseProgressStrip.Size = .full)` and `enum PhaseProgressStrip.Size { case full, compact }`. Task 5 (`StartupProgressView`) uses `.full` (the default); Task 6 (`DeployDrawerView`) uses `.compact`.

No tests for this task — presentational SwiftUI view, matches this codebase's convention (`StartupProgressView`/`DeployDrawerView` also have no dedicated view tests). Verified by successful build.

- [ ] **Step 1: Write the implementation**

Create `Sources/AnglesiteApp/PhaseProgressStrip.swift`:

```swift
import SwiftUI
import AppKit

/// Three-panel cumulative-fill progress indicator inspired by AOL's classic sign-on animation
/// (see docs/superpowers/specs/2026-07-28-phase-progress-panels-design.md): three fixed cells
/// that light up left-to-right as named phases complete and *stay* lit — never a single badge
/// that swaps in place. The third cell shows the app's own icon behind a "group" glyph, echoing
/// the reference animation's people-gathered-at-the-logo composition.
struct PhaseProgressStrip: View {
    /// 0...3. Cells at index `< filledCount` render filled/tinted; the rest render dimmed.
    let filledCount: Int
    var size: Size = .full

    enum Size {
        case full, compact

        var cellDimension: CGFloat {
            switch self {
            case .full: return 56
            case .compact: return 18
            }
        }

        var glyphFontSize: CGFloat {
            switch self {
            case .full: return 28
            case .compact: return 10
            }
        }

        var cornerRadius: CGFloat {
            switch self {
            case .full: return 10
            case .compact: return 4
            }
        }

        var spacing: CGFloat {
            switch self {
            case .full: return 8
            case .compact: return 3
            }
        }
    }

    var body: some View {
        HStack(spacing: size.spacing) {
            cell(glyph: "🚶", filled: filledCount >= 1)
            cell(glyph: "🏃", filled: filledCount >= 2)
            groupCell(filled: filledCount >= 3)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Progress: \(filledCount) of 3 steps complete")
    }

    private func cell(glyph: String, filled: Bool) -> some View {
        Text(glyph)
            .font(.system(size: size.glyphFontSize))
            .opacity(filled ? 1 : 0.35)
            .frame(width: size.cellDimension, height: size.cellDimension)
            .background(cellBackground(filled: filled))
            .overlay(cellBorder(filled: filled))
            .animation(.easeInOut(duration: 0.2), value: filled)
    }

    private func groupCell(filled: Bool) -> some View {
        ZStack {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size.cellDimension * 0.7, height: size.cellDimension * 0.7)
                .opacity(filled ? 1 : 0.35)
            Text("👥")
                .font(.system(size: size.glyphFontSize))
                .opacity(filled ? 1 : 0.35)
        }
        .frame(width: size.cellDimension, height: size.cellDimension)
        .background(cellBackground(filled: filled))
        .overlay(cellBorder(filled: filled))
        .animation(.easeInOut(duration: 0.2), value: filled)
    }

    private func cellBackground(filled: Bool) -> some View {
        RoundedRectangle(cornerRadius: size.cornerRadius)
            .fill(filled ? Color.accentColor.opacity(0.18) : Color(nsColor: .quaternaryLabelColor).opacity(0.12))
    }

    private func cellBorder(filled: Bool) -> some View {
        RoundedRectangle(cornerRadius: size.cornerRadius)
            .strokeBorder(filled ? Color.accentColor.opacity(0.5) : Color.secondary.opacity(0.25))
    }
}
```

- [ ] **Step 2: Regenerate the Xcode project and build**

Run: `xcodegen generate`
Expected: regenerates `Anglesite.xcodeproj` to pick up the new file.

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/PhaseProgressStrip.swift
git commit -m "feat: add three-panel phase progress strip view"
```

---

### Task 5: Wire the strip into dev-server startup (`StartupProgressView`)

**Files:**
- Modify: `Sources/AnglesiteApp/StartupProgressView.swift:13-18`

**Interfaces:**
- Consumes: `StartupPhase.panelFillCount` (Task 1), `PhaseProgressStrip` (Task 4), `StartupProgressModel.phase: StartupPhase` (existing, already non-private).
- Produces: no new interface — a visual addition to an existing view.

- [ ] **Step 1: Insert the strip**

In `Sources/AnglesiteApp/StartupProgressView.swift`, change:

```swift
    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
            ProgressView(value: model.fraction)
                .progressViewStyle(.linear)
                .frame(maxWidth: 320)
```

to:

```swift
    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
            PhaseProgressStrip(filledCount: model.phase.panelFillCount)
            ProgressView(value: model.fraction)
                .progressViewStyle(.linear)
                .frame(maxWidth: 320)
```

Everything else in the file (the message `Text`, the `Show Logs` button, the `.frame`/`.animation` modifiers) stays unchanged.

- [ ] **Step 2: Build**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/StartupProgressView.swift
git commit -m "feat: show the phase progress strip during dev-server startup"
```

---

### Task 6: Wire the strip into deploy (`DeployDrawerView`)

**Files:**
- Modify: `Sources/AnglesiteApp/DeployDrawerView.swift:76-94` (`statusIcon`), and the header's title `VStack` (currently lines 41-51)

**Interfaces:**
- Consumes: `DeployPanelProgress.filledCount(currentMilestonePhase:succeeded:)` (Task 2), `PhaseProgressStrip` with `.compact` size (Task 4), `DeployModel.currentMilestonePhase`/`currentMilestone` (Task 3, existing).
- Produces: no new interface.

- [ ] **Step 1: Replace the `.running`-case spinner with the compact strip**

In `Sources/AnglesiteApp/DeployDrawerView.swift`, change:

```swift
    @ViewBuilder
    private var statusIcon: some View {
        switch model.phase {
        case .running:
            ProgressView().controlSize(.small)
                .accessibilityLabel("Deploying")
        case .succeeded:
```

to:

```swift
    @ViewBuilder
    private var statusIcon: some View {
        switch model.phase {
        case .running:
            PhaseProgressStrip(
                filledCount: DeployPanelProgress.filledCount(
                    currentMilestonePhase: model.currentMilestonePhase, succeeded: false
                ),
                size: .compact
            )
            .accessibilityLabel("Deploying")
        case .succeeded:
```

- [ ] **Step 2: Surface the milestone text next to the title**

In the same file, find the header's title `VStack` (the one containing `Text(headerTitle)`):

```swift
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle).font(.headline)
                if let subtitle = headerSubtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                if case .succeeded = model.phase, case .dirty = model.sourceBundleStatus {
                    Text("Code changes not yet deployed to the CMS bundle.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
```

Change to:

```swift
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle).font(.headline)
                if let subtitle = headerSubtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                if case .running = model.phase, let milestone = model.currentMilestone {
                    Text(milestone).font(.caption).foregroundStyle(.secondary)
                }
                if case .succeeded = model.phase, case .dirty = model.sourceBundleStatus {
                    Text("Code changes not yet deployed to the CMS bundle.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
```

(`headerSubtitle` already returns `nil` for `.running`, so this doesn't create a duplicate line — it's the only text shown alongside the title while a deploy is running.)

- [ ] **Step 3: Build**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/DeployDrawerView.swift
git commit -m "feat: show the phase progress strip during deploy"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift test suite**

Run: `swift test --package-path .`
Expected: PASS — all targets, including the new `StartupProgressEstimatorTests` case and `DeployPanelProgressTests`.

- [ ] **Step 2: Full app build**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Manual smoke check**

Open the built app, open or restart a site's dev server, and confirm: the three-panel strip appears above the progress bar, cell 1 fills while starting/building, cell 2 fills once connecting, cell 3 (app icon + 👥) fills only once ready — and none of the filled cells un-fill along the way. Trigger a deploy and confirm the compact strip appears in place of the drawer's old spinner, follows the same fill pattern through preflight/build/deploy/finalize, and the milestone text next to the title updates as it goes. Confirm a deploy failure still shows the existing red exclamation icon, not the strip.

- [ ] **Step 4: Confirm no stray changes**

Run: `git status --short`
Expected: clean (everything from Tasks 1–6 already committed).
