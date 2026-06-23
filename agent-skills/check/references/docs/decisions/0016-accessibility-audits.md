---
status: accepted
date: 2026-05-04
decision-makers: [Anglesite maintainers]
---

# Run automated accessibility audits with severity-aware gating

## Context and Problem Statement

Accessibility is part of Anglesite's brand promise (`template/CLAUDE.md` calls out "accessible by design — WCAG AA minimum") and is also the legal floor in the United States under the Americans with Disabilities Act. Until now the `/anglesite:check` skill only ran a small set of heuristic checks via `scripts/a11y-validate.ts` and an optional one-shot `pa11y dist/index.html` invocation. That is not enough to catch the four most common WCAG 2.1 AA violations: alt text, color contrast, label association, and landmark structure.

Anglesite needs an automated audit that:

* Produces a per-page WCAG 2.1 AA report
* Suggests fixes inline so a non-technical owner can act on the report
* Returns severity-aware exit codes so it can be wired into CI (or Cloudflare's build system) later
* Can be turned into a deploy gate when the owner is ready, and reverted to warn-only while a legacy site is being remediated

The same family of decisions already exists for security (ADR-0007) and link health (the opt-in `LINK_CHECK_DEPLOY` gate). Accessibility belongs in the same family.

## Decision Drivers

* Accessibility findings are as serious as security findings — they exclude real customers
* The audit must work without requiring the owner to install browsers (default to heuristic-only)
* Owners who want full coverage should be able to opt in to pa11y or axe-core without changing the skill flow
* The deploy gate must be off by default so first-time owners aren't blocked by a legacy site
* Mid-remediation sites need a warn-only mode so the gate doesn't trap them

## Considered Options

* **Single audit script that orchestrates heuristic + pa11y + axe-core, with severity-aware exit codes** (chosen)
* Make pa11y a hard dependency in `template/package.json` and require it on every check
* Build everything on top of axe-core and skip pa11y
* Only run the heuristic checks already present in `scripts/a11y-validate.ts`

## Decision Outcome

Chosen option: "Single audit script that orchestrates heuristic + pa11y + axe-core". The script (`template/scripts/a11y-audit.ts`) walks every HTML file in `dist/`, runs whichever checkers are installed, aggregates results into a unified per-page report with suggested fixes, and exits with severity-aware codes (`0` clean, `1` errors, `2` warnings only).

The `/anglesite:check` skill always runs the audit. The `/anglesite:deploy` skill runs it only when the owner has opted in via `A11Y_GATE=true` in `.site-config`. A second flag, `A11Y_WARN_ONLY=true`, lets the gate run without blocking — useful while a site is being brought up to WCAG 2.1 AA.

### Consequences

* Good — owners get a real WCAG 2.1 AA report per page during `/anglesite:check`, with concrete fix suggestions.
* Good — pa11y and axe-core are optional, so first-time owners aren't slowed down by a Chromium install.
* Good — exit codes are predictable for CI (`1` for errors, `2` for warnings, `0` for clean), so the script can be dropped into a GitHub Action or Cloudflare build without further work.
* Good — `A11Y_WARN_ONLY` lets a legacy site enable the gate without trapping the owner during remediation.
* Bad — the heuristic-only mode misses contrast and landmark issues, so the report is partial until the owner installs pa11y or axe-core.
* Bad — keeping rule-to-suggestion mappings up to date requires periodic maintenance as axe-core and pa11y add rules.

### Confirmation

`scripts/a11y-audit.ts` is invoked from the `/anglesite:check` skill (always) and from the `/anglesite:deploy` skill (when `A11Y_GATE=true`). The unit tests in `tests/a11y-audit.test.ts` cover severity classification, exit-code computation, suggestion lookup, and report aggregation.

## Pros and Cons of the Options

### Single audit script that orchestrates heuristic + pa11y + axe-core

* Good, because the heuristic pass always works — no install required to get *some* signal.
* Good, because pa11y and axe-core can be added incrementally for full WCAG 2.1 AA coverage.
* Good, because the orchestrator deduplicates the "which tool produced this?" choice into one consistent report.
* Bad, because it adds another script to maintain alongside `pre-deploy-check.ts` and `link-check.ts`.

### Make pa11y a hard dependency

* Good, because every owner gets full coverage from day one.
* Bad, because pa11y pulls in Puppeteer/Chromium (~150 MB), which slows down the first `npm install` substantially.
* Bad, because a non-technical owner who doesn't care about accessibility tooling still pays the cost.

### Build everything on top of axe-core and skip pa11y

* Good, because axe-core has a more modern rule engine and richer remediation context.
* Bad, because axe-core requires Playwright, which is even heavier than pa11y's Puppeteer.
* Bad, because pa11y-ci has a sitemap mode that maps cleanly to a multi-page Astro site.

### Only run the existing heuristic checks

* Good, because no new dependencies or scripts.
* Bad, because the heuristic pass cannot detect the four most common WCAG 2.1 AA violations (contrast, label association, landmark structure, ARIA misuse).
* Bad, because it does not satisfy the brand promise of "accessible by design — WCAG AA minimum".

## More Information

The audit script is invoked as `npm run ai-a11y` in the user's project. Owners can wire it into CI by running `npm run ai-a11y -- --json` and reading the exit code; the JSON output makes it easy to surface findings in PR comments. See `template/docs/accessibility.md` for the editorial guidance the audit complements (alt text quality, contrast, heading structure, links, forms, video, PDFs).
