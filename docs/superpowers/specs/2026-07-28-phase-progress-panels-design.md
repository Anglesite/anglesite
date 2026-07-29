# Three-panel phase progress strip — design

**Issue:** none tracked yet — small, additive UI feature, pairs with the dial-up sound effect (docs/superpowers/specs/2026-07-28-dialup-modem-sound-effect-design.md).
**Date:** 2026-07-28
**Status:** Approved design; ready for implementation planning.

## Goal

Replace the plain linear-progress-bar-only presentation of "loading" state (dev-server startup, deploy) with a nostalgic three-panel step indicator inspired by AOL's classic dial-up sign-on animation — three fixed boxes that fill in left-to-right as real, named phases complete, with the app's own icon appearing in the final box. Always-on (no settings toggle, unlike the dial-up sound) — this is a visual redesign, not a disruptive effect.

## Reference

AOL's sign-on sequence showed three permanently-visible boxes below the "AMERICA ONLINE" logo:

1. Box 1: a plain running-figure icon — fills in first ("Dialing…")
2. Box 2: the same figure with motion lines — fills in second, box 1 stays filled ("Connecting…")
3. Box 3: a group of people clustered at the base of the AOL triangle logo — fills in last, boxes 1-2 stay filled ("Connected!")

Each box, once filled, **stays filled** — this is a cumulative 3-step breadcrumb, not a single badge that swaps in place. A status caption below names the current step, and a horizontal rule (the existing determinate progress bar, in this adaptation) sits under that.

## Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Mechanic | Cumulative fill — each box lights up and stays lit once its milestone is reached, not a single highlighted box that moves |
| Where | Both dev-server startup (`StartupProgressView`) and deploy (`DeployDrawerView`) |
| Gating | Always on — no settings toggle |
| Icon style | Literal Unicode/emoji glyphs (🚶 / 🏃 / 👥), not SF Symbols — deliberately distinct from the app's normal monochrome iconography |
| Box 3 | 👥 rendered over the real app icon (`NSApp.applicationIconImage`) in a `ZStack`, echoing AOL's people-on-the-triangle composition |
| Status text | Reuses the app's own existing, contextually accurate phase messages (`StartupProgressEstimator.message`, deploy milestone `label`s) — **not** AOL's "Dialing…/Connecting…" copy, which is phone-modem framing that doesn't apply here |
| Visual style | Native macOS materials (system fill, accent-color tint when filled, dimmed/outline when not yet reached) — a nostalgic homage, not a literal pixel skin of the 1996 UI |
| API naming | "AOL" stays out of the actual Swift type name (e.g. `PhaseProgressStrip`) — fine as design-doc/comment context, not as an identifier |
| Terminal states | `.failed`/`.blocked`/etc. in the deploy drawer keep their existing checkmark/X iconography — box 3 is not repurposed as a generic "success" icon there |

## 1. `PhaseProgressStrip` component (`AnglesiteApp`)

A new SwiftUI view, three fixed cells rendered left-to-right:

- Cell 1: 🚶
- Cell 2: 🏃
- Cell 3: 👥 over `Image(nsImage: NSApp.applicationIconImage)` in a `ZStack`

Takes a `filledCount: Int` (0...3) — cells `< filledCount` render filled/tinted (accent-color background, full-opacity glyph), cells `>= filledCount` render dimmed (outline-only, low-opacity glyph). A brief `.easeInOut` transition animates a cell's fill-state change, matching the existing `.animation(.easeInOut(duration: 0.2), value: model.message)` pattern already in `StartupProgressView.swift:26`.

Two presentation sizes, since the two call sites have very different available space:
- **Full** (`StartupProgressView`): larger cells (~56pt), used alongside the existing title/message/progress-bar/Show-Logs stack.
- **Compact** (`DeployDrawerView`): small cells (~18pt), icon-only, replacing the current small spinner — the drawer already has its own title/subtitle line, so no separate caption duplication there.

## 2. Phase → `filledCount` mapping

Reuses each surface's existing named phases rather than inventing generic fraction thirds — box 2's boundary is each domain's actual "in-transit" step, mirroring AOL's box 2 being the one with motion lines:

**Dev-server startup** (`StartupProgressModel`/`StartupPhase`):
- `filledCount = 1` at `.launching` or `.building` ("working")
- `filledCount = 2` at `.connecting` (the actual network step)
- `filledCount = 3` at `.ready`
- `filledCount = 0` at `.idle`/`.failed`

**Deploy** (`DeployModel.Phase`, via a new `DeployPanelProgress.filledCount(currentMilestonePhase:succeeded:)` in `AnglesiteCore`):
- `filledCount = 1` once `.running` starts, while the milestone phase is `"building"` or `"preflightScan"` (the actual emission order in `DeployCommand.swift` is `building` → `preflightScan` → `deploying` → `finalizing`; the two early milestones map to the same count either way, so the order doesn't affect behavior)
- `filledCount = 2` from the `"deploying"` milestone onward (every later milestone — `finalizing`, `webmentions`, `syndicating`, `websubPing`, `activityPubBackfill` — also reads as 2, since they're all past the "actual upload" step)
- `filledCount = 3` only when `succeeded` is `true`
- `.failed`/`.blocked`/`.workerNameConflict`/`.webmentionPaidPlanConfirmationNeeded` keep their existing icon treatment in `DeployDrawerView`'s `statusIcon` — the strip is not shown for these terminal/parked states, only for `.running`

Deliberately **not** built on top of `DeployDockProgress.fraction(forPhase:)` (`Sources/AnglesiteCore/CompletionNotice.swift:164-178`): that table has no entry for `websubPing`/`activityPubBackfill` (returns `nil`, meant for "don't move the Dock tile" semantics), which would make this panel count regress from 2 back to 1 on those two milestones. `DeployPanelProgress` is a small, self-contained switch over the eight known milestone-phase strings instead — no shared dependency, no gap.

## 3. Status text

No new copy. Both call sites already have accurate, contextual phase messages:
- Startup: `StartupProgressModel.message` (already "Starting dev server…", "Building site…", "Connecting to preview…").
- Deploy: `DeployModel.currentMilestone` (already populated from `OperationProgress.label`, e.g. "Running pre-deploy checks…", "Deploying to production…").

The strip's caption is these existing strings, unchanged — this feature only adds the visual strip above/beside them.

## 4. Testing

- The `filledCount` mapping logic (phase → 0...3) is pure and belongs in `AnglesiteCore` alongside `StartupProgressEstimator`/`DeployDockProgress`, unit-tested the same way (`StartupProgressEstimatorTests`-style: exact phase in, exact `filledCount` out).
- `PhaseProgressStrip` itself (the SwiftUI view) stays untested directly, matching this codebase's existing convention for presentational views.

## Out of scope

- No settings toggle (always on, per decision above).
- No sound coupling — this is independent of `playsDialupSoundEffect`, though the two features are thematically paired and may ship as stacked PRs.
- No change to deploy's terminal-state iconography (checkmark/X stay as-is).
- No literal recreation of AOL's 1996 visual chrome (colors, borders, wordmark) — native macOS materials only.
