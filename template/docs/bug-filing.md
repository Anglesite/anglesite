# Bug Filing

When you encounter a bug — a build failure you can't explain, a dependency issue, a platform quirk, or anything that seems like it shouldn't happen — file a GitHub issue on the owner's repository. This creates a record for the next session and helps track recurring problems.

Read `GITHUB_REPO` from `.site-config`. If not set, skip bug filing (GitHub backup wasn't configured).

## Duplicate detection

Before creating a new issue, search thoroughly. Duplicates fragment context and make bugs harder to track.

### Search strategy

Run at least two searches with different keyword angles:

```sh
gh issue list --repo GITHUB_REPO --search "ERROR_MESSAGE_KEYWORDS" --state open --limit 10
gh issue list --repo GITHUB_REPO --search "COMPONENT_OR_AREA_KEYWORDS" --state open --limit 10
```

1. **Error text** — 2–4 keywords from the error message itself (e.g., `"astro build EPERM"`)
2. **Area or component** — The part of the system affected (e.g., `"keystatic image upload"`, `"cloudflare deploy"`)

If neither finds a match, also check closed issues — the same bug may have resurfaced:

```sh
gh issue list --repo GITHUB_REPO --search "KEYWORDS" --state closed --limit 5
```

If a closed issue matches, reopen it rather than filing a new one.

### When a duplicate exists

Add a comment that enriches the issue with whatever you learned this time. Include any of these that are new:

```sh
gh issue comment ISSUE_NUMBER --repo GITHUB_REPO --body "COMMENT_BODY"
```

The comment should include whichever of these apply:

- **Date and frequency** — "Encountered again on YYYY-MM-DD" (helps establish a pattern)
- **New reproduction context** — Different skill, page, or action that triggered the same bug
- **Narrower root cause** — If you learned more about why it happens (e.g., "only occurs when the post has no hero image")
- **Workaround found** — What you did to get past it, so the next session doesn't start from scratch
- **Environment details** — OS, Node version, or package version if different from the original report

Don't repeat information already in the issue. Read the existing body and comments first.

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

## Bugs in the Anglesite plugin itself

Some bugs are not in the owner's site — they're in the Anglesite plugin: a skill that gives wrong instructions, a scaffold file that's missing, a template that doesn't build, or a hook that misfires. These should be reported to the plugin repository (`Anglesite/anglesite`), not the owner's site repo.

The `gh` CLI is typically scoped to the owner's site repo and may not have access to create issues on the plugin repo. Instead, open the owner's browser with a pre-filled GitHub issue:

```ts
import { openCommand } from "./scripts/platform.js";

const title = encodeURIComponent("Bug title here");
const body = encodeURIComponent(`## What happened\n\nDescription of the problem.\n\n## Steps to reproduce\n\n1. Run \`/anglesite:skill-name\`\n2. ...\n\n## Expected behavior\n\nWhat should have happened.\n\n## Environment\n\n- Anglesite version: (read from package.json)\n- Node: ${process.version}\n- OS: ${process.platform}`);
const url = `https://github.com/Anglesite/anglesite/issues/new?title=${title}&body=${body}&labels=bug`;
```

Then run the open command:

```sh
# macOS:  open "URL"
# Linux:  xdg-open "URL"
# Windows: start "URL"
```

Use `openCommand(url)` from `scripts/platform.ts` to get the right command for the current OS. If the command fails (e.g., headless environment), print the URL so the owner can open it manually.

### When to file against the plugin

File against `Anglesite/anglesite` when:

- A scaffolded template file is wrong or missing
- A skill gives incorrect instructions or fails unexpectedly
- The pre-deploy hook blocks a legitimate deploy
- A platform detection issue (macOS/Linux/Windows) in template scripts

File against the owner's repo when:

- The bug is site-specific (content, config, customization)
- A dependency used by the site (not the plugin) is broken
- The build fails due to the owner's code changes

### Always ask first

Before opening the browser, tell the owner what you found and ask if they'd like to report it. Explain that the issue is in the tool itself, not their site. Example:

> "I found a bug in Anglesite's deploy skill — it's not checking for X correctly. This affects all Anglesite sites, not just yours. Want me to open a bug report? It'll open GitHub in your browser with the details pre-filled."
