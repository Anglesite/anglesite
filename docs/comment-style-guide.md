# Comment style guide

This repo generates an Xcode docset from `///` doc comments via DocC (see "Building docs
locally" below). This guide describes how to write comments so that both the generated docset
and the raw source stay useful to the next person (or agent) reading them.

## Philosophy

Comments explain **why**, not **what**. A well-named type or function already says what it does;
repeating that in a comment is noise. Explain the constraint, the rationale, the workaround, or
the non-obvious consequence instead. Most of this codebase already does this well — doc comments
here tend to read like short design notes, often citing the issue that motivated them
(`Sources/AnglesiteCore/NewSiteDraft.swift:90`, for example, explains *why* a field is optional,
not just that it is).

## Doc comments (`///`)

Every `public`/`open` declaration gets a `///` doc comment: a lead sentence stating what the
symbol is or does, followed by prose covering rationale, constraints, or edge cases where they
exist.

**Formal `- Parameter:`/`- Returns:`/`- Throws:` tags are required on new or changed public API**
going forward. They're not required retroactively — most of this codebase's ~500 already-
documented files predate this rule and won't be mass-edited to add them. If you're touching one
of those files for an unrelated reason, bringing its doc comments up to this standard is welcome
opportunistic cleanup, not required.

Example (`Sources/AnglesiteCore/WorkerComposition.swift:109-124`):

```swift
/// Generates a wrangler.toml for a site with the given workers enabled.
///
/// - Parameters:
///   - siteName: The Worker name (used as the Cloudflare Workers project name).
///     Must match `[A-Za-z0-9_-]+`.
///   - workers: The effective active `@dwk/workers` catalog descriptors. Empty = static-only
///     deploy.
///   - routeClaims: The effective active dynamic-route claims (#746), already validated by
///     `WorkerRouteClaims.activeClaims`. Emitted as selective `[assets].run_worker_first`
///     patterns so *only* claimed routes bypass asset-first serving — a static asset can no
///     longer shadow an active dynamic route, while every unclaimed path keeps Cloudflare's
///     asset-first fallback. Omitted entirely when there are no active dynamic routes.
/// - Returns: A complete wrangler.toml string.
/// - Throws: ``ConfigError/invalidSiteName(_:)`` if `siteName` contains
///   characters outside `[A-Za-z0-9_-]`, or ``ConfigError/invalidRouteClaim(path:reason:)``
///   for a claim that never passed `WorkerRouteClaims` validation.
public static func generateWranglerToml(...) -> String
```

Skip the tags when a function has zero or one self-explanatory parameter, no meaningful return
value, and doesn't throw — a bare lead-sentence doc comment is enough there. Use judgment: the
tags exist to add clarity a signature doesn't already give you, not to pad every declaration.

## DocC-specific syntax

- **Symbol links:** double backticks (` ``TypeName`` `` or ` ``TypeName/member(_:)`` ``) create a
  resolved, clickable link in the generated docset. Single backticks (`` `TypeName` ``) render as
  plain code with no link — use those for code that isn't a real symbol in this package (a
  parameter's literal value, a shell command, etc).
- **Callouts:** `- Important:`, `- Note:`, and `- Warning:` render as highlighted callout boxes in
  the docset. Use them sparingly, for things a reader could otherwise miss (a genuinely
  surprising constraint, not routine information already covered in prose).
- **`// MARK: -` vs `// MARK:`:** a `// MARK: -` (with the trailing dash) becomes a Topic section
  divider in the generated docset, in addition to its usual Xcode jump-bar behavior. A plain
  `// MARK:` (no dash) is jump-bar-only — invisible to DocC. Use the dash form when a MARK groups
  related public API that should also read as a group in the docset; use the plain form for
  private/internal organization that shouldn't show up there at all.
- **`.docc` landing pages:** a catalog's landing page is a Markdown file named after the module it
  documents (`AnglesiteAppCore.md` inside a catalog documents the `AnglesiteAppCore` module),
  starting with `# \`\`ModuleName\`\`` and an optional `## Topics` section listing `<doc:>` or
  double-backtick links to group related symbols. See
  `Sources/AnglesiteApp/Anglesite.docc/AnglesiteAppCore.md` for a real example.

## Inline comments (`//`)

Line-level only, and only when the *why* isn't obvious from the code itself: a hidden constraint,
a workaround for a specific bug (link the issue), a non-obvious invariant. If removing the
comment wouldn't leave a future reader confused, don't write it. Don't describe what the next
line does — the code already does that better than a comment can.

## Building docs locally

Two ways to generate documentation, depending on what you need:

- **Fast, single-module iteration**:
  ```sh
  swift package generate-documentation --target AnglesiteCore --warnings-as-errors
  ```
  Add `--warnings-as-errors` to match CI's strictness while iterating locally. **Don't drop
  `--target`** — with no target filter, the plugin documents every target in the whole dependency
  graph, including vendored third-party packages whose doc comments you don't control and can't
  fix. CI passes an explicit list of this repo's own targets; copy that list from
  `.github/workflows/ci.yml`'s `docs-docc` job (or `AGENTS.md`/`CONTRIBUTING.md`) to generate docs
  for everything at once.

- **The full merged docset** — app entry point, every module, and the container runtime, as one
  browsable archive in Xcode's Developer Documentation window (Product ▸ Build Documentation, or
  ⌃⌘⇧D). **Local-only** — this needs `xcodebuild`, `xcodegen generate` to have already run, and a
  Mac that can build `AnglesiteContainer` (the hosted CI runner can't, which is why CI uses the
  `swift package` path above instead):
  ```sh
  xcodebuild docbuild -scheme Anglesite -destination 'platform=macOS'
  ```
