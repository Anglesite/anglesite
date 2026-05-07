---
name: redirects
description: "Manage the _redirects file: add, remove, list, validate, and bulk-import redirects (301 / 302 / 308)"
argument-hint: "[add | remove | list | validate | import | review]"
allowed-tools: Read, Write, Edit, Glob, Bash(grep *), Bash(find *), Bash(wc *), Bash(sort *), Bash(awk *), Bash(test *), Bash(ls *), Bash(cat *)
disable-model-invocation: true
---

Manage redirects in `public/_redirects` so old URLs keep working when pages are renamed, content is imported from another platform, or the site's URL structure changes. The owner shouldn't have to hand-edit the file or learn the `_redirects` syntax.

The canonical store is `public/_redirects`. Imports and SSG conversions stage their proposed mappings at `.anglesite/url-map.csv` so the owner can review them before they go live.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — `_redirects` is read by Cloudflare Workers Static Assets at the edge (no custom Worker code required)
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — redirects are stored as plain text in the owner's repo, not in a third-party service

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain in plain English before editing files. If `false`, proceed without pre-announcing.

## Redirect file format

Cloudflare Workers Static Assets reads `public/_redirects`. Each non-empty, non-comment line is one rule:

```
/from /to [status]
```

- **From** — request path (supports `*` wildcards and `:placeholder` segments)
- **To** — destination path or absolute URL
- **Status** — optional, defaults to `302`. Anglesite uses three values:
  - `301` — permanent redirect (the right choice for renames; preserves SEO)
  - `302` — temporary redirect (the page might come back; default if omitted)
  - `308` — permanent, preserves the HTTP method (use only if the source receives POST/PUT requests)

Comments start with `#`. Blank lines are allowed and Anglesite preserves them.

Cloudflare evaluates rules top to bottom and stops at the first match. The hard limits are 2,100 static rules and 100 dynamic (wildcard / placeholder) rules per project — surface a warning to the owner once either category passes 80% of the limit.

## Step 0 — Locate the file and parse the action

Verify `public/_redirects` exists. If it doesn't, scaffolding never ran — tell the owner: "I can't find `public/_redirects`. This usually means the site hasn't been scaffolded yet — try `/anglesite:start` first." Stop.

Read `$ARGUMENTS`. Map to one of:

| Argument | Action |
| --- | --- |
| `add` (or empty + the owner says "add") | Add one redirect interactively |
| `remove` / `delete` | Remove a redirect interactively |
| `list` / `show` | Print every active rule grouped by status |
| `validate` / `check` | Run all validation checks, report findings |
| `import` / `csv` | Bulk import from a CSV file |
| `review` / `pending` | Apply or reject staged entries from `.anglesite/url-map.csv` |

If `$ARGUMENTS` is empty and there is a non-empty `.anglesite/url-map.csv` waiting, default to `review` (the import/convert skills just ran and produced these). Otherwise ask: "What would you like to do — add a redirect, remove one, list what's there, validate the file, or import a CSV?"

## Step 1 — Read existing rules

Parse `public/_redirects` into rules and preserved lines. Each rule has:

- `source` — the from path
- `target` — the to path
- `status` — number (301, 302, 308)
- `lineNumber` — for editing
- `original` — the verbatim line, so comments aligned to a rule are not lost

Anything that isn't a rule (blank line, comment line) is preserved verbatim and rewritten in place when the file is updated.

## Add a redirect

Ask the owner three questions in plain language:

1. **"What's the old URL path? (the one that's about to break, e.g. `/old-page` or `/2024/03/launch`)"**
2. **"Where should it go now? (e.g. `/about`, `/blog/new-launch`, or a full URL like `https://example.com/elsewhere`)"**
3. **"Is this permanent (the page is gone for good) or temporary (it might come back)?"** — map permanent → `301`, temporary → `302`. Only ask about `308` if the owner mentions form submissions or webhooks — most small business sites never need it.

Normalize both paths:

- Add a leading `/` if missing (unless it's an absolute URL)
- Strip a trailing `/` from internal paths unless the path is just `/`
- Reject empty paths and self-referential rules (`source == target`)

Run all the validations in [Validate](#validate) against the prospective new rule. If any fire, tell the owner what's wrong and let them adjust before writing. If everything passes, append the rule.

Confirm in plain English: "Done. Anyone visiting `/old-page` will now land on `/about` — and search engines will know it's a permanent move."

## Remove a redirect

Show the rules numbered. Ask the owner which to remove (by number or by source path). If they reference a path that has multiple matches (e.g., a wildcard plus a literal), list them and let them pick.

Before deleting, warn if the removal could break inbound links — if the source looks like an old platform path (`/wp-content/`, `/post/`, `/p/`), remind the owner that external sites may still link to it.

Remove the line, preserve surrounding comments, write the file. Confirm what was removed.

## List rules

Print rules grouped by status, in source order:

```
Permanent (301) — N rule(s)
  /old-page         → /about
  /2024/03/launch   → /blog/launch
  /post/*           → /blog/:splat

Temporary (302) — N rule(s)
  /events           → /

Method-preserving (308) — N rule(s)
  (none)
```

If the file has more than ~20 rules, also show the wildcard / placeholder count and the limit utilization (e.g., "12 of 100 dynamic rules used").

## Validate

Run every check below on the full file. Group findings by severity using the same vocabulary as `/anglesite:check`:

- **Worth fixing soon** — duplicates, loops, file-route conflicts (these break behavior or surprise visitors)
- **All good (heads up)** — chains, missing 301-vs-302 hints, near-limit warnings

### Checks

1. **Duplicate sources** — two rules with the same `source`. Cloudflare uses the first; the rest are dead. Report all duplicates with their line numbers.
2. **Self-redirect loops** — `source == target`. Always an error.
3. **Multi-hop chains** — a rule's `target` is the `source` of another rule. Flag chains > 1 hop. Suggest collapsing to a single rule.
4. **Cycles** — A → B → A or longer cycles. Always an error; refuse to write a new rule that would create one.
5. **File route conflicts** — the `source` matches an existing built page. Build the route set from `src/pages/**/*.{astro,md,mdoc,html}` and from any directory under `src/content/` that has a configured collection. A redirect from `/about` is shadowed by `src/pages/about.astro` — Cloudflare serves the static file first, so the redirect never fires. Report and recommend removing or renaming.
6. **301 vs 302 sanity check** — temporary (`302`) redirects to a clearly-permanent destination (e.g., a renamed slug, no original page in `src/pages/`) get a hint that `301` would be better for SEO. This is informational only.
7. **Reserved paths** — sources that overlap with framework or platform internals (`/_astro/*`, `/_pagefind/*`, `/admin/*`, `/keystatic/*`, `/api/*`). Always a warning.
8. **Limit pressure** — count static vs. dynamic (anything containing `*` or `:`) rules. Warn at 80% of 2,100 / 100 respectively.
9. **Status code sanity** — only `301`, `302`, `308`, or `200` (passthrough) are allowed in this skill. Anything else is a typo.

For each finding, include the line number and the rule text so the owner can locate it. Offer to fix the auto-fixable ones (duplicates, self-loops, status typos) in place.

## Bulk import from CSV

Owners migrating from another platform usually have a spreadsheet of old → new URL pairs. Accept any CSV with at least two columns. The first row may or may not be a header — detect by checking whether row 1's first cell parses as a path (starts with `/` or `http`).

Recognized columns (case-insensitive):

| Column | Aliases | Required |
| --- | --- | --- |
| `from` | `source`, `old`, `old_url`, `old url`, `path` | yes |
| `to` | `target`, `new`, `new_url`, `new url`, `destination` | yes |
| `status` | `code`, `type` | no — defaults to `301` for bulk migrations |

Ask the owner for the CSV path. Read it, parse with a minimal CSV reader (handle quoted fields, escaped quotes, `\r\n`, comma or tab separators). Reject the file if any required column is missing.

For each row:

1. Normalize source and target.
2. Run all validations against the existing rule set + everything imported so far.
3. Stage rule as accepted, rejected (with reason), or duplicate (already in `_redirects`).

Present a summary before writing:

> "I read **312 rows** from `migrations/redirects.csv`:
> - **287** look good and will be added
> - **18** are already in your redirects file (skipped)
> - **5** would create loops or duplicate sources (skipped — listed below)
> - **2** point to pages that don't exist yet (added anyway, but you may want to create those pages)"

If the owner approves, append the accepted rules in a single block prefixed with `# Imported from <filename> on YYYY-MM-DD` so the provenance is obvious in diffs.

## Review URL maps from `/anglesite:import` and `/anglesite:convert`

When `/anglesite:import` or `/anglesite:convert` runs, it appends rules directly to `public/_redirects` and also drops the same rules — with provenance — into `.anglesite/url-map.csv`. The CSV format is `from,to,status,note,source` where:

- `note` describes the reason (`platform-rename`, `wix-opaque-slug`, `app-page-placeholder`, etc.)
- `source` is the originating skill (`import:wordpress`, `convert:hugo`, etc.)

This file is the audit trail for everything those skills added, and it lets `/anglesite:redirects review` highlight rules the owner may want to revisit (especially `app-page-placeholder` 302s that should become 301s once a replacement tool is configured).

When this skill is invoked with `review` (or by default if a non-empty `.anglesite/url-map.csv` exists):

1. Read the staged file and the live `public/_redirects`. Tell the owner: "Your last import added **N** redirects. Want me to walk through them?"
2. Run all validations against the live rule set, paying special attention to entries that are present in both files (the live rule plus the audit row).
3. Group findings:
   - **Already live, looks healthy** — count only, no action needed.
   - **Needs a decision** — duplicates, file-route conflicts, loops introduced after import. Offer to remove or rewrite each.
   - **Worth revisiting later** — every row tagged `app-page-placeholder` (302 → `/`). Suggest replacing with a `301` once the owner sets up the replacement tool (booking, store, etc.).
4. After the owner finishes reviewing, **delete `.anglesite/url-map.csv`** so the next import starts with a clean audit trail. If the owner skips review, leave the file in place — it'll surface again next run.

## Writing back the file

When updating `public/_redirects`:

1. Preserve every comment and blank line that was in the original.
2. Append new rules at the end, separated from prior content by one blank line and a `# Added <action> YYYY-MM-DD` comment if more than three rules are added at once.
3. End the file with a single trailing newline.
4. Never reorder existing rules — the order is significant in `_redirects`, and changing it can change which rule wins.

## After any change

If `public/_redirects` was modified, suggest the owner run `/anglesite:check` to verify the build is still clean and `/anglesite:deploy` to publish.

If 5+ rules were added, also remind the owner that 301s are cached aggressively by browsers — testing should be done in a private window or after clearing the cache.

## Edge cases

### Wildcard and placeholder rules

Cloudflare's `_redirects` supports `*` (greedy match) and `:name` (single-segment placeholder) in `from`, with `:splat` and `:name` available in `to`. Examples:

```
/post/*       /blog/:splat   301
/u/:user      /authors/:user 301
```

Wildcards count against the 100-rule dynamic limit. Warn if the owner is adding many similar rules that could be collapsed into one wildcard.

### Passthrough (status 200)

`/old /new 200` rewrites internally without changing the URL the visitor sees. This is occasionally useful (serving the same content under two paths) but easy to misuse — confirm intent before adding a `200` rule, and only allow it when the owner explicitly asks for "rewrite" or "alias" rather than "redirect."

### External destinations

If `to` is an absolute URL (`https://...`), the redirect leaves the site. Confirm the owner intends this, especially for `301` — search engines will transfer authority to the external domain.

### Rules pointing to deleted pages

If a rule's target doesn't resolve to a built page or another redirect, list it as a warning during validation. Do not auto-delete — the page may be added later.

### Empty or malformed lines

If `_redirects` contains a malformed line (not a comment, but doesn't parse as a rule), surface it as an error during validation with the line number. Offer to remove or fix it.

### Owner hand-edited the file

Always re-read `public/_redirects` at the start of the skill — never cache. The owner may have edited it directly, and the skill should treat the on-disk file as truth.

## Keep docs in sync

If the change is significant (5+ rules added, a bulk import, removal of a category of rules), append a one-line note to `docs/architecture.md` describing what changed and why.
