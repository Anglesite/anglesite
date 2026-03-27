---
name: No markdown tests
description: Don't write tests for markdown/documentation files — review for consistency manually instead
type: feedback
---

Don't write tests that verify markdown file structure (headings, sections, etc.). Documentation consistency can be checked by asking for a review at any time — it doesn't need automated tests.

**Why:** Brittle tests that check for specific headings in markdown don't catch real bugs. They add maintenance burden without value.

**How to apply:** Only write tests for code (TypeScript, config parsing, CSP builders, components). Skip test files for pure documentation changes.
