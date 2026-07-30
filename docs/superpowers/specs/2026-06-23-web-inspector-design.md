# Open Web Inspector — Design

**Date:** 2026-06-23
**Status:** Superseded by #1099 — direct-download distribution was retired, leaving the
`Developer ID`-only code path this design relied on permanently unreachable in the
shipping (MAS-only) target. The feature was removed rather than reworked, since there's
no public WebKit API for an embedded inspector. Kept here as historical record.

## Goal

Let the user open the Web Inspector for the live website preview (the `WKWebView`
showing the Astro dev server), both via **control-click** and via a **View menu**
item in the Developer ID build. In the sandboxed `AnglesiteMAS` App Store target,
public WebKit inspection remains enabled, but private WebKit inspector-opening API is
compiled out.

## Background

- The preview `WKWebView` is created in `PreviewView` (`Sources/AnglesiteApp/PreviewView.swift`),
  an `NSViewRepresentable`. Its configuration is built by `WebViewBridge`
  (`Sources/AnglesiteBridge/WebViewBridge.swift`).
- `WebViewBridge.applyPreviewDefaults(to:)` sets `webView.isInspectable = true`,
  enabling Safari Develop-menu inspection for preview content through public WebKit API.
- There is **no public API** to open the Web Inspector programmatically on macOS. The
  only programmatic path is the private `_inspector` property (`_WKInspector`) and its
  `show` selector.
- The app ships two targets: `Anglesite` (Developer ID) and `AnglesiteMAS` (sandboxed,
  App Store). MAS-only differences are gated with `#if ANGLESITE_MAS`.

## Decision: availability and private API

The Developer ID build ships the full in-app inspector. The `AnglesiteMAS` App Store
build compiles out the private WebKit pieces (`developerExtrasEnabled`,
`_inspectorAttachmentView`, `_inspector`, `show`, and `detach`) so App Review does not
see private inspector API during static or dynamic analysis. The public
`webView.isInspectable = true` path remains enabled for Safari Develop-menu inspection.

The private inspector implementation lives in the app target (`PreviewWebInspector`),
not the `AnglesiteBridge` Swift package, because package targets do not inherit the
app target's `ANGLESITE_MAS` compilation condition. Keeping the private strings in the
package would still place them in the MAS binary.

## Implementation corrections (post-verification)

Verifying in the running app overturned the original premise. **`isInspectable`
does not give an in-app inspector** — per [Apple](https://developer.apple.com/documentation/safari-developer-tools/enabling-inspecting-content-in-your-apps)
and [WebKit](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/),
it only enables inspection through **Safari's Develop menu**. It adds no "Inspect
Element" context-menu item and does not make a programmatic open work. What actually
ships:

1. **In-app inspector is gated on `WKPreferences.developerExtrasEnabled`** (private,
   set via string KVC in `PreviewWebInspector.enableDeveloperExtras(on:)` on the
   configuration). This is the knob that adds the native "Inspect Element" context
   menu (control-click) and makes the programmatic open functional. `isInspectable`
   is kept too, for the complementary Safari-Develop-menu path. This private setting
   is compiled out for `ANGLESITE_MAS`.
2. **The menu command must use `.focusedSceneValue`, not `.focusedValue`.** The
   preview pane is a WKWebView (an AppKit responder), so SwiftUI's focus system is
   empty and `.focusedValue(\.preview)` resolved to nil — the command was perpetually
   disabled. `.focusedSceneValue` publishes while the site window is the active scene.
3. **The inspector is opened detached outside MAS** (`_WKInspector` `show` then `detach`, both
   `responds(to:)`-guarded). Opened attached, it tries to dock into the WKWebView's
   host window, which a SwiftUI-embedded web view can't provide — it connects but no
   window appears. **Known limitation:** the inspector's own dock-to-window buttons
   re-attach it and it vanishes; reinvoking "Show Web Inspector" reopens it detached.
4. **Menu placement is `CommandGroup(after: .toolbar)`** (next to "Show Debug Pane"),
   not `.sidebar`.

The sections below are the original (pre-correction) design and are kept for context;
where they conflict with the four points above, the points above are authoritative.

## Design

### 1. Enable inspection in all builds

In `WebViewBridge.applyPreviewDefaults(to:)`, keep `webView.isInspectable = true`
enabled for all build configurations. This enables Safari Develop-menu inspection
through WebKit's public API.

No custom SwiftUI `.contextMenu` is added — it would conflict with WKWebView's own
native context menu.

### 2. Programmatic open helper (`AnglesiteApp`)

Add to `PreviewWebInspector`:

```swift
@MainActor
static func show(_ webView: WKWebView?) {
    #if !ANGLESITE_MAS
    (webView.value(forKey: "_inspector") as? NSObject)?
        .perform(Selector(("show")))
    #endif
}
```

This is the single home for the private-API call. The app-internal helper remains
available in MAS so app code can call it unconditionally; it just no-ops there.

### 3. Reaching the live `WKWebView` from a menu command

- `PreviewModel` gains `weak var webView: WKWebView?` and
  `func showWebInspector()` which calls `PreviewWebInspector.show(_:)` and no-ops
  when `webView == nil`.
- `PreviewView` gains an `onWebView: (WKWebView) -> Void` closure, called in
  `makeNSView` after the web view is created.
- `SiteWindow` passes `{ preview.webView = $0 }` into `PreviewView` and exposes the
  model to the menu via `.focusedSceneValue(\.preview, preview)`.

### 4. The menu item

- New `FocusedValue` key for `PreviewModel` in
  `Sources/AnglesiteApp/WebInspectorCommands.swift`.
- New `WebInspectorCommands: Commands` reading `@FocusedValue(\.preview)`:
  - Placed in the **View** menu via `CommandGroup(after: .toolbar)` next to the
    existing Debug Pane toggle.
  - Label: **"Show Web Inspector"**, shortcut **⌥⌘I**.
  - `.disabled(focusedPreview == nil)` so it greys out when no site window is focused.
- Wired into the app's `.commands` in `Sources/AnglesiteApp/AnglesiteApp.swift`.

### Behavior choices

- **Show, not toggle** — reading inspector visibility is also private; `show` is
  simpler and idempotent.
- **Control-click** uses WebKit's native "Inspect Element" item in the Developer ID
  build once `developerExtrasEnabled` is set, not a custom menu. MAS keeps only the
  public Safari Develop-menu inspection path.
- **Label / shortcut:** "Show Web Inspector" / ⌥⌘I.

## Testing

- Unit test: `applyPreviewDefaults(to:)` sets `isInspectable == true`
  (now unconditional, in all build configurations).
- `PreviewModel.showWebInspector()` has an explicit nil guard and `@MainActor`
  contract. Hosted app tests do not run on CI for this macOS 27 app target, so the
  nil path is verified by code inspection and by app-target builds; package tests cover
  the public `WebViewBridge` surface.
- The actual inspector display cannot be exercised on CI (hosted app tests do not run
  on CI runners), so logic is kept thin and lives in `PreviewWebInspector` /
  `PreviewModel`.

## Files touched

- `Sources/AnglesiteBridge/WebViewBridge.swift` — unconditional public
  `isInspectable` preview default.
- `Sources/AnglesiteApp/PreviewWebInspector.swift` — MAS-gated private inspector API.
- `Sources/AnglesiteApp/PreviewView.swift` — new `onWebView` closure.
- `Sources/AnglesiteApp/PreviewModel.swift` — `weak var webView`, `showWebInspector()`.
- `Sources/AnglesiteApp/SiteWindow.swift` — wire `onWebView`,
  `.focusedSceneValue(\.preview, …)`.
- `Sources/AnglesiteApp/WebInspectorCommands.swift` — `FocusedValue` for
  `PreviewModel` and the View-menu command.
- `Sources/AnglesiteApp/AnglesiteApp.swift` — add `WebInspectorCommands` to `.commands`.
- Tests in `AnglesiteBridgeTests`; app-scheme builds and a MAS binary string scan verify the
  app-target private API boundary.
