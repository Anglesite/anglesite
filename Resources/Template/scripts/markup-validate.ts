/**
 * HTML5 / W3C markup conformance validation for built pages.
 *
 * Uses html-validate configured with a hand-picked rule set that maps to genuine markup
 * validity problems (unclosed/misnested elements, invalid content models, duplicate ids,
 * empty <title>, malformed character references, …) — the same class of defect the W3C/WHATWG
 * Nu Html Checker (vnu) flags. Deliberately excludes html-validate's accessibility (`wcag/*`)
 * and style/best-practice rules (`attr-case`, `no-inline-style`, `prefer-button`, …): those
 * aren't markup *validity* issues, and accessibility is already `scripts/a11y-validate.ts`'s job
 * — running both here too would just double-report the same findings under a different name.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { HtmlValidate } from "html-validate";

const htmlValidate = new HtmlValidate({
  rules: {
    "doctype-html": "error",
    "doctype-style": "error",
    "close-order": "error",
    "close-attr": "error",
    "no-dup-attr": "error",
    "no-dup-id": "error",
    "element-permitted-content": "error",
    "element-permitted-occurrences": "error",
    "element-permitted-order": "error",
    "element-permitted-parent": "error",
    "element-required-ancestor": "error",
    "element-required-content": "error",
    "element-name": "error",
    "void-content": "error",
    "empty-title": "error",
    "form-dup-name": "error",
    "map-dup-name": "error",
    "map-id-name": "error",
    "unrecognized-char-ref": "error",
    "no-raw-characters": "error",
    "valid-id": ["error", { relaxed: false }],
    "script-element": "error",
    "script-type": "error",
    "no-utf8-bom": "error",
  },
});

/** Validate a single built page's markup. Returns human-readable problem strings — an empty
 * array means the page's HTML is conformant for our purposes. */
export function validateMarkupHtml(html: string, label: string): string[] {
  const report = htmlValidate.validateStringSync(html);
  return report.results.flatMap((result) =>
    result.messages.map((msg) => `${label}: ${msg.message} (${msg.ruleId})`),
  );
}

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out; // dir absent — not an error here
  }
  for (const name of names) {
    const full = join(dir, name);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue; // dangling symlink or removed mid-walk — skip rather than crash the whole scan
    }
    if (isDirectory) out.push(...walkHtml(full));
    else if (extname(full) === ".html") out.push(full);
  }
  return out;
}

/** Validate every built HTML page under `distDir`. Returns a flat list of human-readable
 * problem strings across all pages — an empty array means the whole build is conformant. */
export function validateDist(distDir: string): string[] {
  const problems: string[] = [];
  for (const file of walkHtml(distDir)) {
    const label = file.slice(distDir.length + 1);
    problems.push(...validateMarkupHtml(readFileSync(file, "utf8"), label));
  }
  return problems;
}
