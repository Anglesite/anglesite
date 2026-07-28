# Siri Onscreen Awareness Manual Smoke Test

**Issue:** [#150](https://github.com/Anglesite/Anglesite/issues/150) - B.6, Siri + preview pane onscreen awareness  
**Parent:** [#133](https://github.com/Anglesite/Anglesite/issues/133) - View Annotations for onscreen awareness  
**Scope:** Manual product smoke for the live Siri/App Intents handoff that cannot be proven by `swift test`.

## Purpose

Verify that Siri can resolve visible preview content into Anglesite entities, route a spoken edit through `EditContentIntent`, and keep the entity provider scoped to the active site window as the user scrolls, navigates, and opens multiple windows.

This complements the automated coverage in:

- `Tests/AnglesiteIntentsTests/SmokeMatrixTests.swift`
- `Tests/AnglesiteIntentsTests/EditContentIntentFlowTests.swift`
- `Tests/AnglesiteIntentsTests/PreviewAnnotationProviderTests.swift`
- `Tests/AnglesiteIntentsTests/ContentEntitiesTests.swift`

## Preconditions

- macOS 27 or newer with Siri, Apple Intelligence, and App Intents enabled for the signed app under test.
- A current build of the `Anglesite` scheme (the single sandboxed Mac App Store target).
- The app has been launched once after install so App Shortcuts and App Entities are registered with the system.
- Microphone/Siri permissions are granted.
- The test site is an `.anglesite` package opened through the app, not a bare `Source/` directory.
- The site package has an active security-scoped grant by opening it through Anglesite before invoking Siri (the target is sandboxed).

Suggested build commands:

```sh
xcodegen generate
env ANGLESITE_PLUGIN_SRC=/Users/dwk/Developer/github.com/Anglesite/anglesite-skills \
  xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

## Fixture Site

Use one `.anglesite` package with enough visible variety to distinguish entity types:

- Home page with a unique H1, for example `Welcome to Onscreen Smoke`.
- Navigation links to at least `About` and `Blog`.
- At least one visible image with a distinctive filename and alt text, for example `hero-smoke.jpg` / `Smoke test hero`.
- Blog index or post page with a different H1 and at least one post title.
- Enough vertical content on one page to require scrolling.

Before the run, open the site in Anglesite and wait for:

- The dev server to finish starting.
- The preview pane to render the page.
- The site content graph/readiness indicators to settle.

Optional readiness check: in the site window, open **Site > Siri AI Readiness** and confirm site content and Spotlight/entity readiness show as available before starting the spoken checks.

## Evidence to Capture

For each run, record:

- App scheme and build identifier or commit SHA.
- Site package path.
- Spoken phrase used.
- Visible target on screen.
- Siri result or prompt text.
- Whether the source file changed when expected.
- Debug pane excerpts around any `apply_edit` dry-run/apply activity.
- Screenshot or short screen recording for failures.

## Pass/Fail Table

| Case | Result | Notes |
|---|---|---|
| 1. Diverse preview opens |  |  |
| 2. Heading resolves to `ElementEntity` |  |  |
| 3. Image resolves to `ImageEntity` or image-backed visible entity |  |  |
| 4. Spoken heading edit routes through `EditContentIntent` -> `apply_edit` |  |  |
| 5. Scroll refreshes annotations |  |  |
| 6. Navigation refreshes annotations |  |  |
| 7. Multiple windows stay scoped to the correct site |  |  |

Use `PASS`, `FAIL`, or `N/A`, and explain any `N/A`.

## Test Cases

### 1. Open A Diverse Preview

1. Launch the target build.
2. Open the fixture `.anglesite` package.
3. Confirm the preview shows the home page with the unique H1, nav, image, and visible body content.
4. Open the debug pane.

Expected:

- The preview renders without a blank WKWebView.
- The dev server logs are visible in the debug pane.
- No stale errors from a previous site/window appear for the active site.

### 2. Resolve An Onscreen Heading

1. Focus the preview pane.
2. Make sure the unique home H1 is visible.
3. Invoke Siri.
4. Say a phrase that refers to the visible heading, for example:

```text
Edit this heading with Anglesite
```

If Siri asks for the change, answer with a harmless instruction:

```text
Make it a little bigger
```

Expected:

- Siri targets the visible heading rather than asking which site/page to use.
- The resolved entity is the visible heading's `ElementEntity`.
- The confirmation prompt names or summarizes the visible heading.
- If the edit is declined, no source file changes.

Fail if Siri resolves a different visible element, asks for an unrelated site, or cannot find an onscreen element while the H1 is plainly visible.

### 3. Resolve An Onscreen Image

1. Focus the preview pane.
2. Make sure the fixture image is visible.
3. Invoke Siri.
4. Refer to the visible image, for example:

```text
Edit this image with Anglesite
```

or, if Siri asks for an image/content target:

```text
Use the Smoke test hero image
```

Expected:

- Siri resolves the visible image target, preferably as `ImageEntity` when the image maps to the site content graph.
- If the image is surfaced through the generic visible-element path, the resolved context still points at the visible image element and correct site ID.
- Siri does not resolve a different image from another page or another open site.

Fail if Siri selects a non-visible image, an image from another window, or cannot resolve the image while it is visible and indexed.

### 4. Route A Spoken Heading Edit Through `EditContentIntent`

1. Focus the preview pane with the home H1 visible.
2. Invoke Siri.
3. Say:

```text
Make that heading bigger with Anglesite
```

4. When Siri shows the edit confirmation, verify the before/after summary targets the H1.
5. Confirm the edit.
6. Wait for the preview to refresh.

Expected:

- `EditContentIntent` receives the visible element and spoken instruction.
- The edit path performs a dry-run preview before applying the write.
- The confirmation prompt appears before the source file changes.
- After confirmation, the debug pane shows the edit routed through the app's edit pipeline to the plugin `apply_edit` tool.
- The source file for the page changes in `Source/`.
- The preview updates to reflect the applied edit.
- The edit is recorded in the app's edit history/chat surface if that surface is visible for the site.

Fail if the edit applies before confirmation, changes the wrong file/site, silently fails, or bypasses the debug pane.

### 5. Scroll And Verify Annotation Refresh

1. On the same page, scroll until the original H1 is offscreen and a lower unique heading or image is visible.
2. Invoke Siri.
3. Refer to the newly visible element:

```text
Edit this heading with Anglesite
```

Expected:

- Siri resolves the element currently visible after scrolling.
- The previous offscreen heading is not selected.
- The confirmation prompt reflects the new visible element.

Fail if Siri keeps resolving stale pre-scroll annotations.

### 6. Navigate And Verify Annotation Refresh

1. Use the preview nav to move to another page, such as `About` or a blog post.
2. Confirm the new page has a distinct heading visible.
3. Invoke Siri.
4. Say:

```text
Edit this heading with Anglesite
```

Expected:

- Siri resolves an entity from the current page.
- The entity's page/path context matches the navigated page, not the previous page.
- The confirmation prompt and any dry-run target the current page file.

Fail if Siri resolves an element from the previous route after navigation.

### 7. Verify Multiple Site Windows Stay Scoped

1. Open a second `.anglesite` package in another Anglesite window.
2. Put both windows on screen if possible.
3. In Site A, show a page with a unique heading, for example `Site A Smoke Heading`.
4. In Site B, show a page with a different unique heading, for example `Site B Smoke Heading`.
5. Bring Site A to the front and focus its preview.
6. Invoke Siri and say:

```text
Edit this heading with Anglesite
```

7. Decline the edit after the confirmation prompt.
8. Bring Site B to the front, focus its preview, and repeat.

Expected:

- Site A resolves only Site A's visible heading.
- Site B resolves only Site B's visible heading.
- `ElementEntity` IDs, edit router lookup, and debug pane activity stay scoped to the frontmost/focused site window.
- Declining the edit causes no source changes in either package.

Fail if Siri or the edit router crosses site IDs, uses a stale provider from a closed/background window, or mutates the wrong package.

## Sandbox-Specific Checks

The `Anglesite` scheme is the sandboxed Mac App Store target, so the full table above already exercises the sandboxed build.

Additional expected behavior:

- With the site opened through Anglesite, writes/spawns inherit the package grant and the edit succeeds after confirmation.
- If testing the missing-grant case separately, write actions must fail closed with a clear access error. They must not silently no-op or write outside the package.

## Closeout Criteria For #150

The issue can be closed when:

- All seven cases pass on `Anglesite`, or any limitation is documented with a follow-up issue.
- The run record includes the build/commit, site fixture, and notes for any failures or retries.
- The edit case has evidence that the write went through `EditContentIntent` and `apply_edit` after confirmation.
