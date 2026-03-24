# Bug Filing

When you encounter a bug — a build failure you can't explain, a dependency issue, a platform quirk, or anything that seems like it shouldn't happen — file a GitHub issue on the owner's repository. This creates a record for the next session and helps track recurring problems.

Read `GITHUB_REPO` from `.site-config`. If not set, skip bug filing (GitHub backup wasn't configured).

## Before filing

Search for duplicates:

```sh
gh issue list --repo GITHUB_REPO --search "SEARCH_KEYWORDS" --state open --limit 10
```

Use 2–4 keywords from the error message or problem description. If a matching issue exists, add a comment with the new occurrence instead of creating a duplicate:

```sh
gh issue comment ISSUE_NUMBER --repo GITHUB_REPO --body "Encountered again on YYYY-MM-DD: BRIEF_DESCRIPTION"
```

## Filing a new issue

If no duplicate exists:

```sh
gh issue create --repo GITHUB_REPO --title "TITLE" --body "BODY" --label LABEL
```

Choose the label that fits:
- `bug` — Something is broken (build failure, runtime error, broken page)
- `accessibility` — WCAG violation or usability issue found during check
- `security` — Privacy leak, exposed token, CSP violation
- `content` — Content error, broken links, SEO issues
- `build` — Build or deploy failure, dependency issue

Write the issue body in plain English. Include:
1. What happened (the error or problem)
2. What was being done when it happened (which skill, what action)
3. Any error message (truncated to the relevant portion)
4. What was tried to fix it (if anything)

Do not include: customer data, API tokens, or file paths that reveal the owner's system layout.

## When to file

File issues for:
- Build failures caused by dependency bugs (not user error)
- Astro, Keystatic, or Wrangler bugs
- Platform-specific issues (macOS/Linux/Windows differences)
- Accessibility violations that can't be fixed in the current session
- Security findings from `/anglesite:check` that need follow-up

Do NOT file issues for:
- Normal user requests ("make the header blue")
- Content the owner hasn't written yet
- Expected behavior (e.g., "build fails because there are no posts")
