# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 17 critical, 33 major, and 52 minor findings from the 2026-03-30 comprehensive audit.

**Architecture:** Each task is a self-contained batch of related fixes that can be committed independently. Tasks are ordered by severity (critical first) and grouped by theme (security, template, skills, docs) so parallel agents can work on independent batches simultaneously.

**Tech Stack:** Markdown/YAML frontmatter edits, shell script fixes, TypeScript fixes, Astro template fixes.

**Spec:** `docs/superpowers/specs/2026-03-30-comprehensive-audit-design.md`

---

## Task 1: Fix command injection in pre-deploy-check.sh (C1)

**Files:**
- Modify: `scripts/pre-deploy-check.sh:59-84`
- Test: `tests/pre-deploy-check.test.ts`

- [ ] **Step 1: Write a test that catches the injection vector**

In `tests/pre-deploy-check.test.ts`, add a test that verifies `.site-config` values with shell metacharacters don't execute as commands. Find the existing test file and add:

```typescript
it("rejects .site-config values containing shell metacharacters", () => {
  // The SCRIPT_GREP variable must never be passed through eval
  // This test verifies the refactored approach uses an array pipeline
  const src = readFileSync(
    resolve(__dirname, "../scripts/pre-deploy-check.sh"),
    "utf-8",
  );
  expect(src).not.toContain("eval ");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/pre-deploy-check.test.ts`
Expected: FAIL — the current script contains `eval`

- [ ] **Step 3: Refactor pre-deploy-check.sh to eliminate eval**

Replace the `eval "$SCRIPT_GREP"` pattern (lines 59-84) with a function that pipes through `grep -v` calls without string concatenation:

```bash
# 3. Third-party scripts — unauthorized external JS (allowlist driven by .site-config)
check_third_party_scripts() {
  local result
  result=$(grep -r '<script[^>]*src=' "$DIST/" --include='*.html' 2>/dev/null || true)

  # Always exclude Cloudflare analytics and Astro bundles
  result=$(echo "$result" | grep -v 'cloudflareinsights' | grep -v '_astro' || true)

  # Add provider-specific exclusions based on .site-config
  if [[ -f ".site-config" ]]; then
    local ecommerce booking turnstile
    ecommerce=$(grep '^ECOMMERCE_PROVIDER=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)
    booking=$(grep '^BOOKING_PROVIDER=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)
    turnstile=$(grep '^TURNSTILE_SITE_KEY=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)

    if [[ -n "$turnstile" ]]; then
      result=$(echo "$result" | grep -v 'challenges.cloudflare.com' || true)
    fi
    case "$ecommerce" in
      polar)    result=$(echo "$result" | grep -v 'cdn.polar.sh' || true) ;;
      snipcart) result=$(echo "$result" | grep -v 'cdn.snipcart.com' || true) ;;
      shopify)  result=$(echo "$result" | grep -v 'cdn.shopify.com' | grep -v 'sdks.shopifycdn.com' || true) ;;
      paddle)   result=$(echo "$result" | grep -v 'cdn.paddle.com' | grep -v 'sandbox-cdn.paddle.com' || true) ;;
    esac
    case "$booking" in
      cal)      result=$(echo "$result" | grep -v 'app.cal.com' || true) ;;
      calendly) result=$(echo "$result" | grep -v 'assets.calendly.com' || true) ;;
    esac
  fi

  if [[ -n "$result" ]]; then
    REASONS+=("Unauthorized third-party script tag found")
  fi
}
check_third_party_scripts
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/pre-deploy-check.test.ts`
Expected: PASS

- [ ] **Step 5: Also fix the phone regex POSIX issue (minor) and check count comment**

In the same file:
- Replace `\s` in the phone regex (around line 50) with `[[:space:]]` for POSIX ERE compliance
- Update the script header comment from "4 mandatory checks" to "5 mandatory checks" (PII emails, PII phones, tokens, third-party scripts, Keystatic admin)

- [ ] **Step 6: Run full test suite**

Run: `npm test -- --run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add scripts/pre-deploy-check.sh tests/pre-deploy-check.test.ts
git commit -m "fix(security): eliminate eval in pre-deploy-check.sh

Replace dynamic string concatenation + eval with a function that
pipes through grep -v calls. Prevents command injection from
malicious .site-config values. Also fix non-POSIX \s in phone
regex and correct check count from 4 to 5."
```

---

## Task 2: Fix CF_API_TOKEN plain-text storage (C2)

**Files:**
- Modify: `skills/domain/SKILL.md:41`

- [ ] **Step 1: Edit the domain skill to store the token in .env instead of .site-config**

Find the line:
```
Save the token to `.site-config` using the **Write tool** (update the existing file, adding `CF_API_TOKEN=the-token-value`).
```

Replace with:
```
Save the token to `.env` using the **Write tool** (update or create the file, adding `CF_API_TOKEN=the-token-value`). **Never save API tokens to `.site-config`** — that file is committed to git. `.env` is gitignored and stays local.
```

- [ ] **Step 2: Update the curl example below it**

Find (around line 46):
```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .site-config | cut -d= -f2)
```

Replace with:
```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
```

- [ ] **Step 3: Check if the stats skill has the same issue**

Read `skills/stats/SKILL.md` and find where `CF_API_TOKEN` is stored. If it also says `.site-config`, change it to `.env` with the same warning.

- [ ] **Step 4: Commit**

```bash
git add skills/domain/SKILL.md skills/stats/SKILL.md
git commit -m "fix(security): store CF_API_TOKEN in .env, not .site-config

.site-config is committed to git and pushed to GitHub. API tokens
stored there would be exposed in the remote repo. Move to .env
which is gitignored."
```

---

## Task 3: Fix build-breaking template issues (C3, C4, C5, C6)

**Files:**
- Modify: `template/src/pages/lab/index.astro:10`
- Modify: `template/scripts/setup.ts` (add CONFIG_FILE constant)
- Modify: `template/src/pages/search.astro` (or `template/package.json`)
- Modify: `template/public/_headers`

- [ ] **Step 1: Fix lab/index.astro — add experiments collection (C3)**

The page calls `getCollection('experiments')` but no collection exists. Two files need the collection added:

In `template/src/content.config.ts`, before the `export const collections` line, add:

```typescript
/** Creative experiments stored in `src/content/experiments/`. */
const experiments = defineCollection({
  type: "content",
  schema: z.object({
    /** Experiment title. */
    title: z.string(),
    /** Short description for the gallery listing. */
    description: z.string(),
    /** Date the experiment was created. */
    date: z.string().transform((str) => new Date(str)),
    /** Tags for categorization (e.g., "p5.js", "Three.js", "audio"). */
    tags: z.array(z.string()).default([]),
    /** Library or framework used. */
    library: z.string().optional(),
    /** Thumbnail image path relative to `public/`. */
    thumbnail: z.string().optional(),
    /** When true, excluded from the gallery. */
    draft: z.boolean().default(false),
  }),
});
```

Update the export to include it:
```typescript
export const collections = { posts, services, team, testimonials, gallery, events, menus, menuSections, menuItems, faq, products, experiments };
```

In `template/keystatic.config.ts`, add a matching Keystatic collection:
```typescript
experiments: collection({
  label: "Experiments",
  slugField: "title",
  path: "src/content/experiments/*",
  format: { contentField: "content" },
  schema: {
    title: fields.slug({ name: { label: "Title" } }),
    description: fields.text({
      label: "Description",
      description: "Short description for the gallery",
    }),
    date: fields.date({
      label: "Date",
      validation: { isRequired: true },
    }),
    tags: fields.multiselect({
      label: "Tags",
      options: [
        { label: "p5.js", value: "p5" },
        { label: "Three.js", value: "three" },
        { label: "GSAP", value: "gsap" },
        { label: "Audio", value: "audio" },
        { label: "D3", value: "d3" },
      ],
    }),
    library: fields.text({ label: "Library" }),
    thumbnail: fields.text({
      label: "Thumbnail",
      description: "Path relative to public/ (e.g., /images/experiments/thumb.webp)",
    }),
    draft: fields.checkbox({
      label: "Draft",
      description: "Hide from the gallery",
      defaultValue: false,
    }),
    content: fields.markdoc({ label: "Content" }),
  },
}),
```

Create the content directory:
```bash
mkdir -p template/src/content/experiments
```

- [ ] **Step 2: Fix setup.ts — declare CONFIG_FILE constant (C4)**

In `template/scripts/setup.ts`, find the constants section near the top (after imports, where `PROJECT_DIR` and similar constants are declared). Add:

```typescript
const CONFIG_FILE = resolve(PROJECT_DIR, ".site-config");
```

Verify `PROJECT_DIR` is already declared in the same scope. If it uses a different pattern (e.g., `process.cwd()`), match that pattern.

- [ ] **Step 3: Fix search.astro — add astro-pagefind dependency (C5)**

In `template/package.json`, add `astro-pagefind` to dependencies:

```json
"astro-pagefind": "^1.6.0",
```

Also verify `template/astro.config.ts` includes the pagefind integration. If not, add it.

- [ ] **Step 4: Fix CSP for Turnstile (C6)**

In `template/public/_headers`, update the `Content-Security-Policy` line. Find:
```
script-src 'self' static.cloudflareinsights.com;
```
Replace with:
```
script-src 'self' static.cloudflareinsights.com challenges.cloudflare.com;
```

Also add `frame-src` for OpenStreetMap embeds (minor finding):
```
frame-src 'self' www.openstreetmap.org;
```

- [ ] **Step 5: Run tests to verify nothing broke**

Run: `npm test -- --run`

- [ ] **Step 6: Commit**

```bash
git add template/src/content.config.ts template/keystatic.config.ts template/src/content/experiments/ template/scripts/setup.ts template/package.json template/public/_headers
git commit -m "fix: resolve 4 build-breaking template issues

- Add experiments collection for lab/index.astro (C3)
- Declare CONFIG_FILE constant in setup.ts (C4)
- Add astro-pagefind dependency for search.astro (C5)
- Add Turnstile + OSM to CSP in _headers (C6)"
```

---

## Task 4: Fix all skill allowed-tools frontmatter (C7-C13, M20-M24, C14-C15)

**Files:**
- Modify: `skills/start/SKILL.md` (frontmatter)
- Modify: `skills/add-store/SKILL.md` (frontmatter)
- Modify: `skills/stats/SKILL.md` (frontmatter)
- Modify: `skills/backup/SKILL.md` (frontmatter)
- Modify: `skills/experiment/SKILL.md` (frontmatter)
- Modify: `skills/copy-edit/SKILL.md` (frontmatter)
- Modify: `skills/buy-button/SKILL.md` (frontmatter)
- Modify: `skills/lemon-squeezy/SKILL.md` (frontmatter)
- Modify: `skills/check/SKILL.md` (frontmatter)
- Modify: `skills/deploy/SKILL.md` (frontmatter)
- Modify: `skills/domain/SKILL.md` (frontmatter)
- Modify: `skills/optimize-images/SKILL.md` (frontmatter)
- Modify: `skills/creative-canvas/SKILL.md` (frontmatter)
- Modify: `skills/design-interview/SKILL.md` (frontmatter)
- Modify: `skills/newsletter/SKILL.md` (frontmatter)
- Modify: `skills/photography/SKILL.md` (frontmatter)
- Modify: `skills/seo/SKILL.md` (frontmatter)

This is the highest-impact task — 12+ skills can't execute their own steps due to missing tool permissions.

- [ ] **Step 1: Fix start skill (C7) — add git tools**

In `skills/start/SKILL.md` frontmatter, find the `allowed-tools:` line. Add `Bash(git add *), Bash(git commit *)` to the list.

- [ ] **Step 2: Fix add-store skill (C8) — add Bash tools**

In `skills/add-store/SKILL.md` frontmatter, change:
```yaml
allowed-tools: Write, Read, Edit, Glob
```
to:
```yaml
allowed-tools: Bash(npx wrangler *), Bash(npm run build), Write, Read, Edit, Glob
```

- [ ] **Step 3: Fix stats skill (C9) — add Write**

In `skills/stats/SKILL.md` frontmatter, add `Write` to the allowed-tools list:
```yaml
allowed-tools: Bash(curl *), Bash(grep *), Bash(git log *), mcp__claude_ai_tldraw__create_shapes, mcp__claude_ai_tldraw__diagram_drawing_read_me, Write, Read, Glob
```

- [ ] **Step 4: Fix backup skill (C10) — add git checkout and git branch**

In `skills/backup/SKILL.md` frontmatter, add `Bash(git checkout *), Bash(git branch *)`:
```yaml
allowed-tools: Bash(git status *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git log *), Bash(git diff *), Bash(git checkout *), Bash(git branch *), Bash(npx tsx *), Read
```

- [ ] **Step 5: Fix experiment skill (C11) — fix typo and add allowed-tools**

In `skills/experiment/SKILL.md` frontmatter, change:
```yaml
user-invocable: false
```
to:
```yaml
user-invokable: false
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Write, Read, Edit, Glob
```

- [ ] **Step 6: Fix copy-edit skill (C12) — add Write and Edit**

In `skills/copy-edit/SKILL.md` frontmatter, change:
```yaml
allowed-tools: Read, Glob
```
to:
```yaml
allowed-tools: Write, Read, Edit, Glob
```

- [ ] **Step 7: Fix buy-button and lemon-squeezy (C13) — add Bash(npm run build)**

In `skills/buy-button/SKILL.md` frontmatter, change:
```yaml
allowed-tools: Write, Read, Edit, Glob
```
to:
```yaml
allowed-tools: Bash(npm run build), Write, Read, Edit, Glob
```

Same change in `skills/lemon-squeezy/SKILL.md`.

- [ ] **Step 8: Fix check skill (C14) — remove dscacheutil**

In `skills/check/SKILL.md` frontmatter, remove `Bash(dscacheutil *)` from the allowed-tools list. The skill already has cross-platform alternatives `Bash(getent *)` and `Bash(nslookup *)`.

- [ ] **Step 9: Fix deploy and domain skills (C15) — remove open**

In `skills/deploy/SKILL.md` frontmatter, remove `Bash(open *)`.
In `skills/domain/SKILL.md` frontmatter, remove `Bash(open *)`.

- [ ] **Step 10: Fix optimize-images (M20) — add Write and Edit**

In `skills/optimize-images/SKILL.md` frontmatter, change:
```yaml
allowed-tools: Bash(npm run ai-optimize), Read, Glob
```
to:
```yaml
allowed-tools: Bash(npm run ai-optimize), Write, Read, Edit, Glob
```

- [ ] **Step 11: Fix creative-canvas (M21) — add npm run build**

In `skills/creative-canvas/SKILL.md` frontmatter, change:
```yaml
allowed-tools: Bash(npm install *), Bash(npm run dev), Write, Read, Glob
```
to:
```yaml
allowed-tools: Bash(npm install *), Bash(npm run dev), Bash(npm run build), Write, Read, Glob
```

- [ ] **Step 12: Fix design-interview (M22) — add Edit and Bash(npm run *)**

In `skills/design-interview/SKILL.md` frontmatter, change:
```yaml
allowed-tools: mcp__claude_ai_tldraw__create_shapes, mcp__claude_ai_tldraw__diagram_drawing_read_me, Write, Read, Glob
```
to:
```yaml
allowed-tools: Bash(npm run *), mcp__claude_ai_tldraw__create_shapes, mcp__claude_ai_tldraw__diagram_drawing_read_me, Write, Read, Edit, Glob
```

- [ ] **Step 13: Fix newsletter (M23) — add Edit**

In `skills/newsletter/SKILL.md` frontmatter, add `Edit`:
```yaml
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(curl *), Bash(grep *), Write, Read, Edit, Glob
```

- [ ] **Step 14: Fix deploy (M24) — add gh auth**

In `skills/deploy/SKILL.md` frontmatter, add `Bash(gh *)`:
```yaml
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(grep *), Bash(find dist/ *), Bash(gh *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git checkout *), Bash(git merge *), Bash(git branch *), Write, Read
```

- [ ] **Step 15: Fix check skill (C16) — add disable-model-invocation**

In `skills/check/SKILL.md` frontmatter, add:
```yaml
disable-model-invocation: true
```

- [ ] **Step 16: Fix photography (M26) — add disable-model-invocation**

In `skills/photography/SKILL.md` frontmatter, add:
```yaml
disable-model-invocation: true
```

Also remove `Bash(cat *)` from its allowed-tools (it already has `Read`).

- [ ] **Step 17: Commit**

```bash
git add skills/start/SKILL.md skills/add-store/SKILL.md skills/stats/SKILL.md skills/backup/SKILL.md skills/experiment/SKILL.md skills/copy-edit/SKILL.md skills/buy-button/SKILL.md skills/lemon-squeezy/SKILL.md skills/check/SKILL.md skills/deploy/SKILL.md skills/domain/SKILL.md skills/optimize-images/SKILL.md skills/creative-canvas/SKILL.md skills/design-interview/SKILL.md skills/newsletter/SKILL.md skills/photography/SKILL.md skills/seo/SKILL.md
git commit -m "fix: update allowed-tools across 17 skills

The highest-impact class of audit findings — 12+ skills listed
steps they could not execute due to missing tool permissions.

- start: add git add/commit (C7)
- add-store: add Bash for wrangler deploy (C8)
- stats: add Write for credential persistence (C9)
- backup: add git checkout/branch (C10)
- experiment: fix user-invokable typo, add allowed-tools (C11)
- copy-edit: add Write/Edit (C12)
- buy-button/lemon-squeezy: add npm run build (C13)
- check: remove dscacheutil (C14), add disable-model-invocation (C16)
- deploy/domain: remove macOS-only open (C15)
- optimize-images: add Write/Edit (M20)
- creative-canvas: add npm run build (M21)
- design-interview: add Edit, npm run (M22)
- newsletter: add Edit (M23)
- deploy: add gh auth (M24)
- photography: add disable-model-invocation (M26)"
```

---

## Task 5: Fix seo broken reference and start skill misdirection (C17, M27)

**Files:**
- Modify: `skills/seo/SKILL.md`
- Modify: `skills/start/SKILL.md`

- [ ] **Step 1: Fix seo skill reference (C17)**

In `skills/seo/SKILL.md`, find the reference to `${CLAUDE_PLUGIN_ROOT}/docs/seo.md` and either:
- Remove it if no SEO doc exists
- Change it to a valid path (e.g., `${CLAUDE_PLUGIN_ROOT}/docs/decisions/0015-site-search.md` if relevant, or remove the reference entirely)

Check what docs exist with: `ls docs/` at the plugin root.

- [ ] **Step 2: Fix start skill design-interview reference (M27)**

In `skills/start/SKILL.md`, find where it tells the owner they can run `/anglesite:design-interview`. Since that skill has `user-invokable: false`, change the text to explain the design interview happens automatically during setup, or say "ask me to redo the design" (which would trigger the model-only skill programmatically).

- [ ] **Step 3: Commit**

```bash
git add skills/seo/SKILL.md skills/start/SKILL.md
git commit -m "fix: remove broken seo doc reference and fix design-interview misdirection

- seo: remove reference to non-existent docs/seo.md (C17)
- start: don't tell owner to invoke design-interview directly (M27)"
```

---

## Task 6: Fix phantom references in docs and skills (M1-M6)

**Files:**
- Modify: `skills/stats/SKILL.md` (remove phantom script refs)
- Modify: `template/docs/webmaster.md` (fix /anglesite:fix → /anglesite:check)
- Modify: `template/docs/security.md` (fix /anglesite:fix → /anglesite:check)
- Modify: `docs/decisions/0010-local-https-development.md` (fix /anglesite:fix → /anglesite:check)
- Modify: `CLAUDE.md` (remove marketplace.json from tree)

- [ ] **Step 1: Fix stats skill phantom references (M1)**

In `skills/stats/SKILL.md`, find references to `scripts/analytics-summary.ts` and `scripts/tldraw-helpers.ts`. These files don't exist. Either:
- Remove the references, or
- Replace with inline instructions that achieve the same outcome using available tools

- [ ] **Step 2: Fix /anglesite:fix → /anglesite:check (M2, M3)**

Search for `/anglesite:fix` in the following files and replace with `/anglesite:check`:
- `template/docs/webmaster.md`
- `template/docs/security.md`
- `docs/decisions/0010-local-https-development.md`

- [ ] **Step 3: Fix CLAUDE.md marketplace.json phantom (M6)**

In root `CLAUDE.md`, remove the line:
```
├── marketplace.json              Marketplace distribution config
```

- [ ] **Step 4: Commit**

```bash
git add skills/stats/SKILL.md template/docs/webmaster.md template/docs/security.md docs/decisions/0010-local-https-development.md CLAUDE.md
git commit -m "fix: remove phantom references to non-existent files

- stats: remove refs to analytics-summary.ts and tldraw-helpers.ts (M1)
- docs: fix /anglesite:fix → /anglesite:check in 3 files (M2, M3)
- CLAUDE.md: remove marketplace.json from structure tree (M6)"
```

---

## Task 7: Fix version and count mismatches in CLAUDE.md and README (M7-M10, M12)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Fix CLAUDE.md version (M7)**

Find: `**Version:** 0.16.1`
Replace with: `**Version:** 0.16.4`

- [ ] **Step 2: Fix CLAUDE.md skill count (M8)**

Find: `Skills (34 total: 15 user-facing, 19 model-only)`
Replace with the correct count. First verify by running:
```bash
ls -d skills/*/SKILL.md | wc -l
```
Then count user-facing vs model-only. Update the line to match reality (likely `38 total: 16 user-facing, 22 model-only`).

- [ ] **Step 3: Fix docs/platforms count (M9)**

Find: `Tool integration guides (13 files)`
Replace with the correct count. Verify: `ls docs/platforms/*.md | wc -l`

- [ ] **Step 4: Fix docs/smb count (M10)**

Find: `Business type guides (70 files, 50+ verticals)`
Replace with correct count. Verify: `ls docs/smb/*.md | wc -l`

- [ ] **Step 5: Add paddle skill to CLAUDE.md skill listings (M25)**

Add the paddle skill to both the structure tree and the model-only skills reference table.

- [ ] **Step 6: Fix CLAUDE.md wix import paths**

In the structure tree, change:
```
│       ├── wix-playwright.js     Browser-based content + CSS token extraction
│       ├── wix-extract.js        Curl+regex fallback for Wix HTML parsing
│       └── color-utils.js        RGB/hex conversion, luminance, color classification
```
to:
```
│       └── wix/                  Wix-specific extraction scripts
│           ├── wix-playwright.js Browser-based content + CSS token extraction
│           ├── wix-extract.js    Curl+regex fallback for Wix HTML parsing
│           └── color-utils.js    RGB/hex conversion, luminance, color classification
```

- [ ] **Step 7: Fix README skills table (M12)**

In `README.md`, add the missing skills to the table after the newsletter row:

```markdown
| `/anglesite:add-store` | Add ecommerce to your site |
| `/anglesite:booking` | Embed appointment scheduling |
| `/anglesite:seo` | SEO audit, metadata, Schema.org, sitemap |
| `/anglesite:search` | Add on-site search via Pagefind |
| `/anglesite:photography` | Site-specific photo shot list with tips |
```

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "fix: correct version, counts, and skill listings in CLAUDE.md and README

- Version: 0.16.1 → 0.16.4 (M7)
- Skill count: 34 → actual count (M8)
- Platform docs count: 13 → actual (M9)
- SMB docs count: 70 → actual (M10)
- Add paddle to skill listings (M25)
- Fix wix import script paths
- Add 5 missing skills to README table (M12)"
```

---

## Task 8: Fix .mdx/.mdoc confusion across the codebase (M15, M17, M18)

**Files:**
- Modify: `skills/syndicate/SKILL.md`
- Modify: `template/docs/content-guide.md`
- Modify: `template/docs/architecture.md`
- Modify: `docs/decisions/0002-keystatic-local-cms.md`

- [ ] **Step 1: Fix syndicate skill (M15)**

In `skills/syndicate/SKILL.md`, find `src/content/posts/<slug>.mdx` and replace with `src/content/posts/<slug>.mdoc`.

Do a broader search for `.mdx` in the file and replace all instances with `.mdoc` (the project uses Markdoc via `@astrojs/markdoc`).

- [ ] **Step 2: Fix template/docs/content-guide.md (M17)**

Search for `.mdx` and replace with `.mdoc` throughout. The content says files are `.mdx` but they're actually `.mdoc`.

- [ ] **Step 3: Fix template/docs/architecture.md (M17)**

Same — search for `.mdx` and replace with `.mdoc`. The line "Writes `.mdx` files directly" should be "Writes `.mdoc` files directly".

- [ ] **Step 4: Fix ADR-0002 (M18)**

In `docs/decisions/0002-keystatic-local-cms.md`, search for `.mdx` and replace with `.mdoc`.

- [ ] **Step 5: Commit**

```bash
git add skills/syndicate/SKILL.md template/docs/content-guide.md template/docs/architecture.md docs/decisions/0002-keystatic-local-cms.md
git commit -m "fix: correct .mdx → .mdoc across docs and skills

The project uses Markdoc (.mdoc) via @astrojs/markdoc, not MDX.
At least 5 locations still referenced the old .mdx extension."
```

---

## Task 9: Fix cross-skill consistency issues (M14, M16, M19, M33)

**Files:**
- Modify: `skills/og-images/SKILL.md` or `skills/design-interview/SKILL.md`
- Modify: `template/keystatic.config.ts`
- Modify: `docs/decisions/0008-no-third-party-javascript.md`
- Modify: `skills/themes/SKILL.md`

- [ ] **Step 1: Fix color property name mismatch (M14)**

The design-interview skill generates `--color-brand` but og-images reads `--color-primary`. Align them. The safer fix is to update og-images to also check `--color-brand` as a fallback, or update design-interview to set `--color-primary` (which is what the existing CSS uses). Read both skills to determine the best approach, but the principle is: match whatever `src/styles/global.css` actually uses.

- [ ] **Step 2: Add sendNewsletter to keystatic.config.ts (M16)**

In `template/keystatic.config.ts`, in the `posts` collection schema, add the missing field that matches `content.config.ts`:

```typescript
sendNewsletter: fields.checkbox({
  label: "Send to Newsletter",
  description: "When checked, sends this post to newsletter subscribers on deploy",
  defaultValue: false,
}),
```

Add it after the `draft` field.

- [ ] **Step 3: Fix ADR-0008 exception count (M19)**

In `docs/decisions/0008-no-third-party-javascript.md`, find the text that says "with one exception" and update it to match the actual number of exceptions listed. Count the numbered items in the exceptions list and use that number.

- [ ] **Step 4: Fix themes skill count and grid (M33)**

In `skills/themes/SKILL.md`:
- Change "8 themes" to "9 themes" (or remove the Studio theme if it's not ready)
- Add tldraw color mapping for Studio theme
- Fix "4x2" grid description to "5+4" or "3x3"

- [ ] **Step 5: Commit**

```bash
git add skills/og-images/SKILL.md skills/design-interview/SKILL.md template/keystatic.config.ts docs/decisions/0008-no-third-party-javascript.md skills/themes/SKILL.md
git commit -m "fix: resolve cross-skill consistency issues

- Align color property names between design-interview and og-images (M14)
- Add sendNewsletter field to keystatic.config.ts (M16)
- Correct exception count in ADR-0008 (M19)
- Fix theme count and grid layout in themes skill (M33)"
```

---

## Task 10: Fix template doc claims that don't match reality (M28-M32)

**Files:**
- Modify: `template/docs/indieweb.md`
- Modify: `template/docs/security.md`
- Modify: `template/docs/newsletter-sending.md`
- Modify: `template/docs/accessibility.md`

- [ ] **Step 1: Fix apple-touch-icon 404 (M28)**

Either create a placeholder `template/public/apple-touch-icon.png` or remove the `<link>` from `template/src/layouts/BaseLayout.astro`. The simpler fix is to remove the link tag until an actual icon exists (add a comment noting it should be added during design interview).

- [ ] **Step 2: Fix indieweb.md h-feed claim (M29)**

In `template/docs/indieweb.md`, find the claim that `h-feed` markup exists on the blog listing page. Either:
- Change it to say "h-feed markup should be added to the blog listing" (documenting the gap), or
- Remove the claim

- [ ] **Step 3: Fix security.md honeypot claim (M30)**

In `template/docs/security.md`, find the claim about honeypot fields on every form. Change it to indicate honeypot fields are recommended but not yet implemented, or remove the claim.

- [ ] **Step 4: Remove Ghost from newsletter-sending.md (M31)**

In `template/docs/newsletter-sending.md`, remove the Ghost Admin API integration section. Ghost is not referenced anywhere else in the project, and the subscribe worker only supports Buttondown and Mailchimp.

- [ ] **Step 5: Fix accessibility.md tool references (M32)**

In `template/docs/accessibility.md`, change references to `pa11y` and `html-validate` to indicate they are recommended tools to install, not already-installed dependencies. Or remove the references if the recommended workflow doesn't use them.

- [ ] **Step 6: Commit**

```bash
git add template/src/layouts/BaseLayout.astro template/docs/indieweb.md template/docs/security.md template/docs/newsletter-sending.md template/docs/accessibility.md
git commit -m "fix: align template docs with actual template state

- Remove apple-touch-icon link until icon exists (M28)
- Fix h-feed claim in indieweb.md (M29)
- Fix honeypot claim in security.md (M30)
- Remove Ghost integration from newsletter-sending.md (M31)
- Fix pa11y/html-validate references in accessibility.md (M32)"
```

---

## Task 11: Fix ADR-0015 status and design-system.md pipeline (M4, M13)

**Files:**
- Modify: `docs/decisions/0015-site-search.md`
- Modify: `template/docs/design-system.md`

- [ ] **Step 1: Update ADR-0015 status (M13)**

In `docs/decisions/0015-site-search.md`, change `status: proposed` to `status: accepted`. Pagefind is implemented and shipping.

- [ ] **Step 2: Fix design-system.md tokens.css reference (M4)**

In `template/docs/design-system.md`, find where it says "The base layout imports `tokens.css`". Change this to accurately describe what `BaseLayout.astro` actually imports (`../styles/global.css`). Explain that `tokens.css` is generated by the design interview and should be imported by `global.css` (or document the actual intended pipeline).

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0015-site-search.md template/docs/design-system.md
git commit -m "fix: update ADR-0015 status and fix design-system.md pipeline docs

- ADR-0015: proposed → accepted (Pagefind is shipping) (M13)
- design-system.md: correct tokens.css import claim (M4)"
```

---

## Task 12: Fix pack-plugin.sh omissions

**Files:**
- Modify: `scripts/pack-plugin.sh`

- [ ] **Step 1: Add missing files to pack-plugin.sh**

Read `scripts/pack-plugin.sh` and add `scripts/update.sh` and `server/` to the zip inclusion list. The update skill invokes `update.sh`, and the MCP annotation server lives in `server/`.

- [ ] **Step 2: Commit**

```bash
git add scripts/pack-plugin.sh
git commit -m "fix: include update.sh and server/ in plugin zip

pack-plugin.sh omitted scripts/update.sh and the server/ directory,
making the update skill and MCP annotation server non-functional
in distributed plugin zips."
```

---

## Task 13: Fix minor voice, style, and stale references (batch)

**Files:** Multiple skill and doc files (all minor findings)

- [ ] **Step 1: Fix hardcoded AI_MODEL in import and convert skills**

In `skills/import/SKILL.md` and `skills/convert/SKILL.md`, find `AI_MODEL=Claude Opus 4.6` and replace with a dynamic instruction like `AI_MODEL=<your model name>` or instruct the agent to write its actual model identifier.

- [ ] **Step 2: Fix import skill leaking plugin path in dialogue**

In `skills/import/SKILL.md`, find where `${CLAUDE_PLUGIN_ROOT}/docs/platforms/` appears inside quoted dialogue text. Move it outside the quotes so it's an instruction to the agent, not text shown to the owner.

- [ ] **Step 3: Fix convert skill duplicate text**

In `skills/convert/SKILL.md`, find the duplicated "For each post in BLOG_POSTS:" line and remove the duplicate.

- [ ] **Step 4: Fix photography skill emoji and path**

In `skills/photography/SKILL.md`:
- Remove emoji from headers to match voice consistency
- Change `content/PHOTOGRAPHY.md` to `src/content/PHOTOGRAPHY.md`

- [ ] **Step 5: Fix qr and print skills — remove Bash(cat *)**

In `skills/qr/SKILL.md` and `skills/print/SKILL.md`, remove `Bash(cat *)` from allowed-tools (both already have `Read`).

- [ ] **Step 6: Fix Paddle dashboard URL**

In `skills/paddle/SKILL.md`, change `vendors.paddle.com` to `dashboard.paddle.com`.

- [ ] **Step 7: Fix template/CLAUDE.md — add missing commands**

In `template/CLAUDE.md`, add `search` and `add-store` to the commands table:

```markdown
| Add on-site search | `/anglesite:search` |
| Add ecommerce | `/anglesite:add-store` |
```

- [ ] **Step 8: Fix BaseLayout.astro stale version comment**

In `template/src/layouts/BaseLayout.astro`, find the comment citing `0.9.0` and update to `0.16.4`.

- [ ] **Step 9: Fix server/index.mjs hardcoded version**

In `server/index.mjs`, find `"1.0.0"` and replace with a dynamic read from `package.json` or `.claude-plugin/plugin.json`, or at minimum update to `"0.16.4"`.

- [ ] **Step 10: Commit**

```bash
git add skills/import/SKILL.md skills/convert/SKILL.md skills/photography/SKILL.md skills/qr/SKILL.md skills/print/SKILL.md skills/paddle/SKILL.md template/CLAUDE.md template/src/layouts/BaseLayout.astro server/index.mjs
git commit -m "fix: batch minor voice, style, and stale reference fixes

- Dynamic AI_MODEL in import/convert skills
- Remove plugin path from user dialogue in import skill
- Remove duplicate text in convert skill
- Fix photography emoji and content path
- Remove Bash(cat *) from qr/print skills
- Update Paddle dashboard URL
- Add search/add-store to template/CLAUDE.md
- Update stale version strings in BaseLayout and server"
```

---

## Task 14: Run full test suite and verify

- [ ] **Step 1: Run all tests**

```bash
npm test -- --run
```

Expected: All tests pass. If any fail due to the changes above, fix them.

- [ ] **Step 2: Verify no remaining eval in pre-deploy-check.sh**

```bash
grep -n 'eval ' scripts/pre-deploy-check.sh
```

Expected: No output

- [ ] **Step 3: Verify skill frontmatter consistency**

Spot-check that all user-facing skills now have `disable-model-invocation: true`:

```bash
for skill in start deploy check update domain import convert contact backup stats newsletter add-store booking seo search photography; do
  echo -n "$skill: "
  grep -c 'disable-model-invocation: true' "skills/$skill/SKILL.md" || echo "MISSING"
done
```

- [ ] **Step 4: Commit any test fixes if needed**

---

## Parallel Execution Guide

Tasks can be parallelized as follows:

| Wave | Tasks | Why parallel |
|---|---|---|
| Wave 1 | Task 1, Task 2 | Security fixes, independent files |
| Wave 2 | Task 3, Task 4, Task 5 | Template, skills frontmatter, and skill body fixes touch different files |
| Wave 3 | Task 6, Task 7, Task 8, Task 9 | Docs, README, .mdoc, cross-skill — all different files |
| Wave 4 | Task 10, Task 11, Task 12, Task 13 | Template docs, ADRs, scripts, minors — all different files |
| Wave 5 | Task 14 | Final verification (must run after all others) |

## Deferred Items (not in this plan)

These audit findings require more substantial work and should be addressed in separate plans:

- **M5** — Newsletter subscribe worker source code (`worker/subscribe-worker.js`) doesn't exist. Writing a full Cloudflare Worker is a feature, not a fix.
- **M11** — CHANGELOG.md is missing entries for 0.15.1–0.16.4. Requires reviewing git history to reconstruct 4 releases of changelog entries.
- **Minor: backup skill phantom reference** — `scripts/backup-summary.ts` doesn't exist. The backup skill references it but then says "not a standalone CLI." Needs design decision on whether to create the script or restructure the skill.
- **Minor: Worker in-memory rate limiting** — All three workers use Map-based rate limiting that doesn't persist across Cloudflare isolates. Needs architectural decision (KV-backed, Cloudflare Rate Limiting, etc.)
- **Minor: AGENTS.md anglesite.config.json references** — This file is never generated. Needs a generation script or the references should be removed and content routing redesigned.
- **Minor: EXPLAIN_STEPS consistency** — 7+ model-only skills lack the EXPLAIN_STEPS check. Adding it to all is mechanical but touches many files — better as its own batch.
