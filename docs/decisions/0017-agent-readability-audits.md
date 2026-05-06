---
status: accepted
date: 2026-05-06
decision-makers: [Anglesite maintainers]
---

# Gate deploys on agent readability when the site invites agentic crawlers

## Context and Problem Statement

Anglesite sites are built and maintained by AI agents. They should also be *readable* by other agents — search agents, browsing agents, content-mapping agents, AI summarizers — when the owner wants those agents to find and understand the site. The recent integration of [a14y.dev](https://a14y.dev) (an open Apache-2.0 scoring service that runs 38 checks across discoverability, parsing, and comprehension) gave Anglesite a numeric score and per-check report it can act on.

The remaining policy question is: **when, if ever, should a low a14y score block a deploy?**

The closest precedent is ADR-0016 (Accessibility audits), which gates `/anglesite:deploy` behind an opt-in `A11Y_GATE` flag. The shape is similar (severity-aware exit codes, a warn-only escape hatch, an "always informational" mode in `/anglesite:check`), but the *policy axis* is different. Whether a deploy should block on agent-readability is not a generic "do you want a strict audit?" question — it's a function of the owner's intent toward agentic crawlers. An owner who has declared "keep agents out" doesn't benefit from being blocked because agents can't read the site cleanly; that gate is incoherent. An owner who has declared "agents are welcome" does benefit, because inviting agents and then shipping content they can't parse defeats the invitation.

A new field, `AGENTIC_CRAWLERS=allow|block`, was added to `.site-config` to capture that intent. This ADR records why the deploy gate is driven by that field rather than by a separate opt-in flag of the `A11Y_GATE` shape.

## Decision Drivers

* The default should match Anglesite's IndieWeb-aligned, open-by-default ethos — a fresh site is reachable by humans *and* agents unless the owner opts out.
* Owners who want agents out (private practices, members-only sites, content with licensing constraints) need a single, legible switch, not a matrix of gates to configure.
* Owners who want agents in shouldn't have to remember to also enable a separate audit gate — inviting agents and then ignoring whether they can parse the site is incoherent.
* Mid-remediation sites need a warn-only mode so a temporarily low score doesn't trap the owner.
* `/anglesite:check` should always run the audit informationally; the policy switch only controls the *deploy gate*, not whether the audit runs at all.
* The decision needs to be reversible — owners can flip `AGENTIC_CRAWLERS` later as their stance changes.

## Considered Options

* **(a) Gate always on** — every deploy enforces an a14y threshold regardless of policy.
* **(b) Gate always off** — a14y only ever runs informationally in `/anglesite:check`.
* **(c) Gate as a separate `A14Y_GATE` opt-in** — mirror the ADR-0016 shape exactly.
* **(d) Gate driven by `AGENTIC_CRAWLERS` intent** (chosen) — gate runs when policy is `allow`, is skipped when policy is `block`.

## Decision Outcome

Chosen option: **(d) Gate driven by `AGENTIC_CRAWLERS` intent**.

`.site-config` carries a new field, `AGENTIC_CRAWLERS=allow|block`, defaulting to `allow` when unset. `/anglesite:deploy` consults that field before running the a14y audit:

* `allow` — a14y runs as a deploy gate. The threshold (`A14Y_FAIL_UNDER`) and warn-only escape hatch (`A14Y_WARN_ONLY`) work the same way `A11Y_GATE` does in ADR-0016: severity-aware exit codes, opt-in warn-only mode for sites mid-remediation.
* `block` — the gate is skipped entirely. The owner has declared agents shouldn't read this site; gating the deploy on how readable it is to agents would be incoherent.

`/anglesite:check` always runs a14y informationally regardless of `AGENTIC_CRAWLERS`. The policy switch only controls the deploy gate.

### Consequences

* Good — the default (`allow`) matches Anglesite's open-by-default ethos and ADR-0006 (IndieWeb POSSE) without forcing every owner through a configuration step.
* Good — the policy is legible: one field captures the owner's stance toward agents, and every downstream behavior follows from it.
* Good — owners who block agents aren't trapped by a gate that has no coherent meaning for their site.
* Good — owners who allow agents get the gate automatically, so an invitation to agents implies a commitment to keeping the site readable for them.
* Good — `/anglesite:check` keeps reporting the score either way, so the owner can still see the state of agent-readability even when blocking — useful when reconsidering the policy later.
* Bad — couples two concerns (crawler policy and audit strictness) into one field. An owner who wants to block crawlers *and* still gate on the score has no path; we judge that combination incoherent enough not to support.
* Bad — the `block` setting is purely a self-declared intent. It does not, on its own, prevent agents from crawling — `robots.txt`, `noai`/`noimageai` meta tags, and similar mechanisms still belong with the owner. The field documents intent and switches Anglesite's gate; it doesn't enforce anything externally.

### Confirmation

`/anglesite:deploy` reads `AGENTIC_CRAWLERS` from `.site-config` in Step 2a⅞ and either runs `npm run ai-a14y` as a gate (when `allow`) or skips the step (when `block`). `/anglesite:check` runs `npm run ai-a14y` unconditionally and surfaces the score and per-check findings. Both behaviors are documented in `skills/deploy/SKILL.md` and `skills/check/SKILL.md`.

## Pros and Cons of the Options

### (a) Gate always on

* Good, because every deployed Anglesite site stays at a baseline level of agent-readability.
* Bad, because it overrides owner intent — sites that have explicitly declared "no agents" still pay the cost of being gated on agent-readability.
* Bad, because it creates a coherence problem: why does a site that blocks agents need to be readable by them?

### (b) Gate always off

* Good, because the simplest possible behavior — a14y is purely informational.
* Bad, because owners who invite agentic crawlers get no enforcement; an invitation without a check is a promise the site can quietly fail to keep.
* Bad, because it punts the gate decision to each owner with no default that reflects Anglesite's stance.

### (c) Gate as a separate `A14Y_GATE` opt-in

* Good, because it mirrors ADR-0016 exactly — owners only need to learn one shape ("set this flag to enable the gate").
* Good, because it cleanly separates "do I want to gate?" from "are agents welcome?".
* Bad, because the two concerns aren't actually independent — owners who allow agents almost always want the gate, and owners who block agents never want it. A separate flag forces a configuration choice that the policy field already implies.
* Bad, because two flags is more surface area for misconfiguration: an owner who blocks agents but forgets to disable `A14Y_GATE` ends up gated on a metric that has no policy meaning for them.

### (d) Gate driven by `AGENTIC_CRAWLERS` intent (chosen)

* Good, because policy and gate stay coherent: the gate only runs when keeping the site readable for agents matches the owner's stated stance.
* Good, because the default (`allow`) doubles as Anglesite's editorial recommendation — open by default, in line with ADR-0006.
* Good, because flipping the policy later automatically flips the gate behavior; no second flag to remember.
* Bad, because it bundles two concerns into one field. Owners who want a non-default combination (block + still gate, allow + never gate) need the warn-only escape hatch (`A14Y_WARN_ONLY`) or have to live with the chosen coupling.

## More Information

The a14y CLI is invoked as `npm run ai-a14y` in the user's project. The deploy gate respects `A14Y_FAIL_UNDER` (minimum acceptable score, 0–100) and `A14Y_WARN_ONLY=true` (audit runs but never blocks). See the Step 2a⅞ section of `skills/deploy/SKILL.md` for the gate flow and the "Agent readability (a14y)" section of `skills/check/SKILL.md` for the always-informational behavior.

This ADR pairs with ADR-0016 (Accessibility audits): both audits emit severity-aware exit codes and have a warn-only escape hatch, but the *policy axis* differs — a11y is gated by an explicit opt-in (`A11Y_GATE`), a14y is gated by the owner's stance toward agentic crawlers (`AGENTIC_CRAWLERS`).
