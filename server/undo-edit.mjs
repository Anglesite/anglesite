/**
 * Hidden-branch edit undo (#33). Reverts the most-recent commit on
 * refs/heads/anglesite/edits by writing the parent commit's blobs back to disk
 * and advancing the branch with a new linearized commit (`undo: <files>`).
 *
 * Same defensive-execFile pattern as edit-history.mjs — no shell, never
 * mutates the user's HEAD or current branch, every git call passes argv as
 * an array.
 *
 * Refusal reasons match the schema enum in server/messages.mjs:
 *   - no-edits-to-undo:     hidden branch doesn't exist (or projectRoot isn't a repo)
 *   - head-only-mode:       caller passed a commit arg that isn't HEAD
 *   - initial-commit:       HEAD has no parent (only one commit on the branch)
 *   - working-tree-modified: at least one touched file differs on disk vs. HEAD's blob
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const EDITS_REF = "refs/heads/anglesite/edits";

function runGit(projectRoot, args, env = {}) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  }).trim();
}

function tryRunGit(projectRoot, args, env = {}) {
  try { return runGit(projectRoot, args, env); } catch { return undefined; }
}

function runGitBuffer(projectRoot, args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * @param {string} projectRoot
 * @param {{ commit?: string, force?: boolean }} opts
 */
export async function undoEdit(projectRoot, { commit, force = false } = {}) {
  // 1. Confirm hidden branch exists.
  const head = tryRunGit(projectRoot, ["show-ref", "--verify", "--hash", EDITS_REF]);
  if (!head) return { status: "refused", reason: "no-edits-to-undo" };

  // 2. Head-only mode — caller-supplied commit must match HEAD.
  if (commit && commit !== head) {
    return { status: "refused", reason: "head-only-mode" };
  }

  // 3. Get parent — guard against initial-commit case.
  const parent = tryRunGit(projectRoot, ["rev-parse", `${head}^`]);
  if (!parent) return { status: "refused", reason: "initial-commit" };

  // 4. List files that differ between HEAD and parent.
  const diff = tryRunGit(projectRoot, ["diff", "--name-only", parent, head]);
  if (diff === undefined) return { status: "refused", reason: "no-edits-to-undo" };
  const files = diff.split("\n").filter(Boolean);

  // 5. Working-tree drift check (unless force).
  if (!force) {
    const drifted = [];
    for (const file of files) {
      const onDisk = tryRunGit(projectRoot, ["hash-object", "--", file]);
      const headBlob = tryRunGit(projectRoot, ["rev-parse", `${head}:${file}`]);
      // hash-object on a missing file fails (returns undefined); treat as drift.
      if (!onDisk || onDisk !== headBlob) drifted.push(file);
    }
    if (drifted.length) {
      return { status: "refused", reason: "working-tree-modified", files: drifted };
    }
  }

  // 6. Restore each touched file: files that existed at `parent` get their old blob content
  // written back; files that were pure additions at `head` (didn't exist at `parent` — e.g. the
  // new component file extract-component creates) get deleted instead, since "undo" for a newly
  // created file means removing it.
  for (const file of files) {
    const existedAtParent = tryRunGit(projectRoot, ["cat-file", "-e", `${parent}:${file}`]) !== undefined;
    if (existedAtParent) {
      const content = runGitBuffer(projectRoot, ["show", `${parent}:${file}`]);
      writeFileSync(join(projectRoot, file), content);
    } else {
      try {
        unlinkSync(join(projectRoot, file));
      } catch {
        // already gone; nothing to undo
      }
    }
  }

  // 7. Advance the hidden branch with a new commit whose tree matches parent's tree.
  const parentTree = runGit(projectRoot, ["rev-parse", `${parent}^{tree}`]);
  const message = `undo: ${files.join(", ")}`;
  const env = {
    GIT_AUTHOR_NAME: "Anglesite",
    GIT_AUTHOR_EMAIL: "edits@anglesite.local",
    GIT_COMMITTER_NAME: "Anglesite",
    GIT_COMMITTER_EMAIL: "edits@anglesite.local",
  };
  const newCommit = runGit(
    projectRoot,
    ["commit-tree", parentTree, "-p", head, "-m", message],
    env,
  );
  // CAS update: only advance if HEAD is still what we read in step 1.
  runGit(projectRoot, ["update-ref", EDITS_REF, newCommit, head]);

  return { status: "undone", newCommit };
}
