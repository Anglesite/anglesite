---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Verify changes work before presenting them to the owner

> **This is a default decision.** It defines how the Webmaster agent should validate its own work. The verification steps can be adjusted if they don't fit your workflow — tell your Webmaster.

## Context and Problem Statement

The Webmaster agent generates code, modifies pages, updates styles, and deploys sites. Like any developer, it can produce broken output — a typo in an Astro template, a CSS change that breaks layout, a content schema mismatch. The owner is non-technical and trusts the agent to deliver working results. Showing them a broken preview or deploying a broken site wastes their time and erodes that trust.

This decision is informed by [agentic engineering patterns](https://simonwillison.net/guides/agentic-engineering-patterns/), specifically: verify code works before presenting it to others, and establish a working baseline before making changes.

## Decision Drivers

* The owner is non-technical — they cannot diagnose build failures or template errors
* Showing broken previews wastes the owner's time and attention
* Deploying untested changes to production is unacceptable
* Build and type-check tools (`npm run build`, `npx astro check`) exist and run in seconds
* The cost of running a build is negligible compared to the cost of a broken site

## Considered Options

* Agent verifies every change before presenting it
* Owner reviews all changes manually
* Deploy-time checks only (no pre-preview verification)

## Decision Outcome

Chosen option: "Agent verifies every change before presenting it", because the build and type-check tools are fast, the owner cannot meaningfully review technical output, and the cost of a quick build is far lower than the cost of presenting broken work.

### The verification cycle

1. **Start of session** — Run `npm run build` to confirm the site is in a working state. If the build is already broken, fix it before making new changes.
2. **After changes** — Run `npm run build` (and `npx astro check` for TypeScript changes) to verify the change compiles. Fix issues before showing the owner.
3. **Before deploy** — Build succeeds, then mandatory pre-deploy scans pass. Both are required.

### Consequences

* Good, because the owner only ever sees working previews
* Good, because build errors are caught and fixed before they compound
* Good, because the agent establishes a known-good baseline before making changes, so if something breaks, the cause is clear
* Good, because the deploy pipeline has two layers of protection: build verification and security scans
* Bad, because running a build after every change adds a few seconds of latency
* Bad, because the agent may need multiple build-fix cycles before presenting a change, which takes longer than showing a first draft

### Confirmation

The deploy skill requires a successful build before running pre-deploy scans. The `template/CLAUDE.md` instructions direct the agent to build at session start and after changes. The `/anglesite:check` skill runs a comprehensive verification across build, accessibility, privacy, security, SEO, and performance.

## Pros and Cons of the Options

### Agent verifies every change before presenting it

* Good, because broken output never reaches the owner
* Good, because build errors are localized — the agent knows exactly what change caused the failure
* Good, because matches professional engineering practice (don't submit unreviewed code)
* Neutral, because adds a few seconds per change cycle
* Bad, because some changes (CSS tweaks) don't strictly need a full build to verify

### Owner reviews all changes manually

* Good, because the owner has full visibility into every change
* Bad, because the owner is non-technical and cannot meaningfully review code changes
* Bad, because it shifts the verification burden to the person least equipped to handle it
* Bad, because broken previews damage the owner's confidence in the agent

### Deploy-time checks only

* Good, because fewer interruptions during the development cycle
* Bad, because the owner sees broken previews during development
* Bad, because errors compound — a broken build caused by an early change is harder to diagnose after many subsequent changes
* Bad, because "it worked on my machine" is not a defense when the agent IS the machine

## More Information

This practice is adapted from Simon Willison's [agentic engineering patterns](https://simonwillison.net/guides/agentic-engineering-patterns/):

- **"First run the tests"** — Establish a working baseline before making changes. A four-word prompt that encompasses substantial engineering discipline.
- **"Don't inflict unreviewed code on collaborators"** — The owner is the collaborator. Showing them broken output is the same as filing an unreviewed pull request.
- **"Red/green TDD"** — Confirm the current state works (green), make a change, confirm it still works (green). If it doesn't (red), fix before proceeding.
