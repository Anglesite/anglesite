/**
 * Build the forms catalog consumed by the forms-handler Worker.
 *
 * Reads every Markdoc form definition from `src/content/forms/*.mdoc`,
 * extracts the YAML frontmatter, and writes a flat `worker/forms.json`
 * keyed by slug. The Worker imports this file as a Text module so that
 * server-side validation always matches the live form definitions.
 *
 * Run before `wrangler deploy` for the forms-handler. Run automatically
 * by `npm run ai-forms-build`.
 *
 * Usage: `npx tsx scripts/build-forms-catalog.ts`
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FORMS_DIR = resolve(process.cwd(), "src/content/forms");
const OUT_PATH = resolve(process.cwd(), "worker/forms.json");

type FormField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
};

type Form = {
  title: string;
  slug: string;
  destinationEmail: string;
  redirectUrl?: string;
  successMessage?: string;
  rateLimitSeconds?: number;
  fields: FormField[];
};

function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];

  const root: Record<string, unknown> = {};
  const stack: { indent: number; node: Record<string, unknown> | unknown[] }[] = [
    { indent: -1, node: root },
  ];

  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;
    const line = rawLine.trim();

    if (line.startsWith("- ")) {
      const arr = parent as unknown[];
      const rest = line.slice(2);
      if (rest.includes(": ")) {
        const obj: Record<string, unknown> = {};
        arr.push(obj);
        const [k, ...vparts] = rest.split(": ");
        obj[k.trim()] = parseScalar(vparts.join(": "));
        stack.push({ indent, node: obj });
      } else if (rest.endsWith(":")) {
        const obj: Record<string, unknown> = {};
        arr.push(obj);
        stack.push({ indent, node: obj });
      } else {
        arr.push(parseScalar(rest));
      }
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const valuePart = line.slice(colon + 1).trim();
    const obj = parent as Record<string, unknown>;

    if (valuePart === "") {
      // Could be an object or array — peek next non-blank line.
      const next = nextNonBlank(lines, i + 1);
      if (next && next.trim().startsWith("- ")) {
        const arr: unknown[] = [];
        obj[key] = arr;
        stack.push({ indent, node: arr });
      } else {
        const child: Record<string, unknown> = {};
        obj[key] = child;
        stack.push({ indent, node: child });
      }
    } else {
      obj[key] = parseScalar(valuePart);
    }
  }

  return root;
}

function nextNonBlank(lines: string[], from: number): string | null {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() && !lines[i].trim().startsWith("#")) return lines[i];
  }
  return null;
}

function parseScalar(value: string): unknown {
  const v = value.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    return v.slice(1, -1);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((p) => parseScalar(p));
  }
  return v;
}

function readForms(): Form[] {
  if (!existsSync(FORMS_DIR)) return [];
  const out: Form[] = [];
  for (const file of readdirSync(FORMS_DIR)) {
    if (!file.endsWith(".mdoc")) continue;
    const raw = readFileSync(join(FORMS_DIR, file), "utf-8");
    const fm = parseFrontmatter(raw) as unknown as Form;
    if (!fm || !fm.slug || !fm.destinationEmail) {
      console.warn(`forms-catalog: skipping ${file} — missing slug or destinationEmail`);
      continue;
    }
    out.push({
      title: fm.title ?? fm.slug,
      slug: fm.slug,
      destinationEmail: fm.destinationEmail,
      redirectUrl: fm.redirectUrl,
      successMessage: fm.successMessage,
      rateLimitSeconds: fm.rateLimitSeconds ?? 60,
      fields: Array.isArray(fm.fields) ? fm.fields : [],
    });
  }
  return out;
}

function main(): void {
  const forms = readForms();
  const catalog: Record<string, Form> = {};
  for (const form of forms) catalog[form.slug] = form;

  const dir = resolve(process.cwd(), "worker");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `forms-catalog: wrote ${Object.keys(catalog).length} form(s) to ${OUT_PATH}`,
  );
}

main();
