// Resources/Template/src/lib/licensing.build.test.ts
//
// Build-level regression test for #689 per-content-type licensing.
//
// The three projections a license flows into — schema.org `license` in the JSON-LD
// (schema.ts), the Microformats2 `u-license` anchor (LicenseLink.astro), and the page-level
// `<link rel="license">` (BaseLayout.astro) — are wired independently in five `.astro` files
// (BaseLayout.astro plus the four entry layouts: Hentry, Hevent, Hreview, and the blog layout).
// `licensing.test.ts` unit-tests the pure resolver (`resolveLicense`/`headLicense`) and
// `schema.test.ts` unit-tests `entrySchema()` directly against a hand-built `ctx.license` — both
// pass even when a layout forgets to thread `license` into one of its three call sites, because
// neither test touches the `.astro` wiring at all.
//
// That's exactly what happened: `Hreview.astro` computed `const license = licenseFor("reviews")`
// *after* the `entrySchema(...)` call and never passed it in, so `u-license` and
// `<link rel="license">` carried the license while the JSON-LD silently omitted it. Only rendered
// output can catch that class of bug, so this test copies the template to a tmpdir, runs a real
// `astro build`, and asserts that all three projections agree on every page — including the page
// that must assert nothing at all.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// Resources/Template/ — two `..` up from src/lib/
const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const EXCLUDED = /(^|\/)(node_modules|dist|\.astro|\.wrangler)(\/|$)/;

const LICENSING_FIXTURE = {
  default: { url: "https://creativecommons.org/licenses/by-nc/4.0/", name: "CC BY-NC 4.0" },
  collections: {
    reviews: { url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0" },
  },
};

const DEFAULT_LICENSE_URL = LICENSING_FIXTURE.default.url;
const REVIEWS_LICENSE_URL = LICENSING_FIXTURE.collections.reviews.url;

/** Pull the JSON-LD object out of a page, or undefined if the page emits none (e.g. likes). */
function jsonLdOf(html: string): Record<string, unknown> | undefined {
  const match = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  return match ? JSON.parse(match[1]) : undefined;
}

function hasULicense(html: string, url: string): boolean {
  const re = new RegExp(`class="u-license"[^>]*href="${escapeRegExp(url)}"`);
  const reAltOrder = new RegExp(`href="${escapeRegExp(url)}"[^>]*class="u-license"`);
  return re.test(html) || reAltOrder.test(html);
}

function hasRelLicenseLink(html: string, url: string): boolean {
  const re = new RegExp(`<link rel="license" href="${escapeRegExp(url)}"`);
  return re.test(html);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("licensing: JSON-LD, u-license, and <link rel=license> agree on every page", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "anglesite-licensing-fixture-"));
  try {
    await cp(TEMPLATE_ROOT, fixtureDir, {
      recursive: true,
      filter: (src) => !EXCLUDED.test(src.slice(TEMPLATE_ROOT.length)),
    });

    // Configure the site: an explicit per-collection override for reviews, a site-wide default
    // that notes should inherit, and (implicitly) nothing for likes despite that default —
    // exercising all three resolution rules from licensing.ts at once. Written only into the
    // tmpdir copy — the committed `src/data/licensing.json` (`{ "default": null, "collections":
    // {} }`) must never be touched.
    await writeFile(
      join(fixtureDir, "src/data/licensing.json"),
      JSON.stringify(LICENSING_FIXTURE, null, 2),
      "utf8",
    );

    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execFileSync("npx", ["astro", "build"], { cwd: fixtureDir, stdio: "inherit" });

    // --- reviews: explicit per-collection override -> CC BY 4.0 --------------------------
    // This is the case that would have caught the original Hreview.astro bug: license was
    // computed after entrySchema(...) and never threaded into it.
    {
      const html = await readFile(
        join(fixtureDir, "dist/reviews/hello-review/index.html"),
        "utf8",
      );
      const jsonLd = jsonLdOf(html);
      assert.ok(jsonLd, "reviews page must emit a JSON-LD <script> block");
      assert.equal(
        jsonLd?.license,
        REVIEWS_LICENSE_URL,
        `reviews JSON-LD "license" must be ${REVIEWS_LICENSE_URL}, got ${JSON.stringify(jsonLd?.license)} — ` +
          `this is the projection Hreview.astro's license-ordering bug broke`,
      );
      assert.ok(
        hasULicense(html, REVIEWS_LICENSE_URL),
        `reviews page must render a u-license anchor pointing at ${REVIEWS_LICENSE_URL}`,
      );
      assert.ok(
        hasRelLicenseLink(html, REVIEWS_LICENSE_URL),
        `reviews page <head> must carry <link rel="license" href="${REVIEWS_LICENSE_URL}">`,
      );
    }

    // --- notes: no override -> inherits the site default -----------------------------------
    // Guards the inheritance path and the other entry layouts' (Hentry.astro/BaseLayout.astro)
    // wiring, not just Hreview.astro's.
    {
      const html = await readFile(join(fixtureDir, "dist/notes/hello-note/index.html"), "utf8");
      const jsonLd = jsonLdOf(html);
      assert.ok(jsonLd, "notes page must emit a JSON-LD <script> block");
      assert.equal(
        jsonLd?.license,
        DEFAULT_LICENSE_URL,
        `notes JSON-LD "license" must inherit the site default ${DEFAULT_LICENSE_URL}, got ${JSON.stringify(jsonLd?.license)}`,
      );
      assert.ok(
        hasULicense(html, DEFAULT_LICENSE_URL),
        `notes page must render a u-license anchor pointing at the site default ${DEFAULT_LICENSE_URL}`,
      );
      assert.ok(
        hasRelLicenseLink(html, DEFAULT_LICENSE_URL),
        `notes page <head> must carry <link rel="license" href="${DEFAULT_LICENSE_URL}">`,
      );
    }

    // --- likes: non-asserting collection -> nothing, despite a site default being set ------
    // The legally-sensitive rule: a like is about someone else's post, so it must not assert a
    // license even though the site has a default configured. No JSON-LD at all is correct here
    // (likes have no meaningful schema.org rich-result type — see schema.ts), not just an absent
    // "license" key.
    {
      const html = await readFile(join(fixtureDir, "dist/likes/hello-like/index.html"), "utf8");
      assert.equal(
        jsonLdOf(html),
        undefined,
        "likes page must emit no JSON-LD <script> block at all (by design — see schema.ts)",
      );
      assert.ok(
        !html.includes("u-license"),
        "likes page must not render a u-license anchor despite a site default license being set",
      );
      assert.ok(
        !html.includes('rel="license"'),
        'likes page must not carry a <link rel="license"> despite a site default license being set',
      );
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
