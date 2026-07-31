// Resources/Template/src/lib/localization.build.test.ts
//
// Build-level regression test for #956 (site language). Mirrors licensing.build.test.ts's
// rationale: siteLang()'s own unit test and each layout's TS types can't catch a layout that
// forgets to thread `lang` through to BaseLayout, or that uses `??` instead of `||` and lets an
// explicit-but-blank per-entry override ("use site default") leak through as <html lang="">.
// Only rendered output catches that class of bug.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXCLUDED = /(^|\/)(node_modules|dist|\.astro|\.wrangler)(\/|$)/;

function htmlLangOf(html: string): string | undefined {
  return html.match(/<html lang="([^"]*)"/)?.[1];
}

test("site language: site default and per-entry override both reach <html lang>", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "anglesite-lang-fixture-"));
  try {
    await cp(TEMPLATE_ROOT, fixtureDir, {
      recursive: true,
      filter: (src) => !EXCLUDED.test(src.slice(TEMPLATE_ROOT.length)),
    });

    await writeFile(join(fixtureDir, ".site-config"), "SITE_LANG=fr-CA\n", "utf8");

    // A blog post explicitly overriding the site default.
    await writeFile(
      join(fixtureDir, "src/content/blog/lang-override.md"),
      '---\ntitle: "English post on a French site"\npubDate: 2026-01-01\nlang: en\n---\n\nBody.\n',
      "utf8",
    );
    // A note with no lang key at all — must inherit the site default.
    await writeFile(
      join(fixtureDir, "src/content/notes/no-override.md"),
      "---\npublishDate: 2026-01-01\n---\n\nBody.\n",
      "utf8",
    );
    // A review with an explicit-but-blank lang (the native inspector's "use site default"
    // state) — must inherit exactly like the absent case above, not render lang="".
    await writeFile(
      join(fixtureDir, "src/content/reviews/blank-override.md"),
      '---\nitemReviewed: "A Thing"\nrating: 5\npublishDate: 2026-01-01\nlang: ""\n---\n\nBody.\n',
      "utf8",
    );

    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execFileSync("npx", ["astro", "build"], { cwd: fixtureDir, stdio: "inherit" });

    // Homepage: no per-page override anywhere near it -> site default.
    {
      const html = await readFile(join(fixtureDir, "dist/index.html"), "utf8");
      assert.equal(htmlLangOf(html), "fr-CA", "the homepage must render the site default SITE_LANG");
    }

    // Blog post with an explicit override -> that override, not the site default.
    {
      const html = await readFile(join(fixtureDir, "dist/blog/lang-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html),
        "en",
        "a blog post with an explicit lang override must render that language, not the site default",
      );
    }

    // Note with no lang key -> inherits the site default.
    {
      const html = await readFile(join(fixtureDir, "dist/notes/no-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html),
        "fr-CA",
        "a note with no lang frontmatter key must inherit the site default",
      );
    }

    // Review with an explicit empty-string lang -> still inherits the site default, proving the
    // `||`-not-`??` rule actually holds at the rendered-output level.
    {
      const html = await readFile(join(fixtureDir, "dist/reviews/blank-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html),
        "fr-CA",
        'an explicit empty-string lang override must inherit the site default, not render lang=""',
      );
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("site language: an absent SITE_LANG key renders the pre-existing default", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "anglesite-lang-default-fixture-"));
  try {
    await cp(TEMPLATE_ROOT, fixtureDir, {
      recursive: true,
      filter: (src) => !EXCLUDED.test(src.slice(TEMPLATE_ROOT.length)),
    });
    // No .site-config at all — matches every site scaffolded before this feature.
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execFileSync("npx", ["astro", "build"], { cwd: fixtureDir, stdio: "inherit" });
    const html = await readFile(join(fixtureDir, "dist/index.html"), "utf8");
    assert.equal(
      htmlLangOf(html),
      "en",
      "a site with no SITE_LANG key must render exactly the pre-existing hardcoded default",
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
