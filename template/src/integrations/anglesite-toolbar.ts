/**
 * Astro integration that registers the Anglesite annotation toolbar app.
 *
 * In dev mode, adds a 📌 button to Astro's Dev Toolbar that lets users
 * pin feedback notes onto page elements. Notes are persisted to
 * annotations.json and exposed via MCP tools for Claude to act on.
 *
 * @see https://docs.astro.build/en/reference/dev-toolbar-app-reference/
 */

import type { AstroIntegration } from "astro";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface Annotation {
  id: string;
  path: string;
  selector: string;
  text: string;
  resolved: boolean;
  createdAt: string;
}

const FILENAME = "annotations.json";

function loadAnnotations(root: string): Annotation[] {
  try {
    return JSON.parse(readFileSync(resolve(root, FILENAME), "utf-8"));
  } catch {
    return [];
  }
}

function saveAnnotations(root: string, annotations: Annotation[]): void {
  writeFileSync(
    resolve(root, FILENAME),
    JSON.stringify(annotations, null, 2) + "\n",
  );
}

export default function anglesiteToolbar(): AstroIntegration {
  return {
    name: "anglesite-toolbar",
    hooks: {
      "astro:config:setup": ({ addDevToolbarApp }) => {
        addDevToolbarApp({
          id: "anglesite-annotations",
          name: "Anglesite Notes",
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>`,
          entrypoint: new URL("../toolbar/annotations.ts", import.meta.url)
            .pathname,
        });
      },

      "astro:server:setup": ({ toolbar }) => {
        const root = process.cwd();

        // Client requests the annotation list
        toolbar.on<{ path?: string }>(
          "anglesite:list-annotations",
          ({ path } = {}) => {
            const annotations = loadAnnotations(root).filter(
              (a) => !a.resolved,
            );
            const filtered = path
              ? annotations.filter((a) => a.path === path)
              : annotations;
            toolbar.send("anglesite:annotations-response", {
              annotations: filtered,
            });
          },
        );

        // Client adds a new annotation
        toolbar.on<{ path: string; selector: string; text: string }>(
          "anglesite:add-annotation",
          ({ path, selector, text }) => {
            const annotations = loadAnnotations(root);
            const annotation: Annotation = {
              id: crypto.randomUUID(),
              path,
              selector,
              text,
              resolved: false,
              createdAt: new Date().toISOString(),
            };
            annotations.push(annotation);
            saveAnnotations(root, annotations);
            toolbar.send("anglesite:annotation-response", { annotation });
          },
        );

        // Client resolves an annotation
        toolbar.on<{ id: string }>(
          "anglesite:resolve-annotation",
          ({ id }) => {
            const annotations = loadAnnotations(root);
            const annotation = annotations.find((a) => a.id === id);
            if (annotation) {
              annotation.resolved = true;
              saveAnnotations(root, annotations);
              toolbar.send("anglesite:annotation-response", { annotation });
            }
          },
        );
      },
    },
  };
}
