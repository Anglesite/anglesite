/**
 * Edit-pipeline dispatcher — the bridge between the `apply_edit` MCP tool and `patcher.mjs`.
 *
 * Flow:
 *   1. `resolve(projectRoot, edit)` (patcher.mjs) returns either `{file, range, replacement}`
 *      or `{refused: true, reason, detail?}`.
 *   2. On refusal: forward as an `edit-failed` MCP response.
 *   3. On success: read the source, splice in the replacement, atomically write back (write to
 *      a sibling temp file then `rename`), invoke an optional `onApplied` hook so #298's
 *      `edit-history.mjs` can commit to the hidden `anglesite/edits` branch and thread its SHA
 *      back as `commit`, then return `edit-applied`.
 *   4. On any filesystem error: return `edit-failed` with reason `write-failed`.
 *
 * The handler stays a pure async function so it's unit-testable independent of the MCP
 * `server.tool` plumbing; `server/index.mjs` is a one-line wire.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { resolve as resolveEdit } from "./patcher.mjs";
import {
  createEditAppliedContent,
  createEditFailedContent,
} from "./apply-edit-schema.mjs";

function failed(id, reason, detail) {
  return { content: [createEditFailedContent(id, reason, detail)], isError: true };
}

function applied(id, file, range, commit) {
  return { content: [createEditAppliedContent(id, file, range, commit)] };
}

/** Splice `replacement` into `source` at the resolved byte range. */
function spliceSource(source, range, replacement) {
  return source.slice(0, range.start) + replacement + source.slice(range.end);
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

/**
 * Apply an edit. Returns an MCP tool response (`{content, isError?}`) whose first content entry
 * is the JSON-encoded `edit-applied` / `edit-failed` body.
 *
 * @param {string} projectRoot
 * @param {object} edit  payload from the `apply_edit` tool (already zod-validated)
 * @param {{ onApplied?: (info: {file:string, range:{start:number,end:number}, projectRoot:string}) => Promise<string|undefined> | string | undefined }} [opts]
 */
export async function applyEdit(projectRoot, edit, opts = {}) {
  const resolution = resolveEdit(projectRoot, edit);
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

  return applied(edit.id, file, range, commit);
}
