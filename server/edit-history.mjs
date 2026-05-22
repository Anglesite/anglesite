/**
 * Hidden-branch edit history for the Anglesite-app edit pipeline (#298).
 *
 * Every successful patch from `apply-edit-dispatcher.mjs` calls `recordEdit` here, which
 * commits the post-patch file content onto `refs/heads/anglesite/edits` without touching the
 * user's HEAD, current branch, index, or working tree. The trick is git's plumbing:
 *
 *   - Initialize `anglesite/edits` from `HEAD` on first call.
 *   - Use a *temporary* `GIT_INDEX_FILE` so the real index is untouched.
 *   - `read-tree anglesite/edits` into the temp index, `hash-object -w` the post-patch file,
 *     `update-index --cacheinfo` to stage it, `write-tree`, `commit-tree`, `update-ref`
 *     with CAS (OLDVALUE) so concurrent calls can't lose commits.
 *
 * Returns the new commit SHA, or `undefined` on any failure — that includes "projectRoot
 * isn't a git repo", "no commits yet on HEAD", "git binary missing", etc. The dispatcher
 * treats `undefined` as "history not recorded; the on-disk patch still landed" and omits
 * `commit` from the `edit-applied` response. Honest about partial success.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

function isGitRepo(projectRoot) {
  return tryRunGit(projectRoot, ["rev-parse", "--git-dir"]) !== undefined;
}

function formatMessage({ file, range, message }) {
  const headline = message && message.trim() ? message.trim() : `anglesite: edit ${file}`;
  return `${headline}\n\nfile: ${file}\nrange: ${range.start}-${range.end}\n`;
}

/**
 * @param {string} projectRoot
 * @param {{ file: string, range: {start:number,end:number}, message?: string }} info
 * @returns {Promise<string | undefined>} commit SHA, or undefined on any failure
 */
export async function recordEdit(projectRoot, { file, range, message }) {
  if (!isGitRepo(projectRoot)) return undefined;

  try {
    // 1. Ensure refs/heads/anglesite/edits exists, initializing from HEAD on first edit.
    const existing = tryRunGit(projectRoot, ["show-ref", "--verify", "--hash", EDITS_REF]);
    if (!existing) {
      const head = tryRunGit(projectRoot, ["rev-parse", "HEAD"]);
      if (!head) return undefined; // empty repo with no commits yet
      runGit(projectRoot, ["update-ref", EDITS_REF, head]);
    }

    // 2. Build the new tree on top of anglesite/edits using a *temporary* index, so the
    //    user's real index stays untouched even if they had staged changes.
    const tmpDir = mkdtempSync(join(tmpdir(), "anglesite-edit-idx-"));
    const tmpIndex = join(tmpDir, "index");
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      runGit(projectRoot, ["read-tree", EDITS_REF], env);
      // hash-object -w writes a blob from the on-disk file content into the object DB,
      // regardless of whether `file` is tracked or .gitignored.
      const blob = runGit(projectRoot, ["hash-object", "-w", "--", file]);
      // --cacheinfo lets us add/replace by blob SHA without consulting the working index.
      runGit(
        projectRoot,
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`],
        env,
      );
      const tree = runGit(projectRoot, ["write-tree"], env);
      const parent = runGit(projectRoot, ["rev-parse", EDITS_REF]);
      const commit = runGit(projectRoot, [
        "commit-tree", tree, "-p", parent, "-m", formatMessage({ file, range, message }),
      ]);
      // CAS update with OLDVALUE so two concurrent recordEdits can't silently clobber each other.
      runGit(projectRoot, ["update-ref", EDITS_REF, commit, parent]);
      return commit;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    return undefined;
  }
}
