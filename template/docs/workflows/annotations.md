# Annotations Workflow

Annotations are spatial feedback notes pinned to specific elements on specific pages. Site owners (or collaborators) place them via the browser dev toolbar overlay; you consume and resolve them via MCP tools.

## Tools

The annotation MCP server (`anglesite-annotations`) exposes three tools:

| Tool | Purpose |
|---|---|
| `list_annotations(path?)` | List unresolved annotations, optionally filtered by page path |
| `add_annotation(path, selector, text)` | Pin a new note to a page element |
| `resolve_annotation(id)` | Mark an annotation as resolved after addressing it |

## Discovery

Check for annotations at these moments:

1. **Start of session** — Call `list_annotations()` to see if there are open notes before doing anything else
2. **Before editing a page** — Call `list_annotations(path)` for the page you're about to edit, so you can address notes in the same pass
3. **When the owner asks** — "Check my notes", "Are there any feedback items?", "What needs fixing?"

If there are no unresolved annotations, proceed normally. Don't mention annotations unless there are open ones.

## Acting on annotations

Each annotation includes:

- `id` — unique 8-character identifier (for resolving)
- `path` — the page it's on (e.g., `/about`)
- `selector` — CSS selector of the target element (e.g., `main > h1`)
- `sourceFile` — (optional) resolved source file path (e.g., `src/pages/about.astro`)
- `text` — the feedback note (e.g., "Make this heading larger and bolder")
- `resolvedAt` — ISO timestamp set when the annotation is resolved

Interpret each annotation as a spatially-grounded instruction:

1. **Locate the source file** — Map the page `path` to its Astro source file (e.g., `/about` → `src/pages/about.astro`)
2. **Find the element** — Use the `selector` to identify which element in the source the note refers to
3. **Apply the change** — Edit the source file to address the feedback
4. **Resolve** — Call `resolve_annotation(id)` immediately after addressing each note

### Resolution rules

- Resolve one annotation at a time — this gives the owner clear feedback on what was changed
- If you cannot address an annotation (ambiguous request, conflicting with other elements, requires owner input), leave it unresolved and tell the owner what you need
- Never silently skip an annotation — either resolve it or explain why you can't
- After resolving all annotations on a page, run `npm run build` to verify your changes compile

## Adding annotations

You can also create annotations when you notice issues during your own review:

- Spotted a design inconsistency but it's not your current task → `add_annotation()` for later
- Owner asked you to review the site and you found issues → add annotations so they appear in the overlay
- Flagging something for another collaborator → add an annotation with clear instructions

## Storage

Annotations are stored in `annotations.json` at the project root. This file is auto-managed by the MCP server — don't edit it directly. It's gitignored by default since annotations are transient feedback, not permanent content.
