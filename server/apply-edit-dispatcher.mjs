/**
 * Edit-pipeline dispatcher — the bridge between the `apply_edit` MCP tool and `patcher.mjs`.
 *
 * Flow:
 *   1. For `replace-image-src` with a raw `{filename, mimeType, dataURL}` value: pre-process
 *      via `processImageDrop` — write the bytes under `public/images/`, run optimize, build the
 *      `{src, srcset}` value the patcher's resolver expects. Throws map to `image-optimize-failed`.
 *   2. `resolve(projectRoot, edit)` (patcher.mjs) returns one of:
 *        - `{file, range, replacement}` — the single-file case every op except extract-component
 *          resolves to.
 *        - `{extract: true, newFile: {path, content}, original: {file, range, replacement}}` —
 *          extract-component's two-file case (component-extract-edit.mjs), handled by
 *          `applyExtractComponent` below instead of the generic single-splice path.
 *        - `{refused: true, reason, detail?}`.
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
  COMPONENT_OPS,
} from "./apply-edit-schema.mjs";
import { buildComponentModel } from "./component-model.mjs";
import { fileVersion } from "./file-version.mjs";

function failed(id, reason, detail) {
  return { content: [createEditFailedContent(id, reason, detail)], isError: true };
}

function applied(id, file, range, commit, result, model, newFile) {
  return { content: [createEditAppliedContent(id, file, range, commit, result, model, newFile)] };
}

/** Splice `replacement` into `source` at the resolved byte range. */
function spliceSource(source, range, replacement) {
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}

/** Bounded before/after fragments around the changed span — keeps preview payloads small for any op. */
function windowAround(source, next, pad = 200) {
  // common prefix
  let p = 0;
  const max = Math.min(source.length, next.length);
  while (p < max && source[p] === next[p]) p++;
  // common suffix (not overlapping the prefix)
  let s = 0;
  while (s < max - p && source[source.length - 1 - s] === next[next.length - 1 - s]) s++;
  const from = Math.max(0, p - pad);
  const beforeTo = source.length - Math.max(0, s - pad);
  const afterTo = next.length - Math.max(0, s - pad);
  return { before: source.slice(from, beforeTo), after: next.slice(from, afterTo) };
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
 * Handle extract-component's two-file write. `resolution` is component-extract-edit.mjs's
 * `{extract: true, newFile: {path, content}, original: {file, range, replacement}}`.
 *
 * Design decision — write order and partial-failure handling: the brand-new component file is
 * written FIRST, then the source file is patched second. This ordering makes the failure-of-the-
 * second-write case cheap and safe to roll back: the new file never existed before this op, so
 * "undo the first write" is just deleting it. The reverse order (patch source first, write new
 * file second) would risk leaving the source file referencing a component
 * (`<NewName ... />` + its import) that doesn't exist on disk if the second write then failed —
 * a broken build, and a harder state to describe as "rolled back." There's still no cross-file
 * transaction (this repo's `atomicWrite` only gives single-file atomicity via temp-sibling +
 * rename — same accepted limitation `create-content.mjs`'s writes have), but new-file-first
 * plus a best-effort unlink on second-write failure closes the realistic failure window: the
 * only way to land in a truly inconsistent state is the unlink itself failing (e.g. permissions
 * changed between the two writes), which is reported via `write-failed` either way.
 *
 * Once both writes succeed, both files are committed onto ONE `anglesite/edits` commit via
 * `opts.onApplied({files: [...]})` (see edit-history.mjs's multi-file `recordEdit` mode) — so
 * "one semantic op → one commit" holds here too, and a single `undo_edit` call reverts the whole
 * extraction (both the new file's removal and the source file's restoration) atomically.
 */
async function applyExtractComponent(projectRoot, edit, resolution, opts) {
  const { newFile, original } = resolution;
  const absNewFile = join(projectRoot, newFile.path);
  const absOriginal = join(projectRoot, original.file);

  // Re-validate staleness against a FRESH read, immediately before writing — same TOCTOU
  // discipline the generic single-file path applies below for every other COMPONENT_OPS member
  // (component-extract-edit.mjs's own `await parse(...)` opens the same async yield point a
  // concurrent edit could land in).
  let freshSource;
  try {
    freshSource = readFileSync(absOriginal, "utf-8");
  } catch (err) {
    return failed(edit.id, "write-failed", `read ${original.file}: ${err.message}`);
  }
  if (fileVersion(freshSource) !== edit.component.baseVersion) {
    return failed(edit.id, "stale", `${original.file} changed since the model was fetched`);
  }
  // The resolver already checked this once; re-check immediately before writing to narrow the
  // race window against a concurrent extract targeting the same new name.
  if (existsSync(absNewFile)) {
    return failed(edit.id, "already-exists", `${newFile.path} already exists`);
  }

  try {
    mkdirSync(dirname(absNewFile), { recursive: true });
    atomicWrite(absNewFile, newFile.content);
  } catch (err) {
    return failed(edit.id, "write-failed", `${newFile.path}: ${err.message}`);
  }

  const next = spliceSource(freshSource, original.range, original.replacement);
  try {
    atomicWrite(absOriginal, next);
  } catch (err) {
    // Roll back the new file — see the design note above: new-file-first ordering makes this a
    // plain unlink of something that never existed before this op, not a content restore.
    try { unlinkSync(absNewFile); } catch {} // best-effort
    return failed(edit.id, "write-failed", `${original.file}: ${err.message}`);
  }

  let commit;
  if (opts.onApplied) {
    try {
      commit = await opts.onApplied({
        files: [newFile.path, original.file],
        projectRoot,
        message: `anglesite: extract ${newFile.path} from ${original.file}`,
      });
    } catch {
      commit = undefined; // patch landed; history-keeping failure shouldn't fail an already-applied edit
    }
  }

  let model;
  try {
    model = await buildComponentModel(projectRoot, edit.component.path);
  } catch {
    model = undefined;
  }

  return applied(edit.id, original.file, original.range, commit, undefined, model, newFile.path);
}

/**
 * Apply an edit. Returns an MCP tool response (`{content, isError?}`) whose first content entry
 * is the JSON-encoded `edit-applied` / `edit-failed` body.
 *
 * @param {string} projectRoot
 * @param {object} edit  payload from the `apply_edit` tool (already zod-validated)
 * @param {{ onApplied?: (info: {file:string, range:{start:number,end:number}, projectRoot:string}
 *   | {files:string[], projectRoot:string, message?:string}) => Promise<string|undefined> | string | undefined }} [opts]
 */
export async function applyEdit(projectRoot, edit, opts = {}) {
  // The app's Foundation Models chat path (ApplyEditTool, #251) forwards NL instructions
  // as op="apply-instruction" expecting agent-side interpretation. The MCP server is
  // deterministic (no LLM), so return a structured refusal the app can route to its agent.
  if (edit.op === "apply-instruction") {
    return failed(edit.id, "needs-agent", "apply-instruction requires LLM interpretation; route to the agent");
  }

  // Component ops (Component Editor styles panel + structure ops) identify their target
  // via a structured `component` payload rather than `selector`; fail fast rather than
  // let the resolver's own destructure surface a less specific refusal.
  if (COMPONENT_OPS.has(edit.op) && !edit.component) {
    return failed(edit.id, "invalid-input", `op ${edit.op} requires a component payload`);
  }

  // dry_run is read-only. Image edits can't be previewed without writing optimized
  // bytes to disk, so refuse rather than violate the no-write invariant.
  if (edit.dry_run && edit.op === "replace-image-src") {
    return failed(edit.id, "not-implemented", "dry-run preview is not supported for image edits");
  }
  // Same reasoning for extract-component: its two-file write doesn't fit the single-window
  // {before, after} preview shape every other op's dry_run uses, so refuse rather than fake one.
  if (edit.dry_run && edit.op === "extract-component") {
    return failed(edit.id, "not-implemented", "dry-run preview is not supported for extract-component");
  }

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

  const resolution = await resolveEdit(projectRoot, effectiveEdit);
  if (resolution.refused) {
    return failed(edit.id, resolution.reason, resolution.detail);
  }

  if (resolution.extract) {
    return applyExtractComponent(projectRoot, edit, resolution, opts);
  }

  const { file, range, replacement } = resolution;
  const absPath = join(projectRoot, file);

  let source;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch (err) {
    return failed(edit.id, "write-failed", `read ${file}: ${err.message}`);
  }

  // Component ops resolve via an async parser (component-style-edit.mjs's /
  // component-structure-edit.mjs's `await parse(...)`), which opens a real yield point
  // between that resolver's own baseVersion check and this second, independent read. A
  // concurrent edit landing in that window would otherwise splice this call's now-stale
  // byte offsets into the other call's already-written content — re-validate the hash
  // against this fresh read, immediately before splicing, to close the gap.
  if (COMPONENT_OPS.has(edit.op) && fileVersion(source) !== edit.component.baseVersion) {
    return failed(edit.id, "stale", `${file} changed since the model was fetched`);
  }

  const next = spliceSource(source, range, replacement);

  if (edit.dry_run) {
    const { before, after } = windowAround(source, next);
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

  let model;
  if (COMPONENT_OPS.has(edit.op)) {
    try {
      model = await buildComponentModel(projectRoot, edit.component.path);
    } catch {
      model = undefined; // best-effort — a failed refetch shouldn't fail an already-applied edit
    }
  }

  return applied(
    edit.id,
    file,
    range,
    commit,
    imageResult ? { src: imageResult.src, srcset: imageResult.srcset } : undefined,
    model,
  );
}
