---
status: accepted
date: 2026-06-10
decision-makers: [Anglesite maintainers]
---

# On-device AI (`fm`) as an optional authoring-time accelerator

## Context and Problem Statement

Several authoring tasks — drafting image alt text, summarizing content, suggesting tags, triaging form submissions, short copy rewrites — are repetitive and high-volume. When Claude is in the session it can do them, but per-item Claude calls are expensive at scale, and some inputs (form submissions with PII) are content an owner may not want to send to any cloud.

Apple's Foundation Models CLI (`fm`) runs an on-device model on an Apple-Silicon Mac with Apple Intelligence enabled. It is free, private (nothing leaves the machine), works offline, and supports vision (`--image`), structured output (`--schema`), and content-tagging use cases. But it exists only on a capable Mac — Cowork users on Windows, developers on Linux, and CI runners do not have it — and it cannot run inside a deployed Cloudflare Worker.

## Decision

Use `fm` as an **optional, authoring-time accelerator**, never as a runtime dependency:

1. **Authoring-only.** `fm` runs during local authoring/build steps (e.g. `npm run ai-optimize`). It is never part of the deployed site or any Worker.
2. **Always optional, always falls back to Claude.** Every integration gates on a single availability check (`isFmAvailable()` in `template/scripts/fm.ts`). When `fm` is absent, the same task is done by Claude. The end result is identical on every machine; `fm` only changes who drafts first.
3. **Machine output is a draft, not a commitment.** `fm`-generated content is written to a reviewable, non-deployed store (e.g. the `image-alt.json` catalog) with an explicit `draft` → `reviewed` status. Re-runs never clobber human-reviewed entries.
4. **One module owns it.** All `fm` interaction lives in `template/scripts/fm.ts` behind an injectable command runner, so it is unit-testable without a Mac and future integrations reuse the same availability gate.

The first integration is image alt text in `optimize-images`. Inbox triage, bulk import captions, and copy rewrites/summaries are expected future consumers of the same module.

## Decision Drivers

* Bulk/batch offload — keep repetitive per-item work off paid Claude calls where a free local model suffices
* Privacy — keep PII-bearing content (form submissions) on the owner's machine
* Build-time / no-agent — let deterministic npm scripts produce drafts without an interactive session
* Cost / offline — free local inference that works without a network
* Inclusivity — most Cowork users are not on a capable Mac, so the feature must degrade gracefully (ADR-0011, owner controls everything)

## Consequences

* **Good:** cheaper bulk authoring, a privacy-preserving path for sensitive content, and a documented pattern for adding more on-device features.
* **Good:** zero impact on the deployed site — no new runtime dependency, nothing for the pre-deploy scans to police.
* **Neutral:** on-device output quality is below Claude's; it is always framed as a reviewable draft.
* **Bad / limits:** Mac-only generation means most users get the Claude fallback path; the system model is English-centric, so non-English sites get English drafts to translate.
