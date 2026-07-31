# Offering new template dependencies to existing sites

**Date:** 2026-07-30
**Status:** Approved — ready for an implementation plan
**Issue:** [#1108 — Template dependency additions never reach existing sites (DependencySync)](https://github.com/Anglesite/Anglesite/issues/1108)

## Problem

`DependencySync.diff` (`Sources/AnglesiteCore/DependencySync.swift`) only ever offers a version
bump for a package present in **both** the site and the template — it never adds a package name.
When the bundled template gains a genuinely new dependency (as #958 did with `html-validate`,
required by the restored `Website ▸ Audit` accessibility check), every site scaffolded before that
change never picks it up: `TemplateScriptsSyncChecker` happily copies the new script files in (file
sync handles additions fine), but the script's `import` throws at module load because the package
was never installed. The audit silently reports "skipped" instead of running.

`TemplateScriptsSyncChecker` already solves the file half of this. This spec solves the dependency
half, generalizing past `html-validate` to any future template dependency addition.

## Scope

In scope: detecting a template package missing from a site's `package.json`, offering to add it
(name + version range + correct `dependencies`/`devDependencies` section), and writing that
addition when accepted — reusing the existing `npm install` follow-through
(`preview.isUpdatingDependencies = true`) the version-bump path already triggers.

Out of scope: removing a package the template no longer has (unchanged — `DependencySync` still
never removes anything); per-offer accept/reject granularity (see "UI" below); anything about
`TemplateScriptsSyncChecker` itself (already correct, referenced only for consistency).

## Data model

Add `DependencyAdditionOffer` alongside the existing `DependencyUpdateOffer`:

```swift
public struct DependencyAdditionOffer: Sendable, Equatable {
    public let name: String
    public let offeredRange: String
    public let section: DependencySection  // .dependencies or .devDependencies
}

public enum DependencySection: Sendable, Equatable {
    case dependencies
    case devDependencies
}
```

Bundle both offer kinds into one result type, replacing the bare `[DependencyUpdateOffer]` that
`DependencySync.diff` and `DependencySyncChecker.check` return today:

```swift
public struct DependencySyncOffers: Sendable, Equatable {
    public let updates: [DependencyUpdateOffer]
    public let additions: [DependencyAdditionOffer]
    public var isEmpty: Bool { updates.isEmpty && additions.isEmpty }
}
```

## Diff logic (`DependencySync.diff`)

The existing version-bump loop is untouched. A second loop handles additions: for each template
package absent from `site`, offer it *unless* the site is known to have deliberately removed it
before. "Known" comes from the same three-way baseline already used for bumps:

- **No baseline file at all** → offer unconditionally. This matches the existing bump behavior's
  "legacy direct-diff fallback" — a site with no baseline has no history to consult, so the feature
  accepts the same risk it already accepts for bumps.
- **Baseline present, no entry for this package name** → the site has never had this package in any
  snapshot the app took, so there's nothing to have deliberately removed. Offer it.
- **Baseline present, has an entry for this package name** (the site had it at some point — either
  scaffolded with it, or it was added via a prior accepted addition offer — and no longer does) →
  the absence is the site owner's own doing. Don't re-offer. This mirrors the existing "leaves a
  user-customized package alone" rule for bumps, applied to the addition/removal case instead of
  the version-range case.

`diff` needs to know which section a candidate addition belongs to. Rather than deepen `diff`'s
signature with a structured template-sections type, it takes one more flat parameter:

```swift
public static func diff(
    site: [String: String],
    baseline: [String: String]?,
    template: [String: String],
    templateDevDependencyNames: Set<String> = []
) -> DependencySyncOffers
```

This keeps `diff` a pure function over plain dictionaries/sets, consistent with its current style,
rather than coupling it to `PackageJSONDependencies`' parsing types.

## Parsing (`PackageJSONDependencies`)

Add `extractSections(from:) -> (dependencies: [String: String], devDependencies: [String: String])`
and rewrite the existing `extract(from:)` to derive from it (merge, `devDependencies` wins on
collision — same documented behavior as today, no test changes needed for `extract` itself).
`DependencySyncChecker` calls `extractSections` on the template's `package.json` text to build the
`templateDevDependencyNames` set passed into `diff`.

## Writing additions (`PackageJSONDependencies.applyAdditions`)

A new function parallel to today's `apply` (which only rewrites existing "name": "range" pairs):

```swift
public static func applyAdditions(_ offers: [DependencyAdditionOffer], to text: String) -> String
```

For each offer, it locates the target section's `{ ... }` span using the existing `objectSpan`
helper and inserts `"name": "range",` as a new first entry:

- If the section already has entries, the inserted line copies the indentation whitespace that
  currently precedes the first entry, so the new line matches the file's existing formatting.
- If the section is empty (`{}`), it inserts with a 2-space default indent (this repo's established
  JSON style, e.g. `Resources/Template/package.json`).
- If the target section is missing from the site's `package.json` entirely, that addition is
  skipped — no top-level section is fabricated. This is a defensive fallback only (every site
  scaffolded from the template has both sections); silently doing nothing is consistent with
  `DependencySyncChecker`'s existing "never block a site opening" contract.

Like `apply`, spans are recomputed against the current mutated text on each iteration rather than
computed once up front, since an earlier insertion shifts the indices a later one would need.

## Applying (`DependencySyncApplier`)

`apply` takes a `DependencySyncOffers` instead of `[DependencyUpdateOffer]`. It runs the existing
`PackageJSONDependencies.apply` (bumps) followed by the new `applyAdditions`, then records the
*resulting* range for every offer — both updates and additions — into `DependencyBaseline`, exactly
as it does for bumps today. Recording additions into the baseline is what makes the "deliberate
removal" rule above work for packages added through this feature. Everything else in `apply`
(lockfile delete, `ANGLESITE_VERSION` stamp bump) is unchanged.

## UI (`SiteWindow.swift` / `DependencyUpdateModel`)

`DependencyUpdateModel` holds a `DependencySyncOffers` instead of `[DependencyUpdateOffer]`. The
sheet's single `List` gains a second `Section` — "New Dependencies," shown only when
`offers.additions` is non-empty — alongside the existing "Dependency Updates" section (also only
shown when non-empty). Each addition row shows the package name and offered range with a small
visual marker (e.g. a `Label` with a `plus.circle` system image) distinguishing it from a bump row,
satisfying the issue's "distinct offer type/UI treatment" ask without changing the interaction
model.

Skip/Update stay exactly as they are: one decision, applied to every offer (updates and additions
together) at once. No per-row accept/reject — confirmed as the preferred shape over a per-row
checkbox UI or a separate second confirmation sheet.

## Testing

- `DependencySyncTests`: new cases for the addition loop — offers when there's no baseline, offers
  when the baseline has no entry for the name, withholds when the baseline has an entry but the
  site doesn't have the package, correct section tagging via `templateDevDependencyNames`. Existing
  bump tests are unaffected (same loop, same logic).
- `PackageJSONDependenciesTests`: new cases for `applyAdditions` — inserting into a non-empty
  section (indentation matches), an empty section (default indent), a missing section (no-op), and
  multiple simultaneous additions.
- `DependencySyncApplierTests` / `DependencySyncCheckerTests`: updated for the new
  `DependencySyncOffers`-based signatures; new coverage confirming an accepted addition both writes
  the package.json and is recorded into the baseline.
