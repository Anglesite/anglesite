import { describe, it, expect } from "vitest";
import {
  parseSnapshots,
  pickRef,
  formatSnapshotLine,
  formatSnapshotList,
  recoveryBranchName,
  LOG_FORMAT,
} from "../template/scripts/restore-snapshots.js";

const FIELD = "\x1f";
const RECORD = "\x1e";

function record(
  hash: string,
  shortHash: string,
  iso: string,
  rel: string,
  subject: string,
  refs = "",
): string {
  return [hash, shortHash, iso, rel, subject, refs].join(FIELD) + RECORD;
}

describe("LOG_FORMAT", () => {
  it("uses unit and record separators git won't emit naturally", () => {
    expect(LOG_FORMAT).toContain("%H");
    expect(LOG_FORMAT).toContain("%h");
    expect(LOG_FORMAT).toContain("%aI");
    expect(LOG_FORMAT).toContain("%ar");
    expect(LOG_FORMAT).toContain("%s");
    expect(LOG_FORMAT).toContain("%D");
    expect(LOG_FORMAT.endsWith(RECORD)).toBe(true);
  });
});

describe("parseSnapshots", () => {
  it("parses a single record", () => {
    const raw = record(
      "abcdef1234567890",
      "abcdef1",
      "2026-05-06T12:00:00+00:00",
      "2 hours ago",
      "Add 2 blog posts",
    );
    const snaps = parseSnapshots(raw);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual({
      hash: "abcdef1234567890",
      shortHash: "abcdef1",
      isoDate: "2026-05-06T12:00:00+00:00",
      relativeDate: "2 hours ago",
      subject: "Add 2 blog posts",
    });
  });

  it("parses multiple records", () => {
    const raw =
      record("h1", "s1", "2026-05-06T12:00:00+00:00", "1 hour ago", "First") +
      record("h2", "s2", "2026-05-05T12:00:00+00:00", "yesterday", "Second");
    const snaps = parseSnapshots(raw);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].subject).toBe("First");
    expect(snaps[1].subject).toBe("Second");
  });

  it("extracts a tag ref when present", () => {
    const raw = record(
      "h1",
      "s1",
      "2026-01-01T00:00:00+00:00",
      "5 months ago",
      "Initial setup",
      "HEAD -> draft, tag: v1.0, origin/draft",
    );
    const snaps = parseSnapshots(raw);
    expect(snaps[0].ref).toBe("v1.0");
  });

  it("returns empty array for empty input", () => {
    expect(parseSnapshots("")).toEqual([]);
  });

  it("ignores trailing whitespace and blank records", () => {
    const raw =
      record("h1", "s1", "2026-05-06T12:00:00+00:00", "now", "Only one") +
      "\n\n";
    const snaps = parseSnapshots(raw);
    expect(snaps).toHaveLength(1);
  });

  it("handles subjects containing commas and colons", () => {
    const raw = record(
      "h1",
      "s1",
      "2026-05-06T12:00:00+00:00",
      "1 day ago",
      "Add About, Services pages: launch prep",
    );
    const snaps = parseSnapshots(raw);
    expect(snaps[0].subject).toBe("Add About, Services pages: launch prep");
  });
});

describe("pickRef", () => {
  it("prefers tags over branches", () => {
    expect(pickRef("HEAD -> draft, tag: v1.0, origin/draft")).toBe("v1.0");
  });

  it("falls back to remote branches when no tag is present", () => {
    expect(pickRef("HEAD -> draft, origin/draft")).toBe("origin/draft");
  });

  it("falls back to a local branch when no remote is present", () => {
    expect(pickRef("draft")).toBe("draft");
  });

  it("returns undefined for empty decoration", () => {
    expect(pickRef("")).toBeUndefined();
  });

  it("ignores HEAD-only decorations", () => {
    expect(pickRef("HEAD")).toBeUndefined();
  });
});

describe("formatSnapshotLine", () => {
  it("renders a snapshot with date, subject, and short hash", () => {
    const line = formatSnapshotLine(
      {
        hash: "abcdef1234567890",
        shortHash: "abcdef1",
        isoDate: "2026-05-06T12:00:00+00:00",
        relativeDate: "2 hours ago",
        subject: "Add 2 blog posts",
      },
      1,
    );
    expect(line).toBe("1. 2 hours ago — Add 2 blog posts (abcdef1)");
  });

  it("includes a ref label when present", () => {
    const line = formatSnapshotLine(
      {
        hash: "h",
        shortHash: "h",
        isoDate: "2026-01-01T00:00:00+00:00",
        relativeDate: "5 months ago",
        subject: "Initial setup",
        ref: "v1.0",
      },
      3,
    );
    expect(line).toContain("[v1.0]");
  });
});

describe("formatSnapshotList", () => {
  it("returns a friendly message when there are no snapshots", () => {
    expect(formatSnapshotList([])).toContain("No backups");
  });

  it("numbers entries starting at 1", () => {
    const list = formatSnapshotList([
      {
        hash: "h1",
        shortHash: "s1",
        isoDate: "2026-05-06T12:00:00+00:00",
        relativeDate: "now",
        subject: "First",
      },
      {
        hash: "h2",
        shortHash: "s2",
        isoDate: "2026-05-05T12:00:00+00:00",
        relativeDate: "yesterday",
        subject: "Second",
      },
    ]);
    expect(list.startsWith("1.")).toBe(true);
    expect(list).toContain("\n2.");
  });
});

describe("recoveryBranchName", () => {
  it("uses the recovery/ prefix and a sortable timestamp", () => {
    const name = recoveryBranchName(new Date(Date.UTC(2026, 4, 6, 15, 30)));
    expect(name).toBe("recovery/2026-05-06-1530");
  });

  it("zero-pads single-digit components", () => {
    const name = recoveryBranchName(new Date(Date.UTC(2026, 0, 1, 1, 5)));
    expect(name).toBe("recovery/2026-01-01-0105");
  });

  it("produces a valid git branch name with no spaces or special chars", () => {
    const name = recoveryBranchName(new Date(Date.UTC(2026, 4, 6, 15, 30)));
    expect(name).toMatch(/^recovery\/[0-9-]+$/);
  });
});
