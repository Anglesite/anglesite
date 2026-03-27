import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const FILENAME = "annotations.json";

/**
 * @typedef {{ id: string, path: string, selector: string, text: string, resolved: boolean, createdAt: string }} Annotation
 */

/** Load annotations from disk. Returns [] if file is missing or invalid. */
export function loadAnnotations(projectRoot) {
  try {
    const raw = readFileSync(join(projectRoot, FILENAME), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Write annotations to disk with pretty formatting. */
export function saveAnnotations(projectRoot, annotations) {
  writeFileSync(
    join(projectRoot, FILENAME),
    JSON.stringify(annotations, null, 2) + "\n",
  );
}

/** Create a new annotation, persist it, and return it. */
export function addAnnotation(projectRoot, { path, selector, text }) {
  const annotations = loadAnnotations(projectRoot);
  const annotation = {
    id: randomUUID(),
    path,
    selector,
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
  saveAnnotations(projectRoot, annotations);
  return annotation;
}
