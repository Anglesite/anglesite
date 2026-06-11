import { describe, it, expect } from "vitest";
import {
  buildSubmissionText,
  renderSubmission,
  formatTriageSummary,
  type Submission,
  type TriageTally,
} from "../template/scripts/fetch-submissions.js";

const sample: Submission = {
  id: "abc123",
  formSlug: "contact",
  formTitle: "Contact Form",
  submittedAt: "2026-06-10T12:00:00Z",
  senderName: "Maria",
  senderEmail: "maria@example.com",
  entries: [
    { key: "message", label: "Message", type: "textarea", value: "Do you have availability?" },
  ],
};

describe("buildSubmissionText", () => {
  it("includes form title, sender, and entry label:value", () => {
    const text = buildSubmissionText(sample);
    expect(text).toContain("Contact Form");
    expect(text).toContain("Maria");
    expect(text).toContain("maria@example.com");
    expect(text).toContain("Message: Do you have availability?");
  });
  it("truncates very long values", () => {
    const big: Submission = { ...sample, entries: [{ key: "m", value: "x".repeat(5000) }] };
    const line = buildSubmissionText(big).split("\n").find((l) => l.startsWith("m:"))!;
    expect(line.length).toBeLessThan(1100);
  });
});

describe("renderSubmission", () => {
  it("omits ai fields when no classification is given", () => {
    const out = renderSubmission(sample);
    expect(out).not.toContain("aiCategory");
    expect(out).toContain("status: new");
  });
  it("emits advisory ai fields when a classification is given", () => {
    const out = renderSubmission(sample, { category: "lead", isSpam: false, reason: "wants a quote" });
    expect(out).toContain("aiCategory: lead");
    expect(out).toContain("aiSpam: no");
    expect(out).toContain("aiReason:");
    expect(out).toContain("aiModel: apple-fm-system");
    expect(out).toContain("status: new");
  });
});

describe("formatTriageSummary", () => {
  it("returns empty string when nothing was classified", () => {
    const t: TriageTally = { classified: 0, spam: 0, lead: 0, support: 0, question: 0, other: 0 };
    expect(formatTriageSummary(t)).toBe("");
  });
  it("summarizes nonzero buckets", () => {
    const t: TriageTally = { classified: 3, spam: 1, lead: 2, support: 0, question: 0, other: 0 };
    expect(formatTriageSummary(t)).toBe("Triaged 3 new: 1 likely spam, 2 leads");
  });
});
