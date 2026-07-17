# `extract-component` apply_edit op

**Date:** 2026-07-16 · **Issue:** Anglesite-app#495 (Component Editor Slice 5) · **Status:** draft — awaiting review

Plugin-side half of Slice 5 (per Anglesite-app#496's tracking epic; design spec
referenced there is `Anglesite-app` `docs/superpowers/specs/2026-07-05-component-editor-design.md`
§2.3/§6, not present in this repo). The Anglesite-app side (context-menu
trigger, name-prompt dialog, warning toasts) gets a separate paired PR, same
split as PR #418 / Anglesite-app#494 for Slice 4 — this spec covers that
side's touchpoints in §7 for context, but no Swift code.

## Problem

Slices 1–4 gave the Component Editor read (Slice 1), style writes (Slice 2),
structure writes (Slice 3), and Props-form/code-pane writes (Slice 4) — all
against a single `.astro` component, one at a time. Slice 5's headline
feature, "Extract into Component…", is the first op that is inherently
**two-file**: carve an outline subtree out of the component currently being
edited into a brand-new `.astro` file under `src/components/`, hoist the
subtree's obvious outer-scope references into that new component's Props,
and replace the extracted markup in the original file with a self-closing
instance + import.

Every existing `apply_edit` op — including the 10 component ops from Slices
2–4 — resolves to exactly one `{file, range, replacement}` splice
(`patcher.mjs`'s `resolve()` contract), and the dispatcher
(`apply-edit-dispatcher.mjs`) reads, splices, and atomically writes exactly
one file, then commits exactly one file to the hidden `anglesite/edits`
history branch (`edit-history.mjs`'s `recordEdit` hardcodes a single `file`
param). `extract-component` needs two files touched in one atomic edit. This
spec's central decision is how to extend that contract without disturbing it
for the other 14 ops.

## Non-goals (out of scope for this slice)

- Multi-node / sibling-range extraction — only a single `get_component_model`
  `nodeId` (element/component/slot kind) can be extracted. No fragment
  synthesis over a selection of siblings.
- Extracting an `expression`-kind node (e.g. a `{condition && <div>…}` block)
  — only tag-shaped nodes (element/component/slot) are extractable; the
  span-resolution machinery (`resolveAllSpans`) doesn't trust expression
  spans for this kind of structural move, and expression extraction would
  need real codegen of conditional logic in the new file, not just a markup
  move.
- General CSS-selector-vs-DOM matching. Style-rule migration (§5) handles
  only simple selectors (tag/class/id, no combinators/pseudo-classes);
  anything else is left behind with a warning, never guessed at.
- Hoisting anything other than bare-identifier expressions that are
  themselves one of the *original* component's own declared Props (§4).
  Local consts, loop variables, and non-identifier expressions are left
  verbatim in the moved markup.
- Auto-naming the new component. The caller (app) supplies
  `newComponentPath`; the op refuses on collision rather than guessing an
  alternate name.
- Media-query *editing* in the styles panel and viewport-preset polish —
  companion bullets in Anglesite-app#495 but a separate (app-side, UI-only)
  piece of work from this op.

## 1. Wire contract

`extract-component` joins `editOps` in `apply-edit-schema.mjs`, plus a new
`COMPONENT_EXTRACT_OPS = new Set(["extract-component"])`, folded into the
existing `COMPONENT_OPS` union so the dispatcher's generic `baseVersion`
re-check and `component` payload guard cover it for free.

New `componentEditSchema` fields (reusing `path`/`baseVersion` for the
*original* file, same as every other component op):

```js
nodeId: string             // existing field — subtree root to extract (element/component/slot only)
newComponentPath: string   // e.g. "src/components/Hero.astro" — must be under src/components/
```

**Response.** `edit-applied`'s `result` carries:

```ts
{
  componentPath: string;     // == newComponentPath, echoed back
  hoistedProps: string[];    // sorted prop names moved onto the new component
  warnings: string[];        // non-blocking notices, see §5
}
```

`model` is the freshly rebuilt model of the **original** file only — the app
is looking at that file's outline/canvas; the new file's model is fetched
on demand (existing `get_component_model`) if the user navigates to it.

`dry_run` preview gains one additive field alongside the existing
`{before, after}` windowed diff for the primary file:

```ts
{ newFile: { path: string; after: string } }  // no "before" — the file doesn't exist yet
```

**New/reused refusal reasons:**

| reason | when |
|---|---|
| `invalid-input` | `nodeId` is the component root; `nodeId` kind is text/expression/fragment; `newComponentPath` fails validation (not under `src/components/`, wrong extension, traversal) |
| `no-match` | subtree span can't be lexically re-located (`SpanResolutionError`, same failure mode as remove-node/move-node) |
| `exists` (new) | `newComponentPath` already exists — checked at resolve time and re-checked atomically at write time |
| `stale` | `baseVersion` mismatch (resolve-time and dispatcher-level re-check, same as every other component op) |

## 2. Module architecture

New `server/component-extract-edit.mjs`, same shape as
`component-frontmatter-edit.mjs`: read fresh from disk → check `baseVersion`
→ parse with `@astrojs/compiler` → resolve. `resolveComponentExtract(projectRoot, edit)`:

1. Look up `nodeId` in `byId` (via `buildTemplateNodeIndex`, same as the
   structure/frontmatter resolvers). Refuse if missing, if it's the root
   (`parentId === null`), or if `kind` isn't `element`/`component`/`slot`.
2. Run `resolveAllSpans` — exported from `component-structure-edit.mjs`
   alongside its existing named exports — to get the subtree's real span.
   Refuse `no-match` on `SpanResolutionError`.
3. Validate `newComponentPath` (`.astro`, project-relative, no traversal,
   starts with `src/components/`). Refuse `exists` if
   `existsSync(join(projectRoot, newComponentPath))`.
4. Compute hoisted props (§4) and moved style rules (§5).
5. Build `newFile.content`: frontmatter (Props interface + destructure via
   the existing `generatePropsInterface`/`generatePropsDestructure`, plus any
   copied component imports, step 8) + the extracted subtree's raw source
   text verbatim + a `<style>` block for any moved rules.
6. Build the primary-file `replacement`: the subtree's span replaced with a
   self-closing instance tag (`<Hero title={title} />` — hoisted props only;
   literal attributes on the extracted root stay baked into the new file,
   they're never hoisted since they don't reference anything external).
7. Original-file frontmatter bookkeeping: `ensureImport` the new component's
   default import (reusing `frontmatter-imports.mjs`); `pruneImportIfUnused`
   for any component-kind descendant whose import is now dead (same helper
   `remove-node` already uses for exactly this).
8. New-file frontmatter bookkeeping: any component-kind descendants inside
   the extracted subtree have their import lines copied from the original's
   frontmatter (via `parseImports`, matched by tag name against
   `collectComponentTags`) into the new file's frontmatter.
9. Return
   `{ file: relPath, range: subtreeSpan, replacement: instanceTag, newFile: { path: newComponentPath, content }, hoistedProps, warnings }`.

`patcher.mjs`'s `resolve()` gets one more branch:
`if (edit.op === "extract-component") return resolveComponentExtract(...)`.

**Dispatcher.** After the existing fresh-read + `baseVersion` re-check
(unchanged — already generic over `COMPONENT_OPS`), a new branch: if
`resolution.newFile` is present, `mkdirSync(dirname(absNewPath), { recursive: true })`
then write it with `writeFileSync(absNewPath, content, { flag: "wx" })` — an
OS-atomic create-if-absent that refuses `exists` on `EEXIST`, closing the
same race window the `baseVersion` re-check closes for the primary file —
**before** splicing/writing the primary file. This ordering means the only
possible partial-failure state is "new file exists, original untouched,"
never a dangling reference in the original to a file that failed to write.

**History.** `edit-history.mjs`'s `recordEdit` gains an optional second file:
`recordEdit(projectRoot, { file, range, newFile, message })` where `newFile`
is `{ path }` (content is already on disk by the time this runs) — one more
`hash-object -w` + `update-index --add --cacheinfo` for `newFile.path` staged
into the same temp index before `write-tree`, producing one commit covering
both files. **`undo-edit.mjs` needs no changes** — it already does
`git diff --name-only parent head` and restores whatever files differ, so a
two-file commit undoes both files in one step for free.

This is Approach A of three considered (special-cased dispatcher extension,
mirroring the precedent `replace-image-src` already set by writing files
outside the generic single-splice path). Rejected alternatives: (B) a
generic `{writes: [...]}` array contract refactored across all resolvers —
more general but a real refactor of 10 existing resolvers for a need nothing
else on the roadmap has; (C) three sequential app-driven ops (create-file +
insert-node + remove-node) — no dispatcher changes, but three history
commits instead of one, the app re-fetching `baseVersion` between each call,
and a crash mid-sequence leaving genuinely broken partial state. Rejected
for breaking the "one gesture = one undo step" invariant the rest of the
editor relies on.

## 3. Extractable node kinds

Only `element`, `component`, and `slot` kinds — the same tag-shaped set
`set-attr` already restricts itself to, for the same reason: `resolveAllSpans`
only resolves reliable spans for tag-shaped nodes (plus `expression`, which
is excluded here per Non-goals) and `text`/`fragment` nodes have no lexical
marker to search for or move.

## 4. Prop hoisting algorithm

1. Walk the extracted subtree's `expression`-kind nodes (attribute values
   and text-content expressions), same `byId` traversal `resolveAllSpans`
   already performs.
2. A hoist candidate is an expression whose full text (trimmed) matches
   `/^[A-Za-z_$][\w$]*$/` — a single bare identifier, nothing else. Member
   access, calls, template literals, `&&`/ternaries, etc. are left verbatim
   in the moved markup.
3. A candidate is hoisted **only if** its name appears in
   `parseProps(originalFrontmatterSource)` — i.e. it's one of the *original*
   component's own declared Props (reusing `props-interface.mjs`'s
   `parseProps`, no new scope-analysis logic). Its `type` is copied verbatim
   from that entry, `optional` copied, `default` dropped (the new component
   always receives a concrete value from its one caller). Any bare
   identifier that is NOT one of the original's own Props (a local `const`,
   a loop variable, a global) is left in place, unhoisted — no guessing at
   scope. If it turns out to be genuinely out of scope in the new file, that
   surfaces as an ordinary build/type error, not something the op corrupts
   or silently blocks on.
4. Dedup by name — an identifier referenced twice in the subtree produces
   one hoisted prop; both usages inside the new file remain `{name}`
   unchanged (already the correct destructured name there).
5. `hoistedProps` in the response is the sorted list of names.

## 5. Style-rule migration algorithm

1. Parse each of the original component's `<style>` rules (already
   available via `indexCssRules`, same source `component-model.mjs` uses)
   and classify the selector as **simple** (`/^(\w+)?(\.[\w-]+)*$/` or
   `/^#[\w-]+$/` — tag, class(es), compound tag+class, or id; zero
   combinators) or **complex** (anything else: combinators, pseudo-classes,
   `:global()`, attribute selectors).
2. For each simple selector, check whether it matches (tag/class/id
   equality) at least one node inside the extracted subtree
   (`insideMatch`) and separately whether it matches any node in the
   template that remains after extraction (`outsideMatch`).
3. `insideMatch && !outsideMatch` → move the rule verbatim into the new
   file's `<style>`, remove from the original's.
4. `insideMatch && outsideMatch` → leave in the original;
   `warnings` gets `"<selector> not moved: also used outside the extracted markup"`.
5. `!insideMatch` → untouched, not mentioned in `warnings`.
6. Any complex selector with `insideMatch` → left in the original;
   `warnings` gets `"<selector> not moved: selector too complex to analyze automatically"`.
7. `@media`-wrapped rules are matched by their inner selector the same way;
   if a media block ends up with a mixed move/stay verdict across its
   rules, it's split — a fresh `@media` wrapper is synthesized in whichever
   file needs one, reusing `add-style-rule`'s existing "create the container
   if absent" pattern.

No general CSS-selector-vs-DOM matching engine is built — this is
purpose-built pattern matching against the outline tree's own tag/class/id
data, bounded to the "obvious" case (a class or tag styling the extracted
root or its direct descendants), consistent with this codebase's existing
"deliberately regex/heuristic, refuse rather than guess" discipline
(`parseProps`, `pruneImportIfUnused`).

## 6. Edge cases (summary)

| Case | Behavior |
|---|---|
| `nodeId` is the component root | refuse `invalid-input` |
| `nodeId` kind is text/expression/fragment | refuse `invalid-input` |
| Span can't be lexically re-located | refuse `no-match` |
| `newComponentPath` invalid (not under `src/components/`, wrong extension, traversal) | refuse `invalid-input` |
| `newComponentPath` already exists (resolve-time or write-time race) | refuse `exists` |
| `baseVersion` stale (resolve-time or dispatcher re-check) | refuse `stale` |
| Extracted subtree contains a component-kind descendant | import copied to new file's frontmatter; pruned from original if now unused |
| Non-hoistable expression referencing outer scope | left verbatim — a real build/type error if actually out of scope, never silently corrupted |
| Style rule used both inside and outside the subtree | stays in original, reported in `warnings` |
| Style rule with a combinator/pseudo-class/`:global()` | stays in original, reported in `warnings` |
| Concurrent edit lands between resolve and write | `stale` or `exists`, never a partial/dangling write |

## 7. App-side touchpoints (Anglesite-app, paired PR — no Swift written here)

- **Trigger**: "Extract into Component…" on an outline selection, enabled
  only when the selected node's `kind` is element/component/slot and it
  isn't the root — computable locally from the `ComponentModel` the app
  already holds, no round trip needed just to decide whether to grey it out.
- **Name prompt**: a small dialog collecting `newComponentPath` under
  `src/components/`, defaulting to a PascalCase guess derived app-side from
  the node's tag/heading text (the op itself never guesses a name). A
  client-side existence check is a nice-to-have; the op's `exists` refusal
  is the authoritative check regardless.
- **Request**: `apply_edit` with `op: "extract-component"`,
  `component: { path, baseVersion, nodeId, newComponentPath }`. Same
  `dry_run` support as every other component op, for live preview before
  committing.
- **Response handling**: on `edit-applied`, swap in the piggybacked `model`
  for the outline/canvas; if `result.warnings` is non-empty, surface a
  non-blocking toast/inline note per warning (e.g. "Extracted Hero.astro —
  1 style rule was not moved: `.card` is also used outside the extracted
  markup"). `result.hoistedProps` can drive a short confirmation summary.
- **Navigator**: the new file should appear without a manual refresh needed
  for the *editor* itself; any project-wide file-list cache is a separate,
  existing app-side concern outside this op's response.
- **Undo**: no special handling — one hidden-branch commit, one undo step,
  both files revert together via the existing `undo_edit` flow.

## 8. Testing plan

Following the existing per-op layering
(`tests/apply-edit-schema-*.test.ts`, `tests/component-*-edit.test.ts`,
`tests/apply-edit-dispatcher-*.test.ts`):

- **Schema**: `nodeId` + `newComponentPath` required and validated correctly.
- **Resolver unit tests**: root-extraction refusal; non-tag-kind refusal;
  collision refusal; stale refusal; prop hoisting (own-prop hit, non-prop
  identifier left alone, complex expression left alone, dedup); style
  migration (simple-inside-only moves, shared-stays-with-warning,
  complex-stays-with-warning, media-query split); nested component import
  copy + prune-if-unused on the original.
- **Dispatcher-level**: full round trip writes both files; concurrency race
  test mirroring the existing component-style one (two racing
  `extract-component` calls to the same `newComponentPath`); `dry_run`
  returns both previews and writes nothing; `onApplied`/`recordEdit`
  receives both files and produces one commit; `undo_edit` reverts both
  files from that one commit.

## Open decisions

None — all resolved during brainstorming (2026-07-16).
