---
name: update
description: "Update site dependencies and template files to the latest version"
allowed-tools: Bash(zsh *), Bash(npm run *), Bash(npm install *), Bash(npm update *), Bash(npm outdated *), Bash(npm audit *), Bash(npx astro check), Bash(git add *), Bash(git commit *), Bash(git diff *), Write, Read, Glob
disable-model-invocation: true
---

Update the owner's site to the latest Anglesite template and dependencies. This is the ongoing maintenance command — safe, incremental, and explained in plain English.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why. If `false`, proceed without pre-announcing tool calls.

## Step 0 — Check current state

Read `.site-config` and confirm the site was scaffolded with Anglesite (`ANGLESITE_VERSION` should be present). If `ANGLESITE_VERSION` is missing, the site predates version tracking — tell the owner: "This is your first update — I'll set up version tracking so future updates are even smoother." Proceed normally; the script will treat the site as version `0.0.0`.

Run a baseline build to make sure the site is healthy before making changes:

```sh
npm run build
```

If the build fails, stop and fix it first. Don't update a broken site — tell the owner: "Let's fix this build issue before updating. You can run `/anglesite:check` to diagnose it."

## Step 1 — Compare template files

Run the update comparison script to see what's changed between the site and the latest template:

```sh
zsh ${CLAUDE_PLUGIN_ROOT}/scripts/update.sh .
```

The script outputs a categorized file list:

- `A path` — **New file** in the template that the site doesn't have yet. Safe to add.
- `= path` — **Identical** to the template. Already up to date. Nothing to do.
- `M path` — **Modified** — the site's version differs from the template. Could be a user customization, a template improvement, or both. Needs careful review.

Parse the output and group files by category.

## Step 2 — Apply safe updates

### New files (`A`)

Add all new template files to the site. These are files that didn't exist when the site was scaffolded — new scripts, docs, or config improvements.

For each new file, copy it from the template:
- Read the file from `${CLAUDE_PLUGIN_ROOT}/template/<path>`
- Write it to `./<path>` in the site directory

Tell the owner what was added: "I've added [N] new files that weren't in your original setup — [brief description of what they do]."

### Modified files (`M`)

This is the careful part. For each modified file, determine whether the difference is:

1. **User customization** — The owner (or their agent) changed this file on purpose. Examples: `src/styles/global.css` (brand colors), `src/layouts/BaseLayout.astro` (custom layout), `src/pages/*.astro` (custom pages), content files in `src/content/`.

2. **Outdated template code** — The file hasn't been touched by the owner but differs because the template was improved. Examples: `scripts/setup.ts`, `scripts/check-prereqs.ts`, `docs/workflows/*.md`.

3. **Both** — The template improved AND the owner customized the file.

To tell the difference:

- Read both versions (template and site)
- Look at the nature of the changes:
  - Brand colors, business name, content, custom pages → user customization
  - Bug fixes, new features, dependency updates, tooling improvements → template update
  - If it's a mix, identify which parts are which

**Rules for modified files:**

| File type | Action |
|---|---|
| `src/styles/global.css` | **Never overwrite.** Contains brand colors and custom styles. If the template added new utility classes or fixed a bug, add only those specific changes. |
| `src/layouts/*.astro` | **Merge carefully.** Preserve the owner's structure. Add new template features (accessibility improvements, meta tags) without replacing custom layout. |
| `src/pages/*.astro` | **Never overwrite.** These are the owner's pages. Only update if the page is completely unmodified from the template. |
| `src/content/**` | **Never overwrite.** This is the owner's content. |
| `scripts/*.ts` | **Safe to update** unless the owner has customized them (rare). Replace with template version. |
| `docs/**` | **Safe to update.** These are reference docs. Replace with template version. But preserve `docs/brand.md`, `docs/architecture.md`, and any other site-specific docs. |
| `package.json` | **Merge dependencies.** Don't replace the whole file — update `dependencies` and `devDependencies` versions to match the template. Preserve any packages the owner added. |
| `astro.config.ts` | **Merge carefully.** The owner may have added integrations. Update template portions, preserve additions. |
| `keystatic.config.ts` | **Merge carefully.** The owner may have added or modified content collections. Update template portions, preserve additions. |
| `.gitignore` | **Append only.** Add new entries from the template without removing existing ones. |
| Config files (`tsconfig.json`, etc.) | **Safe to update** unless customized. |

For each modified file you update, keep a note of what changed for the summary.

For files you skip (user customizations), note them too — the owner should know what was left alone and why.

## Step 3 — Update dependencies

Check for outdated packages:

```sh
npm outdated
```

Update dependencies to match the template's `package.json` versions:

```sh
npm install
```

If the template has newer dependency versions than the site, update them. For each package:

```sh
npm install package@version
```

Use the exact versions from the template's `package.json` (`${CLAUDE_PLUGIN_ROOT}/template/package.json`), not `@latest` — the template versions are tested together.

After updating, check for security issues:

```sh
npm audit
```

If `npm audit` finds vulnerabilities, try `npm audit fix`. Report anything that can't be auto-fixed.

## Step 4 — Verify the build

Run the full build to make sure nothing broke:

```sh
npx astro check
```

```sh
npm run build
```

If the build fails after updates:
1. Read the error message carefully
2. Identify which update caused the break
3. Revert that specific change
4. Tell the owner what happened and why that file was left at its current version
5. Re-run the build to confirm it passes

## Step 5 — Stamp the new version

Update `ANGLESITE_VERSION` in `.site-config` to the current plugin version. Read the version from `${CLAUDE_PLUGIN_ROOT}/package.json`.

Use the **Write tool** to update `.site-config` — read the current contents, replace or add the `ANGLESITE_VERSION` line, and write it back.

## Step 6 — Save a snapshot

```sh
git add -A
```

```sh
git commit -m "Update: Anglesite <old-version> → <new-version>"
```

Replace `<old-version>` and `<new-version>` with the actual versions from the comparison output.

## Step 7 — Report to the owner

Present a plain-English summary. No file paths, no package names, no version numbers in isolation. Translate everything into what it means for their site.

**Template:**

"I've updated your website from version [old] to [new]. Here's what changed:

**Added:**
- [Description of new files and what they do]

**Updated:**
- [Description of template improvements applied]
- [Description of dependency updates and why they matter]

**Left alone (your customizations):**
- [Files that were skipped because the owner customized them]

**Security:**
- [npm audit results — clean or what was fixed]

Your site builds successfully and everything looks good. Want me to deploy the update?"

If nothing meaningful changed (site was already up to date), keep it short: "Your site is already up to date — no changes needed."

## Keep docs in sync

If template docs were updated, the site's `docs/` directory may have new or updated workflow guides. Mention this to the owner: "I also updated your documentation with the latest guides."
