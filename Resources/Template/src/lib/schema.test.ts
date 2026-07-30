import test from "node:test";
import assert from "node:assert/strict";
import { blogPostingSchema, entrySchema, resumeSchema, type SchemaContext } from "./schema.ts";

const LICENSE = "https://creativecommons.org/licenses/by/4.0/";

function ctx(overrides: Partial<SchemaContext> = {}): SchemaContext {
  return { url: "https://example.com/notes/hi/", site: new URL("https://example.com"), ...overrides };
}

test("entrySchema: notes carry the license URL when one is supplied", () => {
  const out = entrySchema("notes", { publishDate: new Date("2026-01-02") }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: articles carry the license URL", () => {
  const out = entrySchema("articles", { title: "Hi" }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: omits license entirely when none is supplied", () => {
  const out = entrySchema("notes", { publishDate: new Date("2026-01-02") }, ctx());
  assert.equal(Object.hasOwn(out as object, "license"), false);
});

test("entrySchema: events emit no license (Event is not a CreativeWork)", () => {
  const out = entrySchema("events", { name: "Meetup" }, ctx({ license: LICENSE }));
  assert.equal(Object.hasOwn(out as object, "license"), false);
});

test("entrySchema: likes still project nothing at all", () => {
  assert.equal(entrySchema("likes", {}, ctx({ license: LICENSE })), null);
});

test("blogPostingSchema: carries the license URL", () => {
  const out = blogPostingSchema({ title: "Hi" }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: reviews carry the license URL when one is supplied", () => {
  const out = entrySchema("reviews", { itemReviewed: "A Book", rating: 4 }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});

test("resumeSchema: projects name, summary, skills, experience, and education", () => {
  const out = resumeSchema(
    {
      name: "Ada Lovelace",
      summary: "Mathematician and writer.",
      skills: ["Analytical Engines", "Algorithms"],
      experience: [
        {
          title: "Analyst",
          organization: "Royal Society",
          startDate: "1840",
          endDate: "1852",
          description: "Wrote the first algorithm intended for a machine.",
        },
      ],
      education: [{ degree: "Self-taught", institution: "Home" }],
    },
    ctx(),
  ) as unknown as Record<string, unknown>;

  assert.equal(out["@type"], "Person");
  assert.equal(out.name, "Ada Lovelace");
  assert.equal(out.description, "Mathematician and writer.");
  assert.deepEqual(out.knowsAbout, ["Analytical Engines", "Algorithms"]);

  const occupations = out.hasOccupation as Record<string, unknown>[];
  assert.equal(occupations.length, 1);
  assert.equal(occupations[0]["@type"], "Role");
  assert.equal(occupations[0].roleName, "Analyst");
  assert.equal(occupations[0].startDate, "1840");
  assert.deepEqual(occupations[0].worksFor, { "@type": "Organization", name: "Royal Society" });

  const alumniOf = out.alumniOf as Record<string, unknown>[];
  assert.equal(alumniOf.length, 1);
  assert.equal(alumniOf[0]["@type"], "EducationalOrganization");
  assert.equal(alumniOf[0].name, "Home");
});

test("resumeSchema: omits empty arrays and undefined fields when the resume is sparse", () => {
  const out = resumeSchema({ name: "Anonymous" }, ctx()) as unknown as Record<string, unknown>;
  assert.equal(out.name, "Anonymous");
  assert.equal(Object.hasOwn(out, "description"), false);
  assert.equal(Object.hasOwn(out, "knowsAbout"), false);
  assert.equal(Object.hasOwn(out, "hasOccupation"), false);
  assert.equal(Object.hasOwn(out, "alumniOf"), false);
});
