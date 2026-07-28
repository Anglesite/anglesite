# Optional dial-up modem sound effect — design

**Issue:** none tracked yet — small, additive settings feature.
**Date:** 2026-07-28
**Status:** Approved design; ready for implementation planning.

## Goal

Add an optional, off-by-default sound effect that plays a nostalgic dial-up
modem handshake sound while the user is waiting on a long-running "loading"
operation: the dev server starting up, and a deploy running. Purely decorative
— no effect on functionality, timing, or state.

## Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Audio source | Synthesized procedurally in Swift (no bundled recording, no licensing question) |
| Triggers | Dev-server startup (`StartupProgressModel`) **and** deploy (`DeployModel.onPhaseTransition`) |
| Overlap across windows | Per-window; two windows loading at once can play independently (no app-wide coordination) |
| Overlap within one window | Not coordinated either — two independent `DialupSoundEffectPlayer` instances (one for startup, one for deploy); a rare simultaneous case would layer, not break |
| Default | Off |
| Scope boundary | Backup and Audit share the same `Phase`/`onPhaseTransition` shape and could get this later, but are explicitly out of scope for this change |

## 1. Audio synthesis (`AnglesiteCore`)

A new pure type, `DialupModemSoundEffect`, generates raw `[Float]` PCM samples
for one ~5 second loop cycle using only
`Foundation` trig math — no `AVFoundation` import, so it compiles and unit-tests
on the Linux CI lane like the rest of `AnglesiteCore`. It's a stylized
approximation of a real handshake, not a reproduction of any specific existing
recording:

- Dial tone (350 Hz + 440 Hz)
- A few DTMF-style digit blips
- The real ITU V.25 2100 Hz answer tone, including its periodic phase reversal
- A couple of ascending chirp sweeps standing in for the negotiation tones
- A filtered-noise burst standing in for the training sequence

All sample values stay within `[-1, 1]`. Deterministic given the same inputs —
no randomness seeded from wall-clock time.

## 2. Playback (`AnglesiteApp` / `AnglesiteAppCore`)

`DialupSoundEffectPlayer` (behind a small `DialupSoundEffectPlaying` protocol
for injection) wraps `AVAudioEngine` + `AVAudioPlayerNode`:

- Builds an `AVAudioPCMBuffer` from the synthesized samples once.
- `play()` schedules the buffer with `.loops` so it repeats seamlessly for as
  long as needed, and checks `AppSettings.shared.playsDialupSoundEffect` first
  — a no-op (the audio engine is never touched) when the setting is off.
- `stop()` halts the engine. No fade-out for v1 — an abrupt cutoff is
  acceptable for this effect.
- Both methods are idempotent (calling `play()` while already playing, or
  `stop()` while already stopped, is a harmless no-op).

This mirrors `CompletionNotifier`'s existing shape: the parts that are pure
logic are unit-tested elsewhere, and this AppKit/AVFoundation-touching glue
stays thin and untested directly, consistent with how `CompletionNotifier`
itself (and `SiteWindowModel`'s existing hook-composition closures) are
already handled in this codebase.

## 3. Trigger wiring

### Dev-server startup

`StartupProgressModel` owns its own `DialupSoundEffectPlayer` instance
internally (constructed the same way it already constructs its default
`StartupTimingStore`/`LogCenter` dependencies). `begin(siteID:)` calls
`play()`; `stop()` (already called from the `.ready`/`.failed`/`.idle`
branches of `ingest(state:)`) calls the player's `stop()` too.

### Deploy

`SiteWindowModel.init` already layers extra per-window behavior onto
`DeployModel.onPhaseTransition`, on top of `CompletionNotificationHub.wire(...)`
(see the existing `sync.deployCompleted()` wrapping at
`SiteWindowModel.swift:256-260`). Add a third layer there:

```swift
let deploySound = DialupSoundEffectPlayer()
let deployHook = deploy.onPhaseTransition
deploy.onPhaseTransition = { [weak self] siteID, phase in
    deployHook?(siteID, phase)
    if case .succeeded = phase { self?.sync.deployCompleted() }
    if case .running = phase { deploySound.play() } else { deploySound.stop() }
}
```

Sound plays only during `.running`; every other phase (`.idle`, `.succeeded`,
`.failed`, `.blocked`, `.workerNameConflict`,
`.webmentionPaidPlanConfirmationNeeded`) stops it — including the two "parked
on a sheet, waiting for user input" phases, which is correct: nothing is
actively loading while the user is looking at a token/conflict/confirmation
sheet.

## 4. Settings

New `AppSettings.Key.playsDialupSoundEffect`
(`"anglesite.playsDialupSoundEffect"`), plain `Bool`. Absent defaults to
`false` via `defaults.bool(forKey:)`'s normal behavior — no
inverted-from-absent trick needed since the default is off.

Surfaced in `GeneralSettingsView` (`SettingsView.swift`) as a new "Sound"
section:

- Toggle: **"Play dial-up sound while loading"**
- Caption: **"Plays a nostalgic dial-up modem sound while the dev server
  starts up or a deploy is running. Purely decorative — off by default."**

One toggle covers both triggers; no per-trigger settings.

## 5. Testing

- `AnglesiteCoreTests`: unit tests on the sample generator — correct
  duration/sample count for the target sample rate, all values within
  `[-1, 1]`, deterministic output across repeated calls, non-silent (not all
  zeros).
- `DialupSoundEffectPlayer` and the `SiteWindowModel`/`StartupProgressModel`
  wiring stay untested directly, matching the existing convention in this
  codebase — neither `StartupProgressModel` nor `SiteWindowModel`'s hook
  composition closures (e.g. the existing `backupHook`/`deployHook` layering)
  have dedicated unit tests today; only the pure `StartupProgressEstimator`
  does (`StartupProgressEstimatorTests`).

## Out of scope

- Backup and Audit (`BackupModel`/`AuditModel`) share the same
  `Phase`/`onPhaseTransition` shape and could get this sound later as an
  obvious, small follow-up — not included here.
- No volume control, no alternate sounds, no fade-out/in.
- No bundled audio asset — everything is synthesized at runtime.
