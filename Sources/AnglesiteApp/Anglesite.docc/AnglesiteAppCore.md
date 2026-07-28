# ``AnglesiteAppCore``

The macOS app shell: SwiftUI views, view models, and window/scene coordination for Anglesite.

## Overview

Anglesite is a native macOS app for building and publishing static sites. This module holds
almost all of the app's actual logic — the two Xcode-only entry-point files
(`AnglesiteApp.swift`, `LiveSiteRuntimeFactory.swift`) live alongside it in
`Sources/AnglesiteApp/` but aren't part of this SwiftPM target, since they depend on the
Xcode-project-only `Anglesite` application target.

This module is intentionally free of public API of its own — every type here is `internal`,
consumed only by the app target in this same package. The real public API this app is built on
lives one layer down:

- `AnglesiteCore` — site model, process supervision, MCP client, and most business logic.
- `AnglesiteSiteModel` — the `.anglesite` package format (`Source/` + `Config/`) that every site
  is built from.
- `AnglesiteBridge` — the `WKWebView` preview bridge.
- `AnglesiteIntents` — Siri / Shortcuts / Spotlight integration via App Intents.

Generate documentation for any of those directly to browse their public API — for example
`swift package generate-documentation --target AnglesiteCore`.
