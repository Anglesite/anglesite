/**
 * Restore snapshots — parses git log/tag output into a list of restore points.
 *
 * Used by /anglesite:backup (restore flow) to present the owner with a list
 * of snapshots they can roll back to.
 */

export interface Snapshot {
  hash: string;
  shortHash: string;
  isoDate: string;
  relativeDate: string;
  subject: string;
  ref?: string;
}

// ASCII Unit Separator and Record Separator — git won't emit these naturally,
// so subjects with commas, colons, or pipes round-trip safely.
const FIELD = "\x1f";
const RECORD = "\x1e";

/**
 * Format string for `git log` that emits the fields parseSnapshots expects.
 * Run as: `git log --format="${LOG_FORMAT}" <revisions>`.
 */
export const LOG_FORMAT = `%H${FIELD}%h${FIELD}%aI${FIELD}%ar${FIELD}%s${FIELD}%D${RECORD}`;

/**
 * Parse the output of `git log --format=LOG_FORMAT` into snapshots.
 * @param raw - Raw stdout from git log using LOG_FORMAT.
 * @returns Snapshots in chronological order matching the git log output.
 */
export function parseSnapshots(raw: string): Snapshot[] {
  return raw
    .split(RECORD)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, isoDate, relativeDate, subject, refs] =
        record.split(FIELD);
      const ref = pickRef(refs ?? "");
      const snap: Snapshot = {
        hash,
        shortHash,
        isoDate,
        relativeDate,
        subject,
      };
      if (ref) snap.ref = ref;
      return snap;
    });
}

/**
 * Pick the most useful ref name from a `%D` decoration string.
 * Prefers tags, then remote-tracking branches, then local branches.
 * @param decoration - The %D field from `git log` (e.g. "HEAD -> draft, tag: v1.0, origin/draft").
 * @returns A single ref name, or undefined if none found.
 */
export function pickRef(decoration: string): string | undefined {
  const refs = decoration
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (refs.length === 0) return undefined;

  const tag = refs.find((r) => r.startsWith("tag:"));
  if (tag) return tag.replace(/^tag:\s*/, "");

  const remote = refs.find((r) => r.startsWith("origin/"));
  if (remote) return remote;

  const local = refs.find((r) => !r.startsWith("HEAD"));
  return local;
}

/**
 * Render a snapshot as a single human-readable line.
 * @param snap - Snapshot to render.
 * @param index - 1-based index for the owner-facing list.
 * @returns Line like "1. 3 days ago — Add 2 blog posts (a1b2c3d)".
 */
export function formatSnapshotLine(snap: Snapshot, index: number): string {
  const ref = snap.ref ? ` [${snap.ref}]` : "";
  return `${index}. ${snap.relativeDate} — ${snap.subject} (${snap.shortHash})${ref}`;
}

/**
 * Build a numbered, owner-facing list of snapshots.
 * @param snapshots - Snapshots to render, in display order.
 * @returns Multi-line string suitable for display in chat.
 */
export function formatSnapshotList(snapshots: Snapshot[]): string {
  if (snapshots.length === 0) {
    return "No backups found yet. Run /anglesite:backup to save your first snapshot.";
  }
  return snapshots.map((s, i) => formatSnapshotLine(s, i + 1)).join("\n");
}

/**
 * Generate the recovery branch name for a restore operation.
 * @param now - Reference date (defaults to current time).
 * @returns Branch name like "recovery/2026-05-06-1530".
 */
export function recoveryBranchName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  return `recovery/${y}-${m}-${d}-${hh}${mm}`;
}
