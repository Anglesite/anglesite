/**
 * Edit-pipeline dispatcher — the bridge between the `apply_edit` MCP tool and `patcher.mjs`.
 *
 * Flow:
 *   1. For `replace-image-src` with a raw `{filename, mimeType, dataURL}` value: pre-process
 *      via `processImageDrop` — write the bytes under `public/images/`, run optimize, build the
 *      `{src, srcset}` value the patcher's resolver expects. Throws map to `image-optimize-failed`.
 *   2. `resolve(projectRoot, edit)` (patcher.mjs) returns either `{file, range, replacement}`
 *      or `{refused: true, reason, detail?}`.
 *   3. On refusal: forward as an `edit-failed` MCP response.
 *   4. On success: read the source, splice in the replacement, atomically write back (write to
 *      a sibling temp file then `rename`), invoke an optional `onApplied` hook so #298's
 *      `edit-history.mjs` can commit to the hidden `anglesite/edits` branch and thread its SHA
 *      back as `commit`, then return `edit-applied` — with `result: {src, srcset}` for the
 *      image-drop path.
 *   5. On any filesystem error: return `edit-failed` with reason `write-failed`.
 *
 * The handler stays a pure async function so it's unit-testable independent of the MCP
 * `server.tool` plumbing; `server/index.mjs` is a one-line wire.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { resolve as resolveEdit } from "./patcher.mjs";
import { optimizeImage } from "./optimize-images.mjs";
import {
  createEditAppliedContent,
  createEditFailedContent,
  createEditPreviewContent,
} from "./apply-edit-schema.mjs";

function failed(id, reason, detail) {
  return { content: [createEditFailedContent(id, reason, detail)], isError: true };
}

function applied(id, file, range, commit, result) {
  return { content: [createEditAppliedContent(id, file, range, commit, result)] };
}

/** Splice `replacement` into `source` at the resolved byte range. */
function spliceSource(source, range, replacement) {
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}

/** Bounded before/after fragments around a [start,end) splice — keeps preview payloads small. */
function windowAround(source, start, end, replacement, pad = 200) {
  const from = Math.max(0, start - pad);
  const to = Math.min(source.length, end + pad);
  const before = source.slice(from, to);
  const after = source.slice(from, start) + replacement + source.slice(end, to);
  return { before, after };
}

function preview(id, file, range, op, before, after) {
  return { content: [createEditPreviewContent(id, file, range, op, before, after)] };
}

/** Atomic write via temp-sibling + rename, so a crashed mid-write can't truncate the source. */
function atomicWrite(absPath, content) {
  const tmp = join(
    dirname(absPath),
    "." + basename(absPath) + ".anglesite-edit-" + randomBytes(4).toString("hex"),
  );
  try {
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, absPath);
  } catch (err) {
    try { unlinkSync(tmp); } catch {} // best-effort cleanup
    throw err;
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mimeToExt(mime) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
  }[mime];
}

/**
 * Decode the dropped image's data URL, write it to public/images/<basename>.<ext>,
 * move any pre-existing same-stem files to public/images/originals/, then run
 * optimizeImage and build the srcset string from the variants.
 *
 * Basename: stem of the target <img>'s current src (e.g. /images/hero.jpg → "hero").
 * Falls back to the dropped filename's stem when the target src is external
 * (http(s)://…) or otherwise can't be parsed to a /images/ path.
 *
 * @returns {Promise<{ src: string, srcset: string }>}
 */
async function processImageDrop(projectRoot, edit) {
  const { selector, value } = edit;
  if (!value || typeof value !== "object" || !value.dataURL) {
    throw new Error("image drop missing dataURL");
  }

  const currentSrc = selector.textContent ?? "";
  let stem;
  const localMatch = currentSrc.match(/\/images\/([^/?#]+?)(?:\.[a-z0-9]+)?$/i);
  if (localMatch) {
    stem = localMatch[1];
  } else {
    stem = basename(value.filename, extname(value.filename));
  }

  const imagesDir = join(projectRoot, "public/images");
  const originalsDir = join(imagesDir, "originals");
  mkdirSync(imagesDir, { recursive: true });

  // Move any pre-existing <stem>.* and <stem>-<width>w.* files into originals/.
  if (existsSync(imagesDir)) {
    mkdirSync(originalsDir, { recursive: true });
    const re = new RegExp(`^${escapeRegex(stem)}(-\\d+w)?\\.[a-z0-9]+$`, "i");
    for (const entry of readdirSync(imagesDir)) {
      if (entry === "originals") continue;
      if (re.test(entry)) {
        try {
          renameSync(join(imagesDir, entry), join(originalsDir, entry));
        } catch {
          // best-effort; collisions in originals/ shadow the older copy
        }
      }
    }
  }

  // Decode the dataURL.
  const m = value.dataURL.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("dataURL is not base64-encoded");
  const ext = extname(value.filename) || mimeToExt(m[1]);
  if (!ext) {
    throw new Error(`can't infer extension from mimeType ${m[1]} / filename ${value.filename}`);
  }
  const bytes = Buffer.from(m[2], "base64");
  const droppedPath = join(imagesDir, `${stem}${ext}`);
  writeFileSync(droppedPath, bytes);

  // Optimize.
  // Don't pass preserveOriginalsDir: the sweep above already moved any
  // pre-existing <stem>.* and <stem>-*w.* files into originalsDir. If we
  // passed it here, optimizeImage would copyFileSync the freshly-written
  // (new) bytes over the preserved original, destroying it.
  const optimized = await optimizeImage(droppedPath, {
    outputDir: imagesDir,
    widths: [480, 768, 1024, 1920],
  });

  const src = `/images/${optimized.primary}`;
  const srcset = optimized.variants
    .map((v) => `/images/${v.file} ${v.width}w`)
    .join(", ");
  return { src, srcset };
}

/**
 * Apply an edit. Returns an MCP tool response (`{content, isError?}`) whose first content entry
 * is the JSON-encoded `edit-applied` / `edit-failed` body.
 *
 * @param {string} projectRoot
 * @param {object} edit  payload from the `apply_edit` tool (already zod-validated)
 * @param {{ onApplied?: (info: {file:string, range:{start:number,end:number}, projectRoot:string}) => Promise<string|undefined> | string | undefined }} [opts]
 */
export async function applyEdit(projectRoot, edit, opts = {}) {
  let effectiveEdit = edit;
  let imageResult;

  if (edit.op === "replace-image-src") {
    try {
      imageResult = await processImageDrop(projectRoot, edit);
    } catch (err) {
      return failed(edit.id, "image-optimize-failed", String(err.message || err));
    }
    effectiveEdit = {
      ...edit,
      value: { src: imageResult.src, srcset: imageResult.srcset },
    };
  }

  const resolution = resolveEdit(projectRoot, effectiveEdit);
  if (resolution.refused) {
    return failed(edit.id, resolution.reason, resolution.detail);
  }

  const { file, range, replacement } = resolution;
  const absPath = join(projectRoot, file);

  let source;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch (err) {
    return failed(edit.id, "write-failed", `read ${file}: ${err.message}`);
  }

  const next = spliceSource(source, range, replacement);

  if (edit.dry_run) {
    const { before, after } = windowAround(source, range.start, range.end, replacement);
    return preview(edit.id, file, range, edit.op, before, after);
  }

  try {
    atomicWrite(absPath, next);
  } catch (err) {
    return failed(edit.id, "write-failed", `${file}: ${err.message}`);
  }

  let commit;
  if (opts.onApplied) {
    try {
      commit = await opts.onApplied({ file, range, projectRoot });
    } catch (err) {
      // Patch landed on disk but history-keeping failed. Surface as a successful apply with no
      // commit SHA — the user-visible source change is real; #298 can decide its own policy.
      commit = undefined;
    }
  }

  return applied(edit.id, file, range, commit, imageResult ? { src: imageResult.src, srcset: imageResult.srcset } : undefined);
}
