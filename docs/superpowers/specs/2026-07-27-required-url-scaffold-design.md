# Required `.url` fields collected at creation — design (#916)

- **Date:** 2026-07-27
- **Status:** Proposed
- **Issue:** [#916 — ContentScaffold: required `.url` fields scaffold an invalid empty value](https://github.com/Anglesite/Anglesite-app/issues/916)
- **Related:** [#913 — audience field on typed content](https://github.com/Anglesite/Anglesite-app/pull/913) (fixed the optional-`.url` half), [#369](https://github.com/Anglesite/Anglesite-app/issues/369), [#344 — V-1.2 personal content types](https://github.com/Anglesite/Anglesite-app/issues/344)

## Problem

`ContentScaffold.renderEntry` scaffolds every required `.url` field as a live `field: ""` line.
`bookmarkOf`, `inReplyTo`, and `likeOf` are `z.string().url()` (required) in
`Resources/Template/src/content.config.ts`, and an empty string is not a valid URL. So a freshly
created bookmark, reply, or like is written **and committed** in a state that fails Astro
content-collection validation — `astro check`, the dev-server render, and the build all reject it
until the user fills in the URL and re-saves.

No `createTyped` call site accepts per-field values, so there is no way to pre-fill the URL at
creation time.

## Decision

**Collect the required URL in the New Collection sheet and thread it through to the scaffold**, so
the first write is already schema-valid. Validation is enforced at the write boundary in
`NativeContentOperations`, not only in the sheet.

### Why not the other two options in the issue

The issue proposed three fixes. Two do not survive scrutiny:

**Comment out required `.url` fields too** (mirroring #913's optional treatment) does *not* fix the
bug. A commented-out required field is a *missing* required field, which Zod rejects exactly as it
rejects an invalid one. `astro check` still fails; only the error message changes. This option
trades one invalid file for another while also breaking the "required fields stay live" convention
established by the `.datetime`/`.date` cases.

**Relax `bookmarkOf`/`inReplyTo`/`likeOf` to `.optional()`** makes the file validate by making the
schema weaker than the domain. A `bookmark` with no `bookmarkOf` is not a bookmark; the h-entry
projection would emit an empty `u-bookmark-of`, and the same for `u-in-reply-to` and `u-like-of`.
Permanently weakening the published microformat contract to work around a creation-time gap is the
wrong trade.

Prompting is also the better UX independent of the schema. `bookmark`, `reply`, and `like` are
*defined* by their target URL. `reply` and `like` don't even have a `title` field — yet
`NewCollectionEntrySheet` today requires a Title (used only to derive the slug, then discarded).
The sheet asks for the one thing that doesn't matter and not the one that does.

## Design

### 1. Scaffold accepts caller-supplied field values

`ContentScaffold.renderEntry` gains a `fieldValues: [String: String] = [:]` parameter. One uniform
rule applies across the four scalar-string kinds (`.string`, `.text`, `.url`, `.image`):

```
value = fieldValues[field.name] ?? (title-like field ? title : "")
```

A `.url` line stays commented out only when the field is **optional and no value was supplied**. A
supplied value always renders live, for optional and required fields alike.

Every other kind is untouched. With an empty `fieldValues`, output is byte-identical to today's, so
#798's `draft: true` default and #913's optional-`.url` comment-out behavior are both preserved.

The parameter is pure input to a pure function — `renderEntry` stays side-effect-free.

### 2. URL validation

New file `Sources/AnglesiteCore/ContentFieldValidation.swift`:

```swift
public enum ContentFieldValidation {
    /// Parseable, with a scheme and a non-empty host.
    public static func isAbsoluteURL(_ value: String) -> Bool
}
```

This mirrors the rule `IntegrationPlanner` already applies to its own `.url` fields
(`Sources/AnglesiteCore/IntegrationPlanner.swift`): require a **host**, not merely a parseable
scheme, so `"https:"` and `"mailto:a@b.c"` are rejected. That is strictly tighter than Zod's
`z.string().url()`, so anything accepted here is accepted by `astro check`.

It lives in its own small type rather than on `ContentScaffold` — scaffolding renders, it doesn't
validate — and in `AnglesiteCore` so it is portable and testable without the app target.

### 3. Enforcement at the write boundary

`NativeContentOperations.createTyped` gains `fieldValues: [String: String] = [:]` and, before
writing:

- every **required** `.url` field of the descriptor must have a supplied value that passes
  `isAbsoluteURL`, else `.failed(reason:)` naming the field;
- any supplied **optional** `.url` value must also pass, else `.failed(reason:)`.

This is the actual guarantee. The sheet's own disabled-Create state is a UX affordance; the write
boundary is what makes it impossible for any caller — a future App Intent, a test, an FM tool — to
commit an invalid entry.

### 4. Slug derivation for title-less types

`ContentScaffold.slugFromURL(_ value: String, now: Date) -> String`, pure:

1. `yyyy-MM-dd` from `now` in UTC, matching the ISO8601 formatter `renderEntry` already uses;
2. the URL's host, with a leading `www.` dropped;
3. the last non-empty path component (query and fragment ignored);
4. joined and run through `slugify`.

Returns `""` if the value doesn't parse or has no host.

```
https://example.com/blog/hello-world  →  2026-07-27-example-com-hello-world
https://example.com/                  →  2026-07-27-example-com
https://www.example.com/a/b/          →  2026-07-27-example-com-b
```

The date prefix makes collisions practically impossible (two replies to the same URL on the same
day), keeps entries chronologically sortable, and matches the IndieWeb convention for replies and
likes. The sheet's optional Slug field still overrides it.

Slug precedence in `createTyped` becomes:

```
explicit slug → title → URL-derived → descriptor.id
```

The URL-derived step uses the value supplied for the **first** entry in
`descriptor.requiredURLFields`, i.e. declaration order. Each of `bookmark`, `reply`, and `like` has
exactly one, and in all three it is the first field of the descriptor; declaration order gives a
deterministic answer if a future type declares more.

`descriptor.id` is today's final fallback and is retained. Collision behavior is unchanged: an
existing file at the target path still returns `.failed(reason: "A <collection> entry already
exists at …")`, which the sheet surfaces, and the user can type an explicit slug.

### 5. Descriptor helpers

Two computed properties on `ContentTypeDescriptor`, so the sheet and the scaffold share one
definition instead of each carrying its own notion of "the title field":

- `titleField: ContentTypeField?` — the first field named `title`, `name`, or `itemReviewed`.
  `ContentScaffold`'s private `titleLikeFieldNames` set moves behind this.
- `requiredURLFields: [ContentTypeField]` — required fields of kind `.url`, in declaration order.

### 6. New Collection sheet

`NewCollectionEntrySheet` (`Sources/AnglesiteApp/NewContentSheets.swift`):

- The **Title** row renders only when `descriptor.titleField != nil`. `bookmark` keeps it; `reply`
  and `like` lose it, along with the throwaway-Title requirement.
- One `TextField` per `descriptor.requiredURLFields` entry, labeled with the **raw field name** —
  the same convention `TypedEntryForm` already uses for the inspector
  (`Sources/AnglesiteApp/TypedEntryEditorView.swift`) — with a `https://example.com/…` prompt.
- **Create** is enabled when the collection resolves, every required URL passes `isAbsoluteURL`,
  and — for title-bearing types only — the title is non-empty.
- A malformed URL shows an inline message in the existing `errorMessage` style.
- Per-field values reset when the type Picker changes.

### 7. Threading

```
NewCollectionEntrySheet
  → SiteWindowModel.createCollectionEntry(title:slug:descriptor:fieldValues:)
  → ContentCreationWorkflow.createTyped(siteID:typeID:title:slug:fieldValues:)
  → NativeContentOperations.createTyped(…fieldValues:)
```

`ContentCreationWorkflow`'s `TypedSlugCreator` typealias gains the parameter, as does the closure
`ContentCreationWorkflow.native(…)` installs.

### Known gap (documented, not fixed)

The `ContentOperationsService` protocol witness is `createTyped(siteID:typeID:title:onProgress:)` —
title-only — so a non-native runtime cannot carry field values. This is unreachable today:
`ContentCreationWorkflow.native(…)` always installs `typedSlugCreator`, and the protocol-only path
is exercised only by tests. Widening the protocol would ripple into
`RemoteSandboxSiteRuntime` (#66) and `LocalContainerSiteRuntime` (#69) for no present benefit, so
this design adds a code comment alongside the existing `createTypedSingleton` TODO in
`NativeContentOperations` rather than changing the protocol.

## Testing

- **`ContentScaffoldTests`**
  - a supplied required `.url` renders as a live, valid line;
  - a supplied *optional* `.url` renders live rather than commented;
  - an empty `fieldValues` reproduces today's output exactly, for a representative descriptor of
    each shape (bookmark, reply, note, event);
  - `slugFromURL` over the cases above plus unparseable input, a host-only URL, a trailing slash,
    and a value with a query string.
- **`ContentFieldValidationTests`** (new) — accepts `https://example.com`, `http://a.b/c?d=e`;
  rejects `""`, `"not a url"`, `"https:"`, `"mailto:a@b.c"`, `"/relative/path"`.
- **`NativeContentOperationsTests`**
  - bookmark with a valid URL writes a live `bookmarkOf` line and commits;
  - bookmark with an invalid URL returns `.failed` and leaves no file on disk;
  - bookmark with no `fieldValues` at all returns `.failed` (the #916 regression guard);
  - like with no title derives the dated URL slug.

Verification before the PR:

```sh
swift test --package-path .
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

The sheet adds user-visible strings, so `Sources/AnglesiteApp/Localizable.xcstrings` needs the
`xcstringstool sync` step from `CONTRIBUTING.md` and the reviewed diff committed alongside.

## Out of scope

- **Template schema changes.** `content.config.ts` is unchanged; this is app-only, so no paired
  sidecar PR is needed.
- **The typed entry inspector.** `TypedEntryForm` already lets the user edit `.url` fields after
  creation and is not made to validate them here — a separate concern from the create path.
- **Collision disambiguation.** Auto-suffixing a colliding slug (`-2`, `-3`) would change behavior
  for every content type, not just the ones #916 touches.
- **Prompting for required non-`.url` fields.** An empty required `.string` is incomplete but not
  schema-*invalid*; the existing convention stands.
