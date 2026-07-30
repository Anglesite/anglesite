# h-resume Content Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new built-in `resume` content type — a per-site singleton (like `businessProfile`/`personalProfile`) that projects to the `h-resume` microformat and a `schema.org` `Person` JSON-LD node, with `experience`/`education` as the first real user of the `objectArray` field kind (#1117).

**Architecture:** One new `ContentTypeDescriptor` in the existing "one schema, three projections" registry (`ContentTypeRegistry.swift`), rendered by a new Astro layout (`Hresume.astro`) mounted from a new dedicated page (`src/pages/resume.astro`), and linked from the existing site-identity footer (`Hcard.astro`) so a visitor can find it from the h-card. No new SwiftUI, no `content.config.ts` changes, no new dependencies — every generic mechanism this needs (scaffolding, the typed-content editor's `ObjectArrayEditor`, singleton creation) already exists and needs no per-type code.

**Tech Stack:** Swift 6.4 (`AnglesiteCore`), Astro 5 + Zod-free JSON singleton data, `schema-dts` for JSON-LD typing, `astro-seo-schema`'s `<Schema>` component, `microformats-parser` (already a dependency of `scripts/microformats.ts`).

## Global Constraints

- Read `CONTRIBUTING.md` before making any change (already done for this plan) — conventional commits, ≤72-char subject, PR body must use `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings.
- No new dependencies — everything needed (`astro-seo-schema`, `schema-dts`, `microformats-parser`) is already a template dependency.
- **`resume` is a `.singleton`, not a `.collection`** — this deviates from the issue's own speculative implementation note ("Zod schema in `content.config.ts`"). Investigation (this plan's research phase) confirmed `content.config.ts`/Zod governs `.collection`-backed types only; the existing `businessProfile`/`personalProfile` singletons have **no** Zod schema anywhere — they're raw JSON data modules Astro components `import.meta.glob` directly. A resume is inherently one-per-site (the site owner's own career history), so `.singleton` is both architecturally correct and means **zero `content.config.ts`/`ContentConfigDriftTests` changes are needed** — that test suite's `configMatchesRegistry` only walks `.collection`-backed descriptors (`guard let collection = descriptor.collection else { continue }`).
- **`experience`/`education` member fields must stay scalar** — no `.markdown`, `.stringArray`, `.imageArray`, or nested `.objectArray` (the `objectArray` doc comment's documented invariant, enforced by review/tests, not the type system). This plan's fields are all `.string`/`.text`/`.date`.
- If you touch `Resources/Template/`, run `swift test --package-path .` too (some Swift tests couple to committed template markup) — every task below does.
- The real h-resume microformat vocabulary (verified against microformats.org/wiki/h-resume, quoted where used below): `p-name` (resume's own name), `p-summary` (overview), `p-contact` (nested h-card — **not implemented in this plan**, see Task 1's design note), `p-experience` (nests an h-event: "a job or other professional experience h-event event, years, embedded h-card of the organization, location, job-title"), `p-education` (same pattern for schools), `p-skill`, `p-affiliation` (**not implemented in this plan**). The wiki does not prescribe an exact class for the nested organization/school h-card — this plan uses `p-org h-card`, a documented judgment call (Task 2).
- schema.org has no dedicated "work history" vocabulary. This plan uses schema.org's own documented `Role`-wrapping pattern for `Person.hasOccupation` (verified against schema.org/Person's worked example) and the simpler `alumniOf` → `EducationalOrganization` mapping for education. See Task 2's design note for the exact shape and a fallback if `schema-dts` rejects the literal via `npm run typecheck`.

---

### Task 1: `resume` content-type descriptor

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift:33-38` (doc comment), `:47-50` (doc comment), `:253` (`builtIns`), insert new descriptor + section after line 485 (end of `personalProfile`)
- Modify: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` (new test)
- Modify: `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift` (new test)
- Modify: `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift` (new test)

**Interfaces:**
- Produces: `ContentTypeRegistry.resume: ContentTypeDescriptor` (`id: "resume"`, `storage: .singleton("resume")`), reachable via `ContentTypeRegistry.default.descriptor(id: "resume")` and `ContentTypeRegistry.builtIns`. Field names later tasks depend on: `name` (`.string`, required), `summary` (`.text`, required), `experience` (`.objectArray`, member fields `title`/`organization`/`startDate`/`endDate`/`description`), `education` (`.objectArray`, member fields `degree`/`institution`/`startDate`/`endDate`/`description`), `skills` (`.stringArray`).

- [ ] **Step 1: Write the failing registry test**

Add to `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` (near the other per-type tests, e.g. after `articleType()`):

```swift
@Test("Resume is a singleton projecting h-resume + schema.org Person, with experience/education as objectArray")
func resumeType() throws {
    let resume = try #require(ContentTypeRegistry().descriptor(id: "resume"))
    #expect(resume.storage == .singleton("resume"))
    #expect(resume.singletonSlot == "resume")
    #expect(resume.projections.microformat == "h-resume")
    #expect(resume.projections.schemaType == "Person")
    #expect(resume.projections.microformatProperties == [
        "name": "p-name",
        "summary": "p-summary",
        "skills": "p-skill",
    ])

    let name = try #require(resume.fields.first { $0.name == "name" })
    #expect(name.kind == .string)
    #expect(name.required)

    let summary = try #require(resume.fields.first { $0.name == "summary" })
    #expect(summary.kind == .text)
    #expect(summary.required)

    let experience = try #require(resume.fields.first { $0.name == "experience" })
    guard case .objectArray(let experienceFields) = experience.kind else {
        Issue.record("expected experience to be .objectArray")
        return
    }
    #expect(experienceFields.map(\.name) == ["title", "organization", "startDate", "endDate", "description"])
    #expect(experienceFields.filter(\.required).map(\.name) == ["title", "organization", "startDate"])

    let education = try #require(resume.fields.first { $0.name == "education" })
    guard case .objectArray(let educationFields) = education.kind else {
        Issue.record("expected education to be .objectArray")
        return
    }
    #expect(educationFields.map(\.name) == ["degree", "institution", "startDate", "endDate", "description"])
    #expect(educationFields.filter(\.required).map(\.name) == ["degree", "institution", "startDate"])

    let skills = try #require(resume.fields.first { $0.name == "skills" })
    #expect(skills.kind == .stringArray)
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: FAIL — `descriptor(id: "resume")` returns `nil`, tripping `#require`.

- [ ] **Step 3: Add the descriptor**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, update the `builtIns` line (currently line 253):

```swift
    public static let builtIns: [ContentTypeDescriptor] = personalTypes + identityTypes + resumeTypes + businessTypes + identityAndDirectoryTypes
```

Insert a new section after `personalProfile`'s closing `)` (currently line 485), before `// MARK: Business (collection types, #345 / §4.1)` (currently line 487):

```swift
    // MARK: Resume (h-resume singleton, #964)

    static let resumeTypes: [ContentTypeDescriptor] = [resume]

    /// The site owner's professional history — the first built-in user of `.objectArray`
    /// (#1117). A singleton, not a collection: a resume is inherently one-per-site, same
    /// storage shape as the identity types above (but its own `"resume"` slot, so it coexists
    /// with either `businessProfile` or `personalProfile` rather than competing for `"profile"`).
    ///
    /// `experience`/`education` carry no entry in `microformatProperties` — mf2 has no flat
    /// property for a repeating structured record. `Hresume.astro` nests each row as its own
    /// `p-experience h-event` / `p-education h-event` compound microformat instead, the same way
    /// `businessProfile.hours` above renders outside this projection's flat-property contract.
    ///
    /// Deliberately out of scope: mf2's `p-contact` (nested nested h-card) and `p-affiliation`.
    /// The site's own identity h-card (`personalProfile`/`businessProfile`, rendered by
    /// `Hcard.astro`) already carries the owner's contact info and is discoverable from every
    /// page footer; duplicating it as a nested h-card inside the resume adds real complexity
    /// (the app has no existing "one h-card links to related content" wiring to copy) for a
    /// property mf2 doesn't require a resume to carry.
    static let resume = ContentTypeDescriptor(
        id: "resume",
        displayName: "Resume",
        storage: .singleton("resume"),
        fields: [
            ContentTypeField("name", .string, required: true),
            ContentTypeField("summary", .text, required: true),
            ContentTypeField("experience", .objectArray(fields: [
                ContentTypeField("title", .string, required: true),
                ContentTypeField("organization", .string, required: true),
                ContentTypeField("startDate", .date, required: true),
                ContentTypeField("endDate", .date),
                ContentTypeField("description", .text),
            ])),
            ContentTypeField("education", .objectArray(fields: [
                ContentTypeField("degree", .string, required: true),
                ContentTypeField("institution", .string, required: true),
                ContentTypeField("startDate", .date, required: true),
                ContentTypeField("endDate", .date),
                ContentTypeField("description", .text),
            ])),
            ContentTypeField("skills", .stringArray),
        ],
        projections: ContentTypeProjections(
            microformat: "h-resume",
            microformatProperties: [
                "name": "p-name",
                "summary": "p-summary",
                "skills": "p-skill",
            ],
            schemaType: "Person"
        )
    )
```

- [ ] **Step 4: Run the registry test again to verify it passes**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: PASS.

- [ ] **Step 5: Update the two now-stale `objectArray` doc comments**

In the same file, `ContentTypeField.Kind.objectArray` doc comment currently ends its first paragraph with (around line 37-38):

```swift
        /// existing preference for documented invariants over new type machinery. No built-in
        /// descriptor declares this yet (#964 adds the first: h-resume).
```

Change to:

```swift
        /// existing preference for documented invariants over new type machinery. First declared
        /// by the built-in `resume` descriptor's `experience`/`education` fields (#964).
```

And the second paragraph currently ends (around line 47-50):

```swift
        /// Accepted for now — no descriptor uses `.objectArray` yet, so nothing is at risk — but
        /// preserving unknown per-record keys needs its own design (records would have to carry
        /// their unparsed extras through the editor), so weigh it before the first real adopter
        /// ships.
```

Change to:

```swift
        /// Accepted for `resume` — but preserving unknown per-record keys needs its own design
        /// (records would have to carry their unparsed extras through the editor), so weigh it
        /// before a second adopter ships.
```

- [ ] **Step 6: Write the failing scaffold test**

Add to `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift` (near the other `renderSingleton` tests):

```swift
@Test("renderSingleton scaffolds the real resume descriptor with empty experience/education/skills")
func renderSingletonResume() throws {
    let resume = try #require(ContentTypeRegistry().descriptor(id: "resume"))
    let out = ContentScaffold.renderSingleton(descriptor: resume, name: "Jane Doe")
    #expect(out.contains(#""type": "resume""#))
    #expect(out.contains(#""name": "Jane Doe""#))
    #expect(out.contains(#""summary": """#))
    #expect(out.contains(#""experience": []"#))
    #expect(out.contains(#""education": []"#))
    #expect(out.contains(#""skills": []"#))
}
```

- [ ] **Step 7: Run it to verify it fails**

Run: `swift test --package-path . --filter ContentScaffoldTests`
Expected: FAIL — `descriptor(id: "resume")` is `nil` before Step 3, or (if run after Step 3) should already PASS since `renderSingleton` already has generic `.objectArray` handling (`ContentScaffold.swift:262`, `case .stringArray, .imageArray, .objectArray: value = "[]"`). If it already passes, that's expected — this step exists to lock in the *real* descriptor's shape as a regression guard, not to prove new production code; proceed to Step 8 either way.

- [ ] **Step 8: Confirm it passes (no production code change expected)**

Run: `swift test --package-path . --filter ContentScaffoldTests`
Expected: PASS — `renderSingleton`'s `.objectArray` handling is already generic (shipped in #1117).

- [ ] **Step 9: Write the editor round-trip test against the real descriptor**

Add to `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`:

```swift
@Test("TypedContentEditor round-trips the real resume descriptor's experience records")
func resumeDescriptorRoundTrips() throws {
    let resume = try #require(ContentTypeRegistry().descriptor(id: "resume"))
    let scaffolded = ContentScaffold.renderSingleton(descriptor: resume, name: "Jane Doe")

    var values = TypedContentEditor.read(scaffolded, descriptor: resume)
    values["experience"] = .records([
        [
            "title": .text("Senior Engineer"),
            "organization": .text("Acme Corp"),
            "startDate": .date(Date(timeIntervalSince1970: 1_577_836_800)), // 2020-01-01
            "endDate": .date(nil),
            "description": .text("Led the platform team."),
        ],
    ])
    let written = TypedContentEditor.write(values, into: scaffolded, descriptor: resume)

    let reread = TypedContentEditor.read(written, descriptor: resume)
    guard case .records(let records)? = reread["experience"] else {
        Issue.record("expected experience to decode as .records")
        return
    }
    #expect(records.count == 1)
    #expect(records[0]["title"] == .text("Senior Engineer"))
    #expect(records[0]["organization"] == .text("Acme Corp"))
}
```

Note: `TypedContentEditor.read`/`write` operate on frontmatter YAML strings, not the JSON singleton format `ContentScaffold.renderSingleton` produces — this test exercises the shared `TypedContentEditor` machinery against the real descriptor's shape (the same machinery the singleton editor UI uses via `FrontmatterDocument`, which parses either format), not the JSON file directly. This is intentionally the same pattern `TypedContentEditorTests.swift`'s existing `.objectArray` tests already use with a synthetic `experience` fixture (`TypedContentEditorTests.swift:147-183`) — this test's only difference is using the *real* registered descriptor instead of an ad hoc one, so a future edit to the `resume` descriptor's field names is caught here.

- [ ] **Step 10: Run it to verify it fails, then passes**

Run: `swift test --package-path . --filter TypedContentEditorTests`
Expected: FAIL before Step 3 (descriptor missing), PASS after (the generic `.objectArray` encode/decode path is already implemented).

- [ ] **Step 11: Run the full Swift suite**

Run: `swift test --package-path .`
Expected: PASS, including `ContentConfigDriftTests` (unaffected — `resume` has no `.collection`, so `configMatchesRegistry`'s `guard let collection = descriptor.collection else { continue }` skips it).

- [ ] **Step 12: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift Tests/AnglesiteCoreTests/ContentScaffoldTests.swift Tests/AnglesiteCoreTests/TypedContentEditorTests.swift
git commit -m "feat(#964): register the h-resume content type"
```

---

### Task 2: `Hresume.astro` layout + schema.org projection

**Files:**
- Create: `Resources/Template/src/layouts/Hresume.astro`
- Modify: `Resources/Template/src/lib/schema.ts` (add `resumeSchema` + supporting interfaces)
- Test: `Resources/Template/src/lib/schema.test.ts` if it exists — check first with `find Resources/Template/src/lib -name "schema*"`; if no existing test file, skip a dedicated unit test here (this file's other functions are only covered by `JsonLdRenderSmokeTests.swift`'s built-HTML assertions per the existing pattern) and rely on Task 6's render-smoke test instead.

**Interfaces:**
- Consumes: `ContentTypeRegistry.resume`'s field shape from Task 1 (`name`, `summary`, `experience[]{title,organization,startDate,endDate,description}`, `education[]{degree,institution,startDate,endDate,description}`, `skills[]`) — informally, via the raw JSON shape a singleton data file has (no Zod/TS type generated from the Swift descriptor; this task hand-writes a matching TS interface, same as `HentryData`/`EventData` in `schema.ts` already do for collection types).
- Produces: `Hresume` Astro component (default export) with `Props { resume: ResumeData }`, and `resumeSchema(d: ResumeData, ctx: SchemaContext): WithContext<Person>` exported from `schema.ts` — Task 3's `resume.astro` page imports both.

- [ ] **Step 1: Add the schema.org projection to `schema.ts`**

In `Resources/Template/src/lib/schema.ts`, add near the other per-type interfaces (after `BlogData`, before `iso()`):

```ts
export interface ResumeExperienceData {
  title?: string;
  organization?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface ResumeEducationData {
  degree?: string;
  institution?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface ResumeData {
  name?: string;
  summary?: string;
  experience?: ResumeExperienceData[];
  education?: ResumeEducationData[];
  skills?: string[];
}
```

Add near the bottom of the file, after `blogPostingSchema`:

```ts
/**
 * schema.org JSON-LD for the `resume` singleton (#964). schema.org has no dedicated "work
 * history" vocabulary, so each `experience` entry uses schema.org's own documented `Role`-
 * wrapping pattern (https://schema.org/Person, `hasOccupation` worked example): the property
 * points at a `Role` node carrying `startDate`/`endDate`/`roleName` rather than a bare
 * `Occupation` node, which has no properties for dates or the employing organization. Education
 * uses the simpler, directly-documented `alumniOf` -> `EducationalOrganization` mapping; degree
 * and dates have no clean schema.org home on that relationship and are left to the mf2
 * projection (`Hresume.astro`), which carries the full shape.
 */
export function resumeSchema(d: ResumeData, ctx: SchemaContext): WithContext<Person> {
  const experience = d.experience ?? [];
  const education = d.education ?? [];
  const skills = d.skills ?? [];
  return clean<WithContext<Person>>({
    "@context": CONTEXT,
    "@type": "Person",
    name: d.name,
    description: d.summary,
    url: ctx.url,
    knowsAbout: skills,
    hasOccupation: experience.map((e) => ({
      "@type": "Role",
      roleName: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      description: e.description,
      worksFor: e.organization ? { "@type": "Organization", name: e.organization } : undefined,
    })),
    alumniOf: education.map((e) => ({
      "@type": "EducationalOrganization",
      name: e.institution,
    })),
  });
}
```

- [ ] **Step 2: Typecheck, and resolve any schema-dts friction**

Run (from `Resources/Template/`): `npm run typecheck`

If TypeScript rejects the `hasOccupation`/`alumniOf` array literals (schema-dts's `Person.hasOccupation` is spec-strict and may only accept `Occupation`, not the `Role` pattern, even though schema.org's own docs recommend `Role` there): add `import type { Role, Occupation, EducationalOrganization, Organization } from "schema-dts";` and cast at the property boundary — `hasOccupation: experience.map(...) as unknown as WithContext<Person>["hasOccupation"]` (and the same for `alumniOf`). This is a one-line, narrowly-scoped escape hatch for a known schema-dts-vs-schema.org-docs gap, not a broad `any` — comment it as such inline if you need it. Do not skip `npm run typecheck` — confirm the file actually compiles clean (with or without the cast) before moving on.

- [ ] **Step 3: Create `Hresume.astro`**

Create `Resources/Template/src/layouts/Hresume.astro`:

```astro
---
import { Schema } from "astro-seo-schema";
import BaseLayout from "./BaseLayout.astro";
import { resumeSchema, type ResumeData } from "../lib/schema.ts";

interface Props {
  resume: ResumeData;
}

const { resume } = Astro.props;
const experience = resume.experience ?? [];
const education = resume.education ?? [];
const skills = resume.skills ?? [];
const canonical = new URL(Astro.url.pathname, Astro.site ?? Astro.url).href;
const jsonLd = resumeSchema(resume, { url: canonical, site: Astro.site });
---

<BaseLayout
  title={resume.name ? `${resume.name} — Resume` : "Resume"}
  description={resume.summary}
>
  <Schema slot="head" item={jsonLd} />
  <article class="h-resume">
    {resume.name && <h1 class="p-name">{resume.name}</h1>}
    {resume.summary && <p class="p-summary">{resume.summary}</p>}

    {experience.length > 0 && (
      <section aria-labelledby="resume-experience-heading">
        <h2 id="resume-experience-heading">Experience</h2>
        <ul>
          {experience.map((entry) => (
            <li class="p-experience h-event">
              {entry.title && <span class="p-name">{entry.title}</span>}
              {entry.organization && (
                <>
                  {" at "}
                  <span class="p-org h-card"><span class="p-name">{entry.organization}</span></span>
                </>
              )}
              {entry.startDate && <time class="dt-start" datetime={entry.startDate}>{entry.startDate}</time>}
              {entry.endDate && <time class="dt-end" datetime={entry.endDate}>{entry.endDate}</time>}
              {entry.description && <p class="p-summary">{entry.description}</p>}
            </li>
          ))}
        </ul>
      </section>
    )}

    {education.length > 0 && (
      <section aria-labelledby="resume-education-heading">
        <h2 id="resume-education-heading">Education</h2>
        <ul>
          {education.map((entry) => (
            <li class="p-education h-event">
              {entry.degree && <span class="p-name">{entry.degree}</span>}
              {entry.institution && (
                <>
                  {" at "}
                  <span class="p-org h-card"><span class="p-name">{entry.institution}</span></span>
                </>
              )}
              {entry.startDate && <time class="dt-start" datetime={entry.startDate}>{entry.startDate}</time>}
              {entry.endDate && <time class="dt-end" datetime={entry.endDate}>{entry.endDate}</time>}
              {entry.description && <p class="p-summary">{entry.description}</p>}
            </li>
          ))}
        </ul>
      </section>
    )}

    {skills.length > 0 && (
      <section aria-labelledby="resume-skills-heading">
        <h2 id="resume-skills-heading">Skills</h2>
        <ul>{skills.map((skill) => <li class="p-skill">{skill}</li>)}</ul>
      </section>
    )}
  </article>
</BaseLayout>
```

Design notes for the reviewer (not comments in the file — keep the file itself lean, matching `Hevent.astro`'s style):
- `p-org h-card` on the nested organization/institution span is this plan's documented judgment call (Global Constraints) — the microformats.org wiki says only "embedded h-card of the organization," not an exact class.
- Job title / degree map to the nested h-event's own `p-name` (h-event's native title property); the free-text description maps to `p-summary` (not `e-content`/markdown — the registry's `description` field is `.text`, and h-event supports a plain-text summary the same way `Hreview.astro` doesn't need rich content for every field).
- The root `h-resume`'s own `p-contact`/`p-affiliation` are intentionally not rendered — see Task 1's design note.

- [ ] **Step 4: Typecheck again**

Run (from `Resources/Template/`): `npm run typecheck`
Expected: passes with no errors in `Hresume.astro` or `schema.ts`.

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/src/layouts/Hresume.astro Resources/Template/src/lib/schema.ts
git commit -m "feat(#964): add Hresume layout + schema.org Person projection"
```

---

### Task 3: `resume.astro` page

**Files:**
- Create: `Resources/Template/src/pages/resume.astro`

**Interfaces:**
- Consumes: `Hresume` component + `ResumeData` type from Task 2 (`../layouts/Hresume.astro`'s default export, `../lib/schema.ts`'s `ResumeData`).
- Produces: the `/resume/` route, `dist/resume/index.html` after `astro build` — the file Task 5's validator and Task 6's render-smoke test both read.

- [ ] **Step 1: Create the page**

Create `Resources/Template/src/pages/resume.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Hresume from "../layouts/Hresume.astro";
import type { ResumeData } from "../lib/schema.ts";

// Optional, same pattern as the site-identity singleton (Hcard.astro): the glob returns {} when
// src/data/resume.json is absent, so an unconfigured site gets a plain placeholder page here
// rather than a broken build — this is a fixed route (not a [...slug] page), so it always emits
// dist/resume/index.html whether or not a resume has been configured.
const mods = import.meta.glob<{ default: ResumeData }>("../data/resume.json", { eager: true });
const resume = Object.values(mods)[0]?.default;
---

{resume ? (
  <Hresume resume={resume} />
) : (
  <BaseLayout title="Resume" description="No resume has been published yet.">
    <p>No resume has been published yet.</p>
  </BaseLayout>
)}
```

- [ ] **Step 2: Build the template and eyeball the output**

Run (from `Resources/Template/`): `npx astro build`
Expected: build succeeds, `dist/resume/index.html` exists. With no `src/data/resume.json`, its content is the placeholder paragraph (no `h-resume` markup) — this is expected and matches Task 5's validator design (optional root, not an error when absent).

- [ ] **Step 3: Manually verify with a fixture, then clean up**

```bash
cd Resources/Template
mkdir -p src/data
cat > src/data/resume.json <<'EOF'
{
  "type": "resume",
  "name": "Jane Doe",
  "summary": "Backend engineer with a decade of distributed-systems experience.",
  "experience": [
    {"title": "Senior Engineer", "organization": "Acme Corp", "startDate": "2020-01-01", "endDate": "2024-06-30", "description": "Led the platform team."}
  ],
  "education": [
    {"degree": "B.S. Computer Science", "institution": "State University", "startDate": "2012-09-01", "endDate": "2016-05-15", "description": ""}
  ],
  "skills": ["Swift", "TypeScript"]
}
EOF
npx astro build
grep -o 'class="h-resume"' dist/resume/index.html
grep -o 'class="p-experience h-event"' dist/resume/index.html
grep -o 'application/ld+json' dist/resume/index.html
rm src/data/resume.json
rm -rf dist
```

Expected: both `grep -o` calls print one match each, confirming the mf2 root and nested experience markup render; the JSON-LD script tag is present.

- [ ] **Step 4: Commit**

```bash
git add Resources/Template/src/pages/resume.astro
git commit -m "feat(#964): add the /resume/ page"
```

---

### Task 4: Discovery link from the site's h-card

**Files:**
- Modify: `Resources/Template/src/components/Hcard.astro`

**Interfaces:**
- Consumes: `src/data/resume.json`'s `name` field (existence check only — same shallow-truthy pattern the file already uses for `profile.telephone`/`profile.url` etc.).
- Produces: a plain (no mf2 class — see design note below) `<a href="/resume/">` link inside the existing `<footer class="site-identity">`, present on every page since `BaseLayout.astro:53` unconditionally mounts `<Hcard />`. This is the acceptance criterion "included in the site's h-card discovery path so a contact can find it."

- [ ] **Step 1: Edit `Hcard.astro`**

Current file (`Resources/Template/src/components/Hcard.astro`):

```astro
---
// Site representative h-card (#388). Optional: renders only when src/data/profile.json exists.
// The glob returns {} when the file is absent, so an unconfigured site shows no footer identity.
// microformats2 only — the Person vs LocalBusiness schema.org @type is V-1.8.
const mods = import.meta.glob<{ default: Record<string, any> }>("../data/profile.json", { eager: true });
const profile = Object.values(mods)[0]?.default;
const hasAddress = profile && (profile.streetAddress || profile.locality || profile.region || profile.postalCode);
const hours: string[] = Array.isArray(profile?.hours) ? profile.hours : [];
---
```

Change to add a second, independent glob (mirrors the existing `profile` glob one line up — `resume` is a separate singleton slot, per Task 1, so it has its own optional data file):

```astro
---
// Site representative h-card (#388). Optional: renders only when src/data/profile.json exists.
// The glob returns {} when the file is absent, so an unconfigured site shows no footer identity.
// microformats2 only — the Person vs LocalBusiness schema.org @type is V-1.8.
const mods = import.meta.glob<{ default: Record<string, any> }>("../data/profile.json", { eager: true });
const profile = Object.values(mods)[0]?.default;
const hasAddress = profile && (profile.streetAddress || profile.locality || profile.region || profile.postalCode);
const hours: string[] = Array.isArray(profile?.hours) ? profile.hours : [];

// Resume discovery link (#964): a separate optional singleton (src/data/resume.json), same
// glob-returns-{}-when-absent pattern. Plain link, no mf2 class — h-card has no normative
// "resume" property, and the resume's own page carries the real h-resume markup.
const resumeMods = import.meta.glob<{ default: Record<string, any> }>("../data/resume.json", { eager: true });
const resume = Object.values(resumeMods)[0]?.default;
---
```

Then, inside the `<div class="h-card">`, add the link after the existing `u-url` line (so it reads naturally after the site's own URL) and before the `hours` block:

```astro
      {profile.url && <a class="u-url" rel="me" href={profile.url}>{profile.url}</a>}
      {resume?.name && <a href="/resume/">Resume</a>}
      {hours.length > 0 && (
```

- [ ] **Step 2: Manual verification**

```bash
cd Resources/Template
mkdir -p src/data
echo '{"type":"personalProfile","name":"Ada Lovelace"}' > src/data/profile.json
echo '{"type":"resume","name":"Ada Lovelace","summary":"x","experience":[],"education":[],"skills":[]}' > src/data/resume.json
npx astro build
grep -o 'href="/resume/"' dist/index.html
rm src/data/profile.json src/data/resume.json
rm -rf dist
```

Expected: one match — the link is present on the home page footer.

- [ ] **Step 3: Commit**

```bash
git add Resources/Template/src/components/Hcard.astro
git commit -m "feat(#964): link the resume from the site h-card footer"
```

---

### Task 5: mf2 validator coverage

**Files:**
- Modify: `Resources/Template/scripts/microformats.ts`
- Modify: `Resources/Template/scripts/microformats.test.ts`

**Interfaces:**
- Consumes: `Mf2Item` type, `findRoots`, `has` (all already defined in `microformats.ts`); the `dist/resume/index.html` file Task 3 produces.
- Produces: `validateResumeHtml(html: string, label: string, baseUrl?: string): string[]`, wired into `validateDist` — this is what makes `scripts/check-microformats.ts` (unchanged — it just calls `validateDist`) satisfy the issue's acceptance criterion "`h-resume` validates through `scripts/check-microformats.ts`".

- [ ] **Step 1: Write the failing unit tests**

First, update the file's import line (currently `import { validateEntryHtml, findRoots } from "./microformats.ts";`) to also pull in the new function:

```ts
import { validateEntryHtml, validateResumeHtml, findRoots } from "./microformats.ts";
```

Then add to `Resources/Template/scripts/microformats.test.ts` (near the end, after the `u-license` tests, before nothing — it's the last block in the file):

```ts
// --- #964 (h-resume) --------------------------------------------------------
const GOOD_RESUME = `<!doctype html><html><body>
<article class="h-resume">
  <h1 class="p-name">Jane Doe</h1>
  <p class="p-summary">Backend engineer.</p>
  <ul>
    <li class="p-experience h-event">
      <span class="p-name">Senior Engineer</span>
      <span class="p-org h-card"><span class="p-name">Acme Corp</span></span>
      <time class="dt-start" datetime="2020-01-01">2020</time>
      <time class="dt-end" datetime="2024-06-30">2024</time>
    </li>
  </ul>
  <ul>
    <li class="p-education h-event">
      <span class="p-name">B.S. Computer Science</span>
      <time class="dt-start" datetime="2012-09-01">2012</time>
    </li>
  </ul>
  <ul><li class="p-skill">TypeScript</li></ul>
</article></body></html>`;

test("valid h-resume passes, with nested experience/education parsed as h-event", () => {
  assert.deepEqual(validateResumeHtml(GOOD_RESUME, "resume/index.html"), []);
  const [item] = findRoots(GOOD_RESUME);
  assert.deepEqual(item.properties.name, ["Jane Doe"]);
  const [experience] = item.properties.experience as unknown as Array<{ type: string[]; properties: Record<string, unknown[]> }>;
  assert.ok(experience.type.includes("h-event"));
  assert.deepEqual(experience.properties.name, ["Senior Engineer"]);
});

test("a page with no h-resume root is not an error (the singleton is optional)", () => {
  const html = `<!doctype html><html><body><p>No resume yet.</p></body></html>`;
  assert.deepEqual(validateResumeHtml(html, "resume/index.html"), []);
});

test("h-resume missing p-summary is flagged", () => {
  const html = `<!doctype html><html><body>
  <article class="h-resume"><h1 class="p-name">Jane Doe</h1></article>
  </body></html>`;
  const problems = validateResumeHtml(html, "resume/index.html");
  assert.ok(problems.some((p) => p.includes("missing p-summary")), problems.join("; "));
});

test("an experience entry missing dt-start is flagged", () => {
  const html = `<!doctype html><html><body>
  <article class="h-resume">
    <h1 class="p-name">Jane Doe</h1>
    <p class="p-summary">x</p>
    <li class="p-experience h-event"><span class="p-name">Engineer</span></li>
  </article></body></html>`;
  const problems = validateResumeHtml(html, "resume/index.html");
  assert.ok(problems.some((p) => p.includes("experience[0] missing dt-start")), problems.join("; "));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `Resources/Template/`): `npx tsx --test scripts/microformats.test.ts`
Expected: FAIL — `validateResumeHtml` is not exported / doesn't exist yet.

- [ ] **Step 3: Implement `validateResumeHtml`**

In `Resources/Template/scripts/microformats.ts`, add after `validateRoots` (before `walkHtml`):

```ts
/**
 * Validate the `resume` singleton page (`/resume/`, #964) if it exists in the build output.
 * Unlike `ENTRY_TYPES`, an `h-resume` root is optional — a site with no `src/data/resume.json`
 * renders a placeholder page with no `h-resume` markup at all, and that is not a failure (mirrors
 * the `businessProfile`/`personalProfile` identity h-card, which this script has never required).
 */
export function validateResumeHtml(html: string, label: string, baseUrl = BASE_URL): string[] {
  const roots = findRoots(html, baseUrl).filter((i) => i.type.includes("h-resume"));
  if (roots.length === 0) return [];

  const problems: string[] = [];
  if (roots.length > 1) {
    problems.push(`${label}: expected at most one h-resume root, found ${roots.length}`);
  }

  const item = roots[0];
  if (!has(item, "name")) problems.push(`${label}: h-resume missing p-name`);
  if (!has(item, "summary")) problems.push(`${label}: h-resume missing p-summary`);

  const checkNestedEvents = (propName: "experience" | "education") => {
    const raw = (item.properties[propName] ?? []) as unknown[];
    raw.forEach((value, i) => {
      const entry = value as Mf2Item;
      if (!entry?.type?.includes("h-event")) {
        problems.push(`${label}: h-resume ${propName}[${i}] is not a nested h-event`);
        return;
      }
      if (!has(entry, "name")) problems.push(`${label}: h-resume ${propName}[${i}] missing p-name`);
      if (!has(entry, "start")) problems.push(`${label}: h-resume ${propName}[${i}] missing dt-start`);
    });
  };
  checkNestedEvents("experience");
  checkNestedEvents("education");

  return problems;
}
```

- [ ] **Step 4: Run the unit tests again to verify they pass**

Run (from `Resources/Template/`): `npx tsx --test scripts/microformats.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `validateDist`**

In `Resources/Template/scripts/microformats.ts`, add `existsSync` to the existing `node:fs` import (currently `import { readdirSync, readFileSync, statSync } from "node:fs";`):

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
```

In `validateDist`, add the resume-page check right after the `for (const t of ENTRY_TYPES)` coverage loop's closing brace (end of the function, before `return problems;`):

```ts
  const resumePage = join(distDir, "resume", "index.html");
  if (existsSync(resumePage)) {
    problems.push(...validateResumeHtml(readFileSync(resumePage, "utf8"), "resume/index.html"));
  }

  return problems;
```

- [ ] **Step 6: Run the full script test suite**

Run (from `Resources/Template/`): `npm run test:scripts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/scripts/microformats.ts Resources/Template/scripts/microformats.test.ts
git commit -m "feat(#964): validate the h-resume singleton page in check-microformats"
```

---

### Task 6: End-to-end Swift render-smoke test

**Files:**
- Create: `Tests/AnglesiteCoreTests/HresumeRenderSmokeTests.swift`

**Interfaces:**
- Consumes: everything from Tasks 2-5 — this is the acceptance proof that a real `astro build` of the committed template renders `h-resume` mf2, nests `experience`/`education` as `h-event`, emits JSON-LD, and links from the h-card, all from one `src/data/resume.json` fixture. Follows the exact pattern of `Tests/AnglesiteCoreTests/SiteIdentityRenderSmokeTests.swift` (sequential scenarios sharing one `TemplateBuildSerializer.shared.serialize` block) and `JsonLdRenderSmokeTests.swift` (JSON-LD assertions).

- [ ] **Step 1: Write the test**

Create `Tests/AnglesiteCoreTests/HresumeRenderSmokeTests.swift`:

```swift
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// #964: the `resume` singleton renders real h-resume mf2 (with experience/education nested as
/// h-event), schema.org JSON-LD, and a discovery link from the site's h-card footer.
@Suite("h-resume render smoke")
struct HresumeRenderSmokeTests {

    static var templateDir: URL { get throws { try templateRoot() } }

    static var buildable: Bool { ((try? templateDir).map { E2EPrerequisites.astroBuildable(templateDir: $0) }) ?? false }

    @Test("resume page renders h-resume mf2 + JSON-LD when configured, a placeholder when not, and links from the h-card",
          .enabled(if: HresumeRenderSmokeTests.buildable))
    func rendersResume() async throws {
        let node = try #require(E2EPrerequisites.locateNode())
        let dataDir = try Self.templateDir.appendingPathComponent("src/data", isDirectory: true)
        let resumeFile = dataDir.appendingPathComponent("resume.json")
        let profileFile = dataDir.appendingPathComponent("profile.json")
        let dist = try Self.templateDir.appendingPathComponent("dist", isDirectory: true)

        func build() async throws {
            try? FileManager.default.removeItem(at: dist)
            let result = try await ProcessSupervisor.shared.run(
                executable: node,
                arguments: [E2EPrerequisites.astroCLIRelativePath, "build"],
                currentDirectoryURL: Self.templateDir)
            try #require(result.exitCode == 0, "astro build failed: \(result.stdout)\n\(result.stderr)")
        }
        func resumeHTML() throws -> String {
            try String(contentsOf: dist.appendingPathComponent("resume/index.html"), encoding: .utf8)
        }
        func indexHTML() throws -> String {
            try String(contentsOf: dist.appendingPathComponent("index.html"), encoding: .utf8)
        }
        func write(_ url: URL, _ json: String) throws {
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try json.write(to: url, atomically: true, encoding: .utf8)
        }

        try await TemplateBuildSerializer.shared.serialize {
            defer {
                try? FileManager.default.removeItem(at: resumeFile)
                try? FileManager.default.removeItem(at: profileFile)
                try? FileManager.default.removeItem(at: dist)
            }

            // 1. Unconfigured: no resume.json → placeholder page, no h-resume markup.
            try? FileManager.default.removeItem(at: resumeFile)
            try await build()
            #expect(!(try resumeHTML().contains("h-resume")))

            // 2. Configured: full mf2 + JSON-LD.
            try write(resumeFile, """
            {
              "type": "resume",
              "name": "Jane Doe",
              "summary": "Backend engineer with a decade of distributed-systems experience.",
              "experience": [
                {"title": "Senior Engineer", "organization": "Acme Corp", "startDate": "2020-01-01", "endDate": "2024-06-30", "description": "Led the platform team."}
              ],
              "education": [
                {"degree": "B.S. Computer Science", "institution": "State University", "startDate": "2012-09-01", "endDate": "2016-05-15", "description": ""}
              ],
              "skills": ["Swift", "TypeScript"]
            }
            """)
            try await build()
            let resume = try resumeHTML()
            #expect(resume.contains("h-resume"))
            #expect(resume.contains("Jane Doe"))
            #expect(resume.contains("p-experience h-event"))
            #expect(resume.contains("p-org h-card"))
            #expect(resume.contains("Acme Corp"))
            #expect(resume.contains("dt-start"))
            #expect(resume.contains("2020-01-01"))
            #expect(resume.contains("p-education h-event"))
            #expect(resume.contains("p-skill"))
            #expect(resume.contains("Swift"))
            #expect(resume.contains("application/ld+json"))
            #expect(resume.contains("\"@type\":\"Person\""))
            #expect(resume.contains("\"hasOccupation\""))
            #expect(resume.contains("\"alumniOf\""))

            // 3. Discovery: the site h-card footer links to /resume/ once both singletons exist.
            try write(profileFile, #"{"type":"personalProfile","name":"Jane Doe"}"#)
            try await build()
            #expect(try indexHTML().contains(#"href="/resume/""#))
        }
    }
}
```

- [ ] **Step 2: Run it**

Run: `swift test --package-path . --filter HresumeRenderSmokeTests`
Expected: PASS. If it fails, check each `#expect` against the actual built HTML (`cat Resources/Template/dist/resume/index.html`) before assuming the test itself is wrong — this is the first real build of everything from Tasks 2-5 together, so a mismatch here is more likely a markup/wiring bug than a bad assertion.

- [ ] **Step 3: Run the entire Swift suite one more time**

Run: `swift test --package-path .`
Expected: PASS.

- [ ] **Step 4: Run the full template test suite**

Run (from `Resources/Template/`): `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Tests/AnglesiteCoreTests/HresumeRenderSmokeTests.swift
git commit -m "test(#964): end-to-end render-smoke coverage for h-resume"
```

---

## Final Acceptance Check

Before opening the PR, re-verify each of the issue's acceptance boxes against what actually shipped:

- [ ] `h-resume` validates through `scripts/check-microformats.ts` — Task 5 (`validateResumeHtml` wired into `validateDist`), proven by Task 6's build.
- [ ] JSON-LD projection emits alongside the mf2 — Task 2 (`resumeSchema`) + Task 3 (`<Schema slot="head">` in `Hresume.astro`), proven by Task 6.
- [ ] Editable via the generic typed-content editor with no bespoke SwiftUI — Task 1 only adds data (`ContentTypeDescriptor`); confirmed no `businessProfile`/`personalProfile`-specific SwiftUI exists anywhere in `Sources/AnglesiteApp` to mirror, and `TypedEntryEditorView`'s `ObjectArrayEditor` already handles `.objectArray` generically (#1117) — no new Swift UI code in this plan.
- [ ] Included in the site's h-card discovery path so a contact can find it — Task 4 (`Hcard.astro` link), proven by Task 6's scenario 3.
