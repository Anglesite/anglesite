import { createHash } from "node:crypto";

/**
 * Content hash, not a git SHA: apply_edit commits land on the hidden
 * anglesite/edits branch without moving HEAD, so a repo-level SHA would stay
 * constant across edits — useless as a staleness token. Hashing the file
 * content means the version changes exactly when the model's source does.
 */
export function fileVersion(source) {
  return "sha256:" + createHash("sha256").update(source).digest("hex").slice(0, 12);
}
