/**
 * Turns a bare URL alone on its own line into a first-party embed card, resolved against the
 * snapshots committed under src/embeds/. Reads the filesystem, never the network — a build can
 * never fail or stall because a platform is down.
 *
 * A URL with no snapshot is left completely alone and renders as an ordinary link, so content
 * stays valid CommonMark and degrades gracefully everywhere else (GitHub, Keystatic, any other
 * renderer). Run `npm run embed -- <url>` to capture one.
 */
import { renderEmbedCard } from "../src/lib/embed-card";
import type { EmbedSnapshot } from "./embeds/types";
import { snapshotKey } from "./embeds/adapters";
import { loadAllSnapshots } from "./embeds/store";
import { readConfig } from "./config";

/** Minimal mdast shape. Declared locally — @types/mdast is not a dependency of this template. */
export interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

/** Receives an already-canonicalized key — `transformEmbeds` normalizes before calling. */
export type SnapshotResolver = (url: string) => EmbedSnapshot | null;

/** The href a bare autolink produces: its single text child is the URL itself. */
function bareLinkURL(node: MdastNode): string | null {
  if (node.type !== "paragraph" || node.children?.length !== 1) return null;
  const link = node.children[0];
  if (link.type !== "link" || typeof link.url !== "string") return null;
  if (link.children?.length !== 1) return null;
  const text = link.children[0];
  if (text.type !== "text" || text.value !== link.url) return null;
  return link.url;
}

export function transformEmbeds(
  tree: MdastNode,
  resolve: SnapshotResolver,
  inlineVideo = false,
): MdastNode {
  const children = tree.children ?? [];
  for (let i = 0; i < children.length; i += 1) {
    const url = bareLinkURL(children[i]);
    if (!url) continue;
    // Canonicalize before looking up: the URL as written in content carries whatever the
    // platform's "Copy link" button produced. See `snapshotKey`.
    const snapshot = resolve(snapshotKey(url));
    if (!snapshot) continue;
    children[i] = { type: "html", value: renderEmbedCard(snapshot, { inlineVideo }) };
  }
  return tree;
}

export default function remarkEmbeds(options: { cwd?: string } = {}) {
  const cwd = options.cwd ?? process.cwd();
  // Loaded once per build, not once per file.
  const snapshots = loadAllSnapshots(cwd);
  const inlineVideo = (readConfig("EMBED_VIDEO_INLINE") ?? "").trim().toLowerCase() === "true";
  const resolve: SnapshotResolver = (url) => snapshots.get(url) ?? null;
  return (tree: MdastNode): void => {
    transformEmbeds(tree, resolve, inlineVideo);
  };
}
