import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface AnimationCatalogEntry {
  component: string;
  title: string;
  ownerDescription: string;
  category: "text" | "cards" | "buttons" | "backgrounds" | "navigation";
  keyProps: Record<string, string>;
  props: Record<string, unknown>;
  snippet: string;
}

export interface AnimationsCatalog {
  version: number;
  components: AnimationCatalogEntry[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function catalogPath(): string {
  return resolve(HERE, "../integrations/animations.json");
}

export function loadAnimationsCatalog(): AnimationsCatalog {
  return JSON.parse(readFileSync(catalogPath(), "utf8")) as AnimationsCatalog;
}
