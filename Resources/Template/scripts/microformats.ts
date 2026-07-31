import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { mf2 } from "microformats-parser";

/** Base URL used to resolve relative u-* URLs during parsing. */
const BASE_URL = "https://example.com";

/** The mf2 root types our entry layouts may emit. */
export const ENTRY_TYPES = ["h-entry", "h-review", "h-event"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Routed collection dirs whose built pages carry an entry microformat. */
export const ENTRY_DIRS = [
  "blog", "notes", "articles", "photos", "albums",
  "bookmarks", "replies", "likes", "announcements", "events", "reviews",
];

type Mf2Item = { type: string[]; properties: Record<string, unknown[]> };

const isEntryType = (t: string): t is EntryType =>
  (ENTRY_TYPES as readonly string[]).includes(t);

/** Parse HTML and return its root microformat items. */
export function findRoots(html: string, baseUrl = BASE_URL): Mf2Item[] {
  return mf2(html, { baseUrl }).items as Mf2Item[];
}

function has(item: Mf2Item, prop: string): boolean {
  const v = item.properties[prop];
  return Array.isArray(v) && v.length > 0;
}

/** The entry-microformat types found among a page's roots (deduped). */
function entryTypesOf(roots: Mf2Item[]): EntryType[] {
  return [...new Set(roots.flatMap((r) => r.type).filter(isEntryType))] as EntryType[];
}

/**
 * Validate a single built entry page's microformats. Returns a list of human-readable
 * problems; an empty list means the page is valid mf2 for our purposes.
 */
export function validateEntryHtml(html: string, label: string, baseUrl = BASE_URL): string[] {
  return validateRoots(findRoots(html, baseUrl), label);
}

/** Validate already-parsed roots — lets callers parse once and reuse the result. */
function validateRoots(allRoots: Mf2Item[], label: string): string[] {
  const problems: string[] = [];
  const roots = allRoots.filter((i) => i.type.some(isEntryType));

  if (roots.length === 0) {
    problems.push(`${label}: no h-entry/h-review/h-event root item found`);
    return problems;
  }
  if (roots.length > 1) {
    problems.push(`${label}: expected exactly one entry root, found ${roots.length}`);
  }

  const item = roots[0];
  const type = item.type.find(isEntryType) as EntryType;

  // Every entry needs a permalink.
  if (!has(item, "url")) problems.push(`${label}: ${type} missing u-url`);

  // Dates: events use dt-start; entries and reviews use dt-published.
  if (type === "h-event") {
    if (!has(item, "start")) problems.push(`${label}: h-event missing dt-start`);
  } else if (!has(item, "published")) {
    problems.push(`${label}: ${type} missing dt-published`);
  }

  if (type === "h-review" && !has(item, "rating")) {
    problems.push(`${label}: h-review missing p-rating`);
  }

  // p-name: required and explicit for h-review/h-event (both always carry a title).
  // h-entry is intentionally name-OPTIONAL — notes, photos, replies and likes are
  // legitimately nameless mf2 entries, so we neither require a name nor apply the
  // implied-name guard to them.
  if (type === "h-review" || type === "h-event") {
    if (!has(item, "name")) {
      problems.push(`${label}: ${type} missing p-name`);
    } else {
      // Guard the implied-name pitfall (see Hreview.astro): when an h-review/h-event has
      // no explicit p-name, the parser IMPLIES a name from the element's full text, which
      // includes the e-content body. A valid explicit title never contains the whole body,
      // so a name that (after whitespace normalization) contains the content body is the
      // signal of an implied name. Normalizing both sides keeps the substring check robust
      // to inline markup / whitespace differences between the two parsed values.
      const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
      const name = collapse(String(item.properties.name?.[0] ?? ""));
      const content = collapse(
        String((item.properties.content?.[0] as { value?: string } | undefined)?.value ?? ""),
      );
      if (name && content && name.includes(content)) {
        problems.push(`${label}: ${type} p-name looks implied (contains the content body) — add an explicit p-name`);
      }
    }
  }

  return problems;
}

/**
 * Validate the `resume` singleton page (`/resume/`, #964) if it exists in the build output.
 * Unlike `ENTRY_TYPES`, an `h-resume` root is optional — a site with no `src/data/resume.json`
 * renders a placeholder page with no `h-resume` markup at all, and that is not a failure (mirrors
 * the `businessProfile`/`personalProfile` identity h-card, which this script has never required).
 */
export function validateResumeHtml(html: string, label: string, baseUrl = BASE_URL): string[] {
  const roots = findRoots(html, baseUrl).filter((i) => i.type.includes("h-resume"));
  if (roots.length === 0) return [];

  const problems: string[] = [];
  if (roots.length > 1) {
    problems.push(`${label}: expected at most one h-resume root, found ${roots.length}`);
  }

  const item = roots[0];
  if (!has(item, "name")) problems.push(`${label}: h-resume missing p-name`);
  if (!has(item, "summary")) problems.push(`${label}: h-resume missing p-summary`);

  const checkNestedEvents = (propName: "experience" | "education") => {
    const raw = (item.properties[propName] ?? []) as unknown[];
    raw.forEach((value, i) => {
      const entry = value as Mf2Item;
      if (!entry?.type?.includes("h-event")) {
        problems.push(`${label}: h-resume ${propName}[${i}] is not a nested h-event`);
        return;
      }
      if (!has(entry, "name")) problems.push(`${label}: h-resume ${propName}[${i}] missing p-name`);
      if (!has(entry, "start")) problems.push(`${label}: h-resume ${propName}[${i}] missing dt-start`);
    });
  };
  checkNestedEvents("experience");
  checkNestedEvents("education");

  return problems;
}

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out; // dir absent (collection had no built pages) — not an error here
  }
  for (const name of names) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkHtml(full));
    else if (extname(full) === ".html") out.push(full);
  }
  return out;
}

/**
 * Validate every built entry page under `distDir` and assert vocabulary coverage:
 * each of h-entry / h-review / h-event appears in at least one valid page.
 */
export function validateDist(distDir: string): string[] {
  const problems: string[] = [];
  const seenAny = new Set<string>(); // type appeared on some page (valid or not)
  const seenValid = new Set<string>(); // type appeared on a page with no problems

  for (const sub of ENTRY_DIRS) {
    const base = join(distDir, sub);
    for (const file of walkHtml(base)) {
      const rel = file.slice(base.length + 1); // "welcome/index.html" or "index.html"
      if (!rel.includes("/")) continue; // skip the collection's own list page (index.html)
      const label = file.slice(distDir.length + 1);
      const roots = findRoots(readFileSync(file, "utf8")); // parse once; reuse below
      const types = entryTypesOf(roots);
      for (const t of types) seenAny.add(t);
      const pageProblems = validateRoots(roots, label);
      problems.push(...pageProblems);
      if (pageProblems.length === 0) for (const t of types) seenValid.add(t);
    }
  }

  // Only report a coverage gap when a type is entirely absent. If pages of that type
  // exist but all failed validation, the per-page problems above already explain it —
  // a redundant "no valid …" line reads as a separate root cause.
  for (const t of ENTRY_TYPES) {
    if (!seenAny.has(t)) problems.push(`coverage: no ${t} page found in ${distDir}`);
  }

  const resumePage = join(distDir, "resume", "index.html");
  if (existsSync(resumePage)) {
    problems.push(...validateResumeHtml(readFileSync(resumePage, "utf8"), "resume/index.html"));
  }

  return problems;
}
