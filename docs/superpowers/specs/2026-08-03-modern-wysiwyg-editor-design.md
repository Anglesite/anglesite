# Modern WYSIWYG HTML Editor — vision design

**Date:** 2026-08-03
**Status:** Approved vision design, pre-plan
**Related:** Component Editor (`2026-07-05-component-editor-design.md`, epic #496 — shipped), edit overlay (`JS/edit-overlay/`), #459 (deterministic-path direction), #571 (cross-platform port), #72 (git is the source of truth), `docs/mac-assed-app-spec.md` (platform UX standard for the first host)

## 1. Summary

A vision design for a modern WYSIWYG HTML editor: what a 2026 successor to
Dreamweaver/GoLive/iWeb should be, and the architecture that realizes it. This is
exploratory — no committed delivery target — but it is shaped so that Anglesite can
be its first host.

Decisions made during brainstorming:

| Decision | Choice |
|---|---|
| Scope | **Vision-first** — design the ideal editor, decide where it lands later |
| Audience | **Non-technical owners** — people publishing a site, not learning HTML |
| Design freedom | **Structured blocks** — compose/rearrange semantic blocks; taste stays curated in the theme |
| Canvas | **True render, overlaid** — the canvas *is* the real page render; editing chrome overlays it |
| Block provenance | **Theme-defined components** — blocks are real component files with typed props/slots |
| Modern core | **Responsive-first editing, on-device AI, live quality gates, real-time collaboration** — all core, not bolt-ons |
| Architecture | **Portable engine (Approach B)** — TypeScript overlay engine + semantic ops protocol; Anglesite/MCP is the first host |

## 2. Lessons from thirty years of WYSIWYG editors

Reviewed the field (per the [Wikipedia HTML-editor survey](https://en.wikipedia.org/wiki/HTML_editor)
plus product history) before designing. The generations and their verdicts:

- **Page-as-document era** (Claris Home Page, PageMill, FrontPage, NetObjects
  Fusion): radical approachability, but table-soup or proprietary output.
  FrontPage's server extensions and generated markup taught: *lock-in via
  generated markup kills trust*.
- **Site-aware professional era** (GoLive, Dreamweaver, Nvu/KompoZer):
  Dreamweaver survived on **Roundtrip HTML** — never mangle hand-written markup —
  and **editable regions** (locked structure, editable content), the ancestor of
  every slot model. Nvu proved an embedded engine can be the canvas, and that
  `contenteditable` without a model underneath produces sludge.
- **Design-first native era** (iWeb, RapidWeaver, Freeway, Muse): iWeb was the
  most approachable editor ever shipped and a markup dead end.
  *Approachability without a real HTML model is a trap door.*
- **Current era** (Webflow, Framer, Pinegrow): the breakthrough — edit the **box
  model itself** through a visual surface; the DOM/CSS is the artifact, not a
  compilation target.

Distilled lessons this design is built on:

1. **Roundtrip or die** — the editor must never own the markup; visual and hand
   edits coexist. (Anglesite's "git is the source of truth" is this principle.)
2. **Edit the model, not the paint** — manipulate real semantics through a visual
   surface; never paint pixels and generate markup to match.
3. **Semantics need a home** — "bold, but *why* bold?" is solved by components
   and slots, not toolbars.
4. **Site-scoped beats page-scoped** — winners managed assets, links, templates,
   deploy. The file-based SSG renaissance re-validated file-backed WYSIWYG.

## 3. Architecture: engine / protocol / host

Three layers, strictly separated.

### 3.1 The Engine

A dependency-free TypeScript library injected into the **true render** — the
site's dev-server output in a webview or ordinary browser. It owns everything the
owner touches: block selection and handles, inline text editing, drag-to-rearrange,
the block palette, breakpoint views, quality-gate chips, collaborator presence.

The engine **never mutates the DOM as an act of editing**. The DOM it lives in is
a projection; every user gesture becomes a semantic operation sent to the host.

### 3.2 The Ops Protocol

The seam that makes the engine portable. Two directions:

- **Engine → host:** a small vocabulary of semantic edit operations —
  `insertBlock`, `moveBlock`, `deleteBlock`, `setProp`, `editText` (rich-text
  runs), `setDesignToken` — each targeting stable block IDs.
- **Every op is invertible — no op ships without its inverse.** This is a hard
  protocol requirement, not an implementation detail: it is what lets a native
  host register real undo (`NSUndoManager` on macOS) with truthful action names,
  typing coalescing, and undo state that survives focus changes and webview
  reloads — the failure that sank every `contenteditable`-based editor. It is
  also what makes ops CRDT-mergeable (§7) and AI outcomes reviewable (§6).
- **Host → engine:** the block-tree model (component instances with typed
  props/slots, source spans, content-hash version — the shape
  `get_component_model` already established) plus re-render notifications.

Versioning by **content hash** means the engine always knows when its model is
stale — including after hand edits in an outside editor. Roundtrip honesty is
structural, not aspirational.

### 3.3 The Host

Anglesite first. Applies ops to real source via the sidecar's compiler-backed
model service, commits to git, lets the dev server re-render (HMR closes the
loop), and provides the services the engine must not own: AI (on-device FM),
quality-gate analysis, collaboration transport, asset ingestion. A future
iOS/Linux/web host (#571) reimplements only this layer.

**Why engine-first over an Anglesite-only epic:** the ops protocol is the only
shape that serves the cross-platform roadmap, and the only shape where real-time
collaboration is tractable. The cost is protocol design up front and a slower
first demo. A standalone framework-agnostic product was considered and ruled out
for now (block mapping without a compiler-grade parser per framework is a
research project); the engine leaves that door open.

## 4. Block model and honest text editing

- A **page** is a tree of blocks. A **block** is either a theme component
  instance (props + slots) or a content element inside a rich-text slot.
- The **theme declares its block palette** in a manifest: name, icon,
  owner-facing description, prop editors, placement rules. Taste and markup
  quality are the theme author's craft; the editor is a component composer
  underneath.
- Content pages stay markdown/MDX where they are today. `editText` ops write
  markdown / semantic HTML runs: the owner sees a "bold" button, the source gets
  `**…**`/`<strong>` — never styled spans.
- The WYSIWYM lesson lands as: **inline formatting is the small honest set**
  (strong, emphasis, link, code); everything richer is a block, where semantics
  are carried by the component.

## 5. Responsive-first canvas

Breakpoints are **views, not modes**: the canvas shows the same true render at
phone/tablet/desktop widths — switchable always, side-by-side when the window
allows.

The owner edits *content and composition*, which apply at every width by
construction. Responsive *styling* is theme craft, not owner homework. The
editor's responsive job is **awareness** (e.g. a "this heading wraps awkwardly on
phones" nudge from the quality gates), never per-breakpoint style authoring.
This welds the iWeb trap door shut: owners cannot create a desktop-only design
because the tools to do so do not exist at their tier.

## 6. AI assistance and quality gates

Both are **host services the engine requests**, keeping the engine portable and
the intelligence swappable.

**AI — assistive, never authoritative:**

- Writing help inside text blocks (rewrite, tighten, tone).
- Alt-text proposals on image insert.
- Block-level suggestions ("this looks like a testimonial — use the Testimonial
  block?").
- Every AI outcome lands as the same deterministic ops a human gesture would
  produce — reviewable, undoable, diffable. On Apple hosts this is on-device FM;
  a host without AI hides the affordances.

**Quality gates — the expert in the room:**

- After each op, the host re-analyzes the affected subtree: contrast, alt text,
  heading order, link integrity, image weight.
- Findings stream to the engine as advisory chips anchored to blocks, phrased in
  owner consequences ("photos this big load slowly on phones"), never lint
  jargon.
- Where the right answer is known (resize an oversized image, fix a heading
  skip), it is a one-tap *apply* — consistent with "the app advises; it does not
  delegate the decision."
- The existing pre-deploy gate remains the hard backstop; the editor's gates are
  its live, gentle front end.

## 7. Collaboration

The layered architecture is what makes collaboration tractable for a git-backed
file model:

- **Solo (default):** ops apply straight to source; git commits as save-points.
  Zero collaboration overhead.
- **Live session:** ops are CRDT-mergeable by design — tree-move semantics for
  the block tree, text CRDT for rich-text runs — relayed through a host-provided
  session (a Cloudflare Durable Object is the obvious transport given the
  stack). One host is the **writer**, folding the converged stream into source
  commits; peers (a helping friend, a second device, a shared draft link with
  the engine in an ordinary browser) run the engine only.
- **Git stays the source of truth:** a session is an ephemeral overlay whose
  checkpoints are commits; history never forks into a proprietary sync store.
- Presence (cursors, courtesy block locks — advisory, not enforced) rides the
  same channel.

## 8. The Mac-assed host

The engine/host split is what makes a platform-native editor possible: the classic
web-editor failure mode (Webflow-in-a-window) happens when the editor's whole UI
lives in the web canvas. Here the engine owns only in-canvas selection and text
chrome; **everything else is native UI driving the same ops protocol.** The first
host must meet `docs/mac-assed-app-spec.md`; the requirements below are the
editor-specific consequences, and each future host owes its platform the
equivalent (per the platform-UX standards in `AGENTS.md`).

### 8.1 The menu bar is a first-class client of the ops protocol

Every editing command is a menu item that emits ops — the engine is never the
only home of a command:

- **Insert menu** lists the theme's block palette by its owner-facing manifest
  names (*Insert ▸ Testimonial*), like Pages.
- **Format menu:** ⌘B/⌘I/⌘K route to `editText` ops on the canvas selection;
  standard shortcuts keep standard meanings.
- **Block commands:** Move Block Up/Down (⌥⌘↑/↓), Duplicate (⌘D), Delete —
  enablement via `focusedSceneValue` off the current selection.
- **Right-click on a block shows a real `NSMenu`**, never a web context menu:
  the engine hit-tests and reports the block under the cursor; the host builds
  the menu.

### 8.2 Undo through `NSUndoManager`

Invertible ops (§3.2) register their inverses with the window's undo manager:
real Edit ▸ Undo/Redo with truthful names ("Undo Move Block", "Undo Typing"),
typing coalescing, and undo that lives in the host — never lost to a webview
reload.

### 8.3 Native panels around the canvas

- **Inspector, not floating web panels:** block props edit in a right-hand
  inspector with system controls (steppers, color wells with the system color
  panel, pop-up buttons) — the typed-prop editors, rendered natively.
- **Palette as a native source list** dragged *from* into the canvas;
  cross-boundary drops land as `insertBlock` ops at the engine-computed index.
- Toolbar uses `.toolbar(id:)` so Customize Toolbar works.

### 8.4 Files, clipboard, drag and drop

- **Drag an image from Finder or Photos onto the canvas** → asset ingestion +
  image block + AI alt-text proposal in one gesture.
- **Paste is semantic:** rich text from Pages/Word/Safari maps to blocks and
  honest inline runs; ⇧⌥⌘V Paste and Match Style does what it says; copying a
  block puts real HTML + plain text on the pasteboard.
- Window title = page title with the **document proxy icon pointing at the real
  source file** (git honesty made visible); edited-dot tied to uncommitted ops;
  ⌘F opens the native find bar (aligns with the #517 editor-find design).

### 8.5 Text services — flagged risk

In-canvas text lives in WKWebView. WebKit inherits much of the system text stack
(spelling, dictation, input methods, autocorrect largely work in editable web
content), but **Services, Look Up, and grammar must be verified, not assumed** —
this is an acceptance-checklist item. If WKWebView falls short, bridge to the
platform rather than accept degraded interaction: the contingency is a native
`NSTextView` editing session overlaid on the active block, committing to
`editText` ops on end.

### 8.6 Keyboard, accessibility, system integration

- **Keyboard-only editing grammar:** arrows move block selection, Return enters
  text editing, Tab walks props, Escape exits the deepest context first
  (text → block → none).
- **VoiceOver navigates blocks by their owner-facing manifest names** — the
  block model doubles as the accessibility model.
- **App Intents over the same ops** ("Append a post to my blog") for
  Shortcuts/Spotlight — deterministic ops are the right substrate for intents
  and future FM tools.
- Share menu for collaboration draft links; Quick Look on `.anglesite` packages.

### 8.7 Documented convention departure

The canvas renders the **site's** appearance, not system light/dark — correct,
because the canvas is the artifact. The chrome around it adapts to system
appearance; reduced-motion governs editing animations.

## 9. Error handling

- Every op carries the model version (content hash) it targeted. On mismatch the
  host rejects with the fresh model; the engine replays or drops the gesture
  **visibly** — no silent loss.
- Failed renders (e.g. broken frontmatter from an outside edit) degrade the
  canvas to a "this page needs attention" state, never a blank webview.
- All host op-handling is logged like any subprocess — no silent failure paths.

## 10. Testing

The protocol seam is the test surface:

- **Engine:** headless Playwright against a *fixture host* — golden tests for
  gesture → ops and model → chrome rendering.
- **Ops vocabulary:** golden round-trip tests (op → source diff → re-parsed
  model) in the sidecar's node:test suite.
- **CRDT merge:** property-based convergence tests.
- **Swift host layer:** stays thin; logic pushed into testable core types per the
  existing pattern.

## 11. Out of scope (YAGNI)

- Per-breakpoint style authoring for owners (theme craft, by design).
- A designer/developer tier (progressive disclosure) — the Component Editor
  already serves the pro tier in Anglesite; revisit only if the vision leaves
  Anglesite.
- Framework-agnostic hosting (non-Astro) — the protocol permits it; no work is
  spent on it now.
- Enforced locking / permissions in collaboration — courtesy locks only.

## 12. Next steps

This is a vision document. Before any implementation plan:

1. Decide the landing target (expected: Anglesite, superseding the route
   click-to-edit overlay with the block editor).
2. Slice the vision into epics (protocol + model service, engine core, canvas
   chrome, Mac host chrome (menus/undo/inspector, §8), gates, AI services,
   collaboration) — collaboration last.
3. Open tracking issues per `CONTRIBUTING.md` before code.
