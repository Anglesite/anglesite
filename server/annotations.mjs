import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** Generate an 8-character nanoid-style ID using node:crypto. */
function nanoid(size = 8) {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i] & 63];
  }
  return id;
}

const FILENAME = "annotations.json";

/**
 * @typedef {{ id: string, path: string, selector: string, sourceFile?: string, text: string, resolved: boolean, createdAt: string, resolvedAt?: string }} Annotation
 */

const SCHEMA_VERSION = 1;

/** Load annotations from disk. Returns [] if file is missing or invalid. */
export function loadAnnotations(projectRoot) {
  try {
    const raw = readFileSync(join(projectRoot, FILENAME), "utf-8");
    const parsed = JSON.parse(raw);
    // Support both versioned wrapper and legacy bare-array format
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.annotations)) return parsed.annotations;
    return [];
  } catch {
    return [];
  }
}

/** Write annotations to disk with pretty formatting. */
export function saveAnnotations(projectRoot, annotations) {
  writeFileSync(
    join(projectRoot, FILENAME),
    JSON.stringify({ version: SCHEMA_VERSION, annotations }, null, 2) + "\n",
  );
}

/** Create a new annotation, persist it, and return it. */
const MAX_UNRESOLVED = 50;

export function addAnnotation(projectRoot, { path, selector, text, sourceFile }) {
  const annotations = loadAnnotations(projectRoot);
  const unresolvedCount = annotations.filter((a) => !a.resolved).length;
  if (unresolvedCount >= MAX_UNRESOLVED) {
    throw new Error(
      `Annotation limit reached (${MAX_UNRESOLVED}). Resolve existing annotations before adding new ones.`,
    );
  }
  const annotation = {
    id: nanoid(),
    path,
    selector,
    ...(sourceFile !== undefined && { sourceFile }),
    text,
    resolved: false,
    createdAt: new Date().toISOString(),
  };
  annotations.push(annotation);
  saveAnnotations(projectRoot, annotations);
  return annotation;
}

/** List annotations, optionally filtered by page path. Excludes resolved by default. */
export function listAnnotations(projectRoot, path) {
  let annotations = loadAnnotations(projectRoot);
  annotations = annotations.filter((a) => !a.resolved);
  if (path !== undefined) {
    annotations = annotations.filter((a) => a.path === path);
  }
  return annotations;
}

/** Mark an annotation as resolved. Throws if id not found. */
export function resolveAnnotation(projectRoot, id) {
  const annotations = loadAnnotations(projectRoot);
  const annotation = annotations.find((a) => a.id === id);
  if (!annotation) {
    throw new Error(`Annotation not found: ${id}`);
  }
  annotation.resolved = true;
  annotation.resolvedAt = new Date().toISOString();
  saveAnnotations(projectRoot, annotations);
  return annotation;
}
