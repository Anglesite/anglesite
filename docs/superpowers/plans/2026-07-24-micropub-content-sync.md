# Micropub Content Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Micropub-created post (note/article/photo/album/bookmark/reply/like/event/review) becomes a typed content file under `Source/`, rendering at the same URL the Micropub client's `Location` header promised, per `docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md`.

**Architecture:** Two halves. (1) `Resources/Template/worker/post-type-discovery.ts`, wired into the Micropub Worker composition via a custom `generatePostUrl`, classifies each incoming post once at creation time and encodes the target collection into its assigned URL (`{baseUrl}/{collection}/{slug}`). (2) A third app-side D1-to-git sync bridge — `MicropubPostD1Client` → `MicropubContentSync` → `MicropubContentCommitter`, mirroring the already-shipped `WebmentionInboxD1Client` → `ReceivedInteractionSync` → `ReceivedInteractionCommitter` (#362) — reads `MICROPUB_DB`, parses the collection back out of each post's URL (no re-classification needed), maps mf2 properties to frontmatter via the registry's existing `ContentTypeProjections`, and reconciles `src/content/<collection>/` on every site-open.

**Tech Stack:** TypeScript (Cloudflare Worker, vitest + `@cloudflare/vitest-pool-workers`), Swift 6.4 (AnglesiteCore, Swift Testing).

## Global Constraints

- Conventional commit subjects, ≤72 characters, referencing #912 (`docs/superpowers/spec` reads `#912 (V-3.2 follow-up)`).
- New Swift files go in `Sources/AnglesiteCore/` / `Tests/AnglesiteCoreTests/` — both are glob-included by `Package.swift`'s existing `AnglesiteCore`/`AnglesiteCoreTests` targets; no `Package.swift` edit needed.
- New Swift test suites use **Swift Testing** (`import Testing`, `@Test`, `#expect`/`#require`), matching every other `AnglesiteCoreTests` file touched by this plan — not XCTest.
- Swift test commands: `swift test --package-path . --filter <SuiteName>` (this environment's `xcode-select` already points at Xcode-beta.app; no `DEVELOPER_DIR` override needed). `--filter` only restricts what *runs*, not what compiles — a full package build still happens per invocation.
- TS test command (from `Resources/Template/`): `npm run test:worker` (equivalently `npx vitest run --config vitest.config.ts <path>` to scope to one file).
- No `Package.swift`, `project.yml`, or `SiteSettings` field changes — this plan reuses `SiteSettings.provisionedWorkerResources.d1DatabaseID` exactly as `ReceivedInteractionSync` already does (Micropub shares the same `{site}-social` D1 database).

---

### Task 1: Worker-side Post Type Discovery module

**Files:**
- Create: `Resources/Template/worker/post-type-discovery.ts`
- Test: `Resources/Template/worker/post-type-discovery.test.ts`

**Interfaces:**
- Consumes: `Mf2Object`, `MicropubCommands` types, exported from `@dwk/micropub` (`packages/micropub/src/mf2.ts` → re-exported by `index.ts`).
- Produces: `discoverCollection(mf2: Mf2Object): string | null` and `generateSlug(mf2: Mf2Object, commands: MicropubCommands): string` — both consumed by Task 2's `worker.ts` change.

- [ ] **Step 1: Write the failing test file**

```typescript
// Resources/Template/worker/post-type-discovery.test.ts
import { describe, expect, test } from "vitest";
import { discoverCollection, generateSlug } from "./post-type-discovery.ts";
import type { Mf2Object, MicropubCommands } from "@dwk/micropub";

function mf2(type: string, properties: Record<string, unknown[]> = {}): Mf2Object {
  return { type: [type], properties };
}

function commands(overrides: Partial<MicropubCommands> = {}): MicropubCommands {
  return { syndicateTo: [], ...overrides };
}

describe("discoverCollection", () => {
  test("h-event maps to events", () => {
    expect(discoverCollection(mf2("h-event", { name: ["Meetup"] }))).toBe("events");
  });

  test("h-review maps to reviews", () => {
    expect(discoverCollection(mf2("h-review", { "item-reviewed": ["A Book"] }))).toBe("reviews");
  });

  test("an unrecognized h-* type returns null", () => {
    expect(discoverCollection(mf2("h-card", { name: ["Jane"] }))).toBeNull();
  });

  test("bookmark-of maps to bookmarks", () => {
    expect(discoverCollection(mf2("h-entry", { "bookmark-of": ["https://example.com"] }))).toBe("bookmarks");
  });

  test("like-of maps to likes", () => {
    expect(discoverCollection(mf2("h-entry", { "like-of": ["https://example.com"] }))).toBe("likes");
  });

  test("in-reply-to maps to replies", () => {
    expect(discoverCollection(mf2("h-entry", { "in-reply-to": ["https://example.com"] }))).toBe("replies");
  });

  test("exactly one photo maps to photos", () => {
    expect(discoverCollection(mf2("h-entry", { photo: ["https://example.com/a.jpg"] }))).toBe("photos");
  });

  test("two or more photos maps to albums", () => {
    expect(discoverCollection(mf2("h-entry", {
      photo: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    }))).toBe("albums");
  });

  test("a name whose content doesn't start with it maps to articles", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["My Big Announcement"],
      content: ["Today I'm launching something new..."],
    }))).toBe("articles");
  });

  test("a name that is just the start of the content (auto-derived) maps to notes", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["Hello world"],
      content: ["Hello world"],
    }))).toBe("notes");
  });

  test("no name at all maps to notes", () => {
    expect(discoverCollection(mf2("h-entry", { content: ["Just a quick note"] }))).toBe("notes");
  });

  test("rich-text content object is read via its plain-text value", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["Title Here"],
      content: [{ html: "<p>Title Here and more</p>", value: "Title Here and more" }],
    }))).toBe("articles");
  });

  test("absent mf2 type ([]) is treated as h-entry", () => {
    expect(discoverCollection({ type: [], properties: { content: ["hi"] } })).toBe("notes");
  });

  test("empty content does not trigger the article check even with a name present", () => {
    expect(discoverCollection(mf2("h-entry", { name: ["Untitled"] }))).toBe("notes");
  });
});

describe("generateSlug", () => {
  test("prefers an explicit mp-slug command", () => {
    const slug = generateSlug(mf2("h-entry", { content: ["hi"] }), commands({ slug: "my-slug" }));
    expect(slug).toBe("my-slug");
  });

  test("falls back to a slugified name", () => {
    const slug = generateSlug(mf2("h-entry", { name: ["Hello, World!"] }), commands());
    expect(slug).toBe("hello-world");
  });

  test("falls back to a random timestamp-based slug when there is no slug or name", () => {
    const slug = generateSlug(mf2("h-entry", { content: ["hi"] }), commands());
    expect(slug).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `Resources/Template/`): `npx vitest run --config vitest.config.ts worker/post-type-discovery.test.ts`
Expected: FAIL — `Cannot find module './post-type-discovery.ts'` (or similar resolution error), since the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// Resources/Template/worker/post-type-discovery.ts
/**
 * IndieWeb Post Type Discovery (https://www.w3.org/TR/post-type-discovery/), extended with a
 * `bookmark-of` check and a count-based photo/album split, mapping an incoming Micropub mf2
 * object to the Astro content collection it should land in once synced to git. See
 * docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §1.
 *
 * `discoverCollection` returns `null` for any type this bridge doesn't support yet (an
 * unrecognized `h-*` type, `repost-of`, `rsvp`, `checkin`, `video`) — the caller must fall back
 * to `@dwk/micropub`'s own default flat-URL policy rather than guessing a collection.
 */

import type { Mf2Object, MicropubCommands } from "@dwk/micropub";

function hasProperty(mf2: Mf2Object, name: string): boolean {
  const values = mf2.properties[name];
  return Array.isArray(values) && values.length > 0;
}

/** Mirrors `worker.ts`'s AP fan-out `extractMf2ContentString` — same mf2 rich-text shape. */
function plainTextContent(mf2: Mf2Object): string {
  const raw = mf2.properties.content?.[0];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { value?: unknown }).value === "string") {
    return (raw as { value: string }).value;
  }
  return "";
}

export function discoverCollection(mf2: Mf2Object): string | null {
  const type = mf2.type[0];
  if (type === "h-event") return "events";
  if (type === "h-review") return "reviews";
  if (type !== undefined && type !== "h-entry") return null;

  if (hasProperty(mf2, "bookmark-of")) return "bookmarks";
  if (hasProperty(mf2, "like-of")) return "likes";
  if (hasProperty(mf2, "in-reply-to")) return "replies";

  const photoCount = mf2.properties.photo?.length ?? 0;
  if (photoCount === 1) return "photos";
  if (photoCount > 1) return "albums";

  const name = mf2.properties.name?.[0];
  if (typeof name === "string" && name.trim().length > 0) {
    const trimmedName = name.trim();
    const content = plainTextContent(mf2).trim();
    if (content.length > 0 && !content.startsWith(trimmedName)) return "articles";
  }
  return "notes";
}

/** Lowercase, dash-separated slug derived from arbitrary text (max 80 chars). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** A short, collision-resistant slug: base36 timestamp plus random suffix. */
function randomSlug(): string {
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${time}-${rand}`;
}

/**
 * Same slug policy as `@dwk/micropub`'s own default `generatePostUrl` (`mp-slug` → a slug
 * derived from `name` → a timestamp-based slug) — reimplemented here (not imported) because
 * the package doesn't export its internal `slugify`/`randomSlug` helpers. Kept identical so a
 * post's slug doesn't change depending on whether its type was recognized (see `worker.ts`'s
 * `generatePostUrl`, which calls this once and uses the same slug for both the type-aware and
 * flat-URL fallback branches).
 */
export function generateSlug(mf2: Mf2Object, commands: MicropubCommands): string {
  const name = mf2.properties.name?.[0];
  return (
    commands.slug ||
    (typeof name === "string" && name.trim() ? slugify(name) : "") ||
    randomSlug()
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts worker/post-type-discovery.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/worker/post-type-discovery.ts Resources/Template/worker/post-type-discovery.test.ts
git commit -m "feat(#912): add Micropub post-type discovery for content sync"
```

---

### Task 2: Wire type-aware `generatePostUrl` into the Micropub Worker composition

**Files:**
- Modify: `Resources/Template/worker/worker.ts:527-540` (the `handleMicropub` function's `createMicropub({...})` call)
- Modify: `Resources/Template/worker/worker.test.ts` (append new Micropub URL-routing tests after the existing Micropub section, around line 657)

**Interfaces:**
- Consumes: `discoverCollection`, `generateSlug` from Task 1 (`./post-type-discovery.ts`).
- Produces: every Micropub `POST /micropub` create response's `Location` header now reads `{baseUrl}/{collection}/{slug}` for a recognized type, or `{baseUrl}/{slug}` (unchanged flat fallback) otherwise — this is the URL shape Task 5 (`MicropubContentSync.collectionAndSlug`) parses.

- [ ] **Step 1: Write the failing tests**

Append to `Resources/Template/worker/worker.test.ts`, immediately after the existing `test("micropub: 503 when MICROPUB_DB isn't bound", ...)` block (around line 657):

```typescript
test("micropub: a note (plain content, no name) is created under /notes/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { content: ["Just a quick note"] },
    }),
  }));
  expect(response.status).toBe(201);
  const location = response.headers.get("location");
  expect(location).toMatch(/^https:\/\/owner\.example\/notes\/[0-9a-z-]+$/);
});

test("micropub: an article (name distinct from content) is created under /articles/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: {
        name: ["My Big Announcement"],
        content: ["Today I'm launching something new..."],
      },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^https:\/\/owner\.example\/articles\/my-big-announcement/);
});

test("micropub: a bookmark (bookmark-of) is created under /bookmarks/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { "bookmark-of": ["https://example.com/article"] },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^https:\/\/owner\.example\/bookmarks\//);
});

test("micropub: an h-event post is created under /events/", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-event"],
      properties: { name: ["Meetup"], start: ["2026-08-01T18:00:00Z"] },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^https:\/\/owner\.example\/events\//);
});

test("micropub: an unrecognized type (h-card) falls back to the flat URL scheme", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-card"],
      properties: { name: ["Jane Doe"] },
    }),
  }));
  expect(response.status).toBe(201);
  const location = response.headers.get("location") ?? "";
  // Flat scheme: exactly one path segment, no collection prefix.
  expect(new URL(location).pathname.split("/").filter(Boolean).length).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts worker/worker.test.ts -t "micropub:"`
Expected: FAIL — the note/article/bookmark/event `Location` assertions fail because every create currently lands at the flat `{baseUrl}/{slug}` URL (no `/notes/`, `/articles/`, etc. prefix).

- [ ] **Step 3: Wire `generatePostUrl` into `handleMicropub`**

In `Resources/Template/worker/worker.ts`, add the import near the top with the other `@dwk/micropub` import (around line 14):

```typescript
import {
  createMicropub,
  type MicropubEnv,
} from "@dwk/micropub";
import { discoverCollection, generateSlug } from "./post-type-discovery.ts";
```

Then change the `createMicropub` call inside `handleMicropub` (around line 536) from:

```typescript
  const micropub = createMicropub({ baseUrl, me: `${baseUrl}/` });
```

to:

```typescript
  const micropub = createMicropub({
    baseUrl,
    me: `${baseUrl}/`,
    // #912: assign a type-aware URL at create time so a synced git file (written under
    // src/content/{collection}/, per MicropubContentSync) renders at the same URL this
    // response's Location header already promised — see post-type-discovery.ts and
    // docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §1.
    generatePostUrl: (post, commands) => {
      const slug = generateSlug(post, commands);
      const collection = discoverCollection(post);
      return collection ? `${baseUrl}/${collection}/${slug}` : `${baseUrl}/${slug}`;
    },
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts worker/worker.test.ts`
Expected: PASS — every existing Micropub/fan-out test in the file still passes (the fan-out reads `location` generically and never asserted its exact shape), plus the 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/worker/worker.ts Resources/Template/worker/worker.test.ts
git commit -m "feat(#912): assign type-aware Micropub post URLs"
```

---

### Task 3: `MicropubPostD1Client` — read `MICROPUB_DB`'s `posts` table

**Files:**
- Create: `Sources/AnglesiteCore/MicropubPostD1Client.swift`
- Test: `Tests/AnglesiteCoreTests/MicropubPostD1ClientTests.swift`

**Interfaces:**
- Consumes: `CloudflareTransport`, `CloudflareError`, `HTTPCloudflareClient.defaultTransport` (`Sources/AnglesiteCore/CloudflareReading.swift`, `HTTPCloudflareClient.swift`); `JSONValue` (`Sources/AnglesiteCore/MCPClient.swift`).
- Produces: `MicropubPostD1Client.Post { url: String, type: String, properties: [String: [JSONValue]], deleted: Bool, updatedAt: Int }` and `MicropubPostD1Client.listAllPosts() async throws -> [Post]` — consumed by Task 5/7's `MicropubContentSync`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/MicropubPostD1ClientTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct MicropubPostD1ClientTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    private static func d1Body(_ rowsJSON: String) -> Data {
        Data("""
        {"success": true, "result": [{"success": true, "results": [\(rowsJSON)]}]}
        """.utf8)
    }

    @Test("lists a live post and decodes its mf2 properties")
    func listsLivePost() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/abc123", "type": "h-entry",
         "properties": "{\\"content\\":[\\"Hello world\\"],\\"published\\":[\\"2026-07-24T12:00:00Z\\"]}",
         "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        let post = try #require(posts.first)
        #expect(post.url == "https://me.example/notes/abc123")
        #expect(post.type == "h-entry")
        #expect(post.deleted == false)
        #expect(post.updatedAt == 1_753_300_000)
        #expect(post.properties["content"] == [.string("Hello world")])
        #expect(post.properties["published"] == [.string("2026-07-24T12:00:00Z")])
    }

    @Test("decodes a nested rich-text content value")
    func decodesRichTextContent() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/articles/hi", "type": "h-entry",
         "properties": "{\\"content\\":[{\\"html\\":\\"<p>Hi</p>\\",\\"value\\":\\"Hi\\"}]}",
         "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        let post = try #require(posts.first)
        let contentValues = try #require(post.properties["content"])
        #expect(contentValues.count == 1)
        guard case .object(let obj) = contentValues[0] else {
            Issue.record("expected content[0] to decode as a JSONValue.object")
            return
        }
        #expect(obj["value"] == .string("Hi"))
    }

    @Test("includes soft-deleted rows so the sync bridge can remove their git snapshot")
    func includesSoftDeletedRows() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/gone", "type": "h-entry",
         "properties": "{\\"content\\":[\\"bye\\"]}", "deleted": 1, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        let post = try #require(posts.first)
        #expect(post.deleted == true)
    }

    @Test("skips a row whose properties column isn't valid JSON")
    func skipsMalformedPropertiesRow() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/bad", "type": "h-entry",
         "properties": "not json", "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        #expect(posts.isEmpty)
    }

    @Test("throws unauthorized on 401")
    func throwsUnauthorizedOn401() async throws {
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "bad-token",
            transport: { _ in (Data(), Self.response(401)) })

        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.listAllPosts()
        }
    }

    @Test("throws http error on a non-2xx, non-auth status")
    func throwsHTTPErrorOnFailureStatus() async throws {
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (Data(), Self.response(500)) })

        await #expect(throws: CloudflareError.http(status: 500)) {
            _ = try await client.listAllPosts()
        }
    }

    @Test("sends the query as a POST to the D1 query endpoint for the given account and database")
    func sendsPostToD1QueryEndpoint() async throws {
        let capturedRequest = ActorBox<URLRequest?>(nil)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { request in
                await capturedRequest.set(request)
                return (Self.d1Body(""), Self.response(200))
            })

        _ = try await client.listAllPosts()
        let request = await capturedRequest.get()
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.absoluteString == "https://api.cloudflare.com/client/v4/accounts/acct1/d1/database/db1/query")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer token")
    }
}

private actor ActorBox<Value: Sendable> {
    private var value: Value
    init(_ value: Value) { self.value = value }
    func set(_ newValue: Value) { value = newValue }
    func get() -> Value { value }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter MicropubPostD1ClientTests`
Expected: FAIL to build — `MicropubPostD1Client` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteCore/MicropubPostD1Client.swift
import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cloudflare D1 HTTP API client for `@dwk/micropub`'s `posts` table (#912). Mirrors
/// `WebmentionInboxD1Client` exactly — same injectable-transport DI, same D1 HTTP query shape —
/// reading the shared `{site}-social` D1 database's Micropub post store instead of the
/// webmention inbox. See docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §2.
public struct MicropubPostD1Client: Sendable {
    /// A stored Micropub post, as read from the `posts` table
    /// (`@dwk/micropub`'s `packages/micropub/src/store.ts`).
    public struct Post: Sendable, Equatable {
        public let url: String
        /// The mf2 root type, e.g. `"h-entry"`.
        public let type: String
        /// The raw mf2 property map — each property name maps to its ordered value list,
        /// matching `@dwk/micropub`'s `Record<string, unknown[]>` storage shape.
        public let properties: [String: [JSONValue]]
        public let deleted: Bool
        public let updatedAt: Int

        public init(url: String, type: String, properties: [String: [JSONValue]], deleted: Bool, updatedAt: Int) {
            self.url = url
            self.type = type
            self.properties = properties
            self.deleted = deleted
            self.updatedAt = updatedAt
        }
    }

    private struct Row: Decodable {
        let url: String
        let type: String
        let properties: String
        let deleted: Int
        let updated_at: Int
    }

    private struct QueryResult: Decodable {
        let results: [Row]?
        let success: Bool
    }

    private struct Envelope: Decodable {
        let success: Bool
        let result: [QueryResult]?
    }

    private struct QueryBody: Encodable {
        let sql: String
    }

    /// Selects every post row — live and soft-deleted alike, newest-updated first. The sync
    /// bridge needs soft-deleted rows too, so it can remove their git snapshot on the next
    /// reconcile (mirrors `ReceivedInteractionSync`'s "pull the full current set" pattern).
    private static let listAllSQL =
        "SELECT url, type, properties, deleted, updated_at FROM posts ORDER BY updated_at DESC"

    private let baseURL: String
    private let accountID: String
    private let databaseID: String
    private let apiToken: String
    private let transport: CloudflareTransport

    public init(
        accountID: String,
        databaseID: String,
        apiToken: String,
        baseURL: String = "https://api.cloudflare.com/client/v4",
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) {
        self.accountID = accountID
        self.databaseID = databaseID
        self.apiToken = apiToken
        self.baseURL = baseURL
        self.transport = transport
    }

    /// Lists every post currently in `MICROPUB_DB`, live and soft-deleted alike. A row whose
    /// `properties` column isn't valid JSON (or isn't a JSON object of arrays) is skipped rather
    /// than failing the whole pull — a single malformed row shouldn't block every other post.
    public func listAllPosts() async throws -> [Post] {
        let url = URL(string: "\(baseURL)/accounts/\(accountID)/d1/database/\(databaseID)/query")
        guard let url else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(QueryBody(sql: Self.listAllSQL))

        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data), envelope.success,
              let rows = envelope.result?.first?.results
        else { throw CloudflareError.malformedResponse }

        return rows.compactMap { row in
            guard let propertiesData = row.properties.data(using: .utf8),
                  let raw = try? JSONSerialization.jsonObject(with: propertiesData) as? [String: [Any]]
            else { return nil }
            var properties: [String: [JSONValue]] = [:]
            for (key, values) in raw {
                properties[key] = values.compactMap(JSONValue.from)
            }
            return Post(
                url: row.url, type: row.type, properties: properties,
                deleted: row.deleted != 0, updatedAt: row.updated_at)
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter MicropubPostD1ClientTests`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/MicropubPostD1Client.swift Tests/AnglesiteCoreTests/MicropubPostD1ClientTests.swift
git commit -m "feat(#912): add MicropubPostD1Client to read MICROPUB_DB"
```

---

### Task 4: `ContentTypeProjections.rawMf2Property(forField:)`

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift` (inside `ContentTypeProjections`, after the `schemaType` property, around line 66)
- Modify: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` (append new test cases)

**Interfaces:**
- Consumes: `ContentTypeProjections.microformatProperties: [String: String]` (already exists).
- Produces: `ContentTypeProjections.rawMf2Property(forField fieldName: String) -> String?` — consumed by Task 5's `MicropubContentSync.values(for:properties:)`.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` (create the file with this content if it doesn't already exist; otherwise add these as new `@Test` functions inside the existing suite type):

```swift
@Test("rawMf2Property strips the mf2 prefix class from a field's microformat mapping")
func rawMf2PropertyStripsPrefix() {
    let article = ContentTypeRegistry.article
    #expect(article.projections.rawMf2Property(forField: "body") == "content")        // e-content
    #expect(article.projections.rawMf2Property(forField: "publishDate") == "published") // dt-published
    #expect(article.projections.rawMf2Property(forField: "tags") == "category")        // p-category
}

@Test("rawMf2Property handles the u- prefix")
func rawMf2PropertyHandlesUPrefix() {
    let bookmark = ContentTypeRegistry.bookmark
    #expect(bookmark.projections.rawMf2Property(forField: "bookmarkOf") == "bookmark-of") // u-bookmark-of
}

@Test("rawMf2Property returns nil for a field with no mf2 mapping")
func rawMf2PropertyNilForUnmappedField() {
    let article = ContentTypeRegistry.article
    #expect(article.projections.rawMf2Property(forField: "draft") == nil)
    #expect(article.projections.rawMf2Property(forField: "nonexistent") == nil)
}
```

*(If the test file doesn't exist yet, wrap these three in `import Testing`, `@testable import AnglesiteCore`, and `struct ContentTypeRegistryTests { ... }`.)*

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: FAIL to build — `rawMf2Property(forField:)` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, add to `ContentTypeProjections` (immediately after the `public init(...)` block that follows `schemaType`, i.e. right after line 77's closing brace):

```swift
    /// The raw mf2 property name `@dwk/micropub` stores for `fieldName` — `microformatProperties`
    /// with its mf2 prefix class (`p-`/`e-`/`u-`/`dt-`) stripped. `nil` if `fieldName` has no mf2
    /// mapping (e.g. `draft`, which is derived from the Post Status extension's `post-status`
    /// property rather than its own mf2 property). Used by the Micropub content-sync bridge
    /// (#912) to read a post's raw property map — bare names, no prefix — for a given
    /// `ContentTypeField`.
    public func rawMf2Property(forField fieldName: String) -> String? {
        microformatProperties[fieldName].map(Self.stripMf2Prefix)
    }

    private static func stripMf2Prefix(_ mfProperty: String) -> String {
        for prefix in ["p-", "e-", "u-", "dt-"] where mfProperty.hasPrefix(prefix) {
            return String(mfProperty.dropFirst(prefix.count))
        }
        return mfProperty
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
git commit -m "feat(#912): add reverse mf2-property lookup to ContentTypeProjections"
```

---

### Task 5: `MicropubContentSync` core — URL parsing + mf2-to-field mapping

**Files:**
- Create: `Sources/AnglesiteCore/MicropubContentSync.swift`
- Test: `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift`

**Interfaces:**
- Consumes: `MicropubPostD1Client.Post` (Task 3), `ContentTypeProjections.rawMf2Property(forField:)` (Task 4), `ContentTypeRegistry.descriptor(forCollection:)`/`.default` (existing), `TypedContentEditor.Values`/`FieldValue`/`defaultValue(for:)` (existing), `JSONValue` (existing).
- Produces: `MicropubContentSync.ResolvedPost { url, collection, descriptor, values, updatedAt }`, `MicropubContentSync.resolve(post:registry:) -> ResolvedPost?`, and the internal helpers `collectionAndSlug(from:)` / `plainText(from:)` — all consumed by Task 6 (`MicropubContentCommitter`) and Task 7 (this file's own `pullAndCommit`).

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct MicropubContentSyncTests {
    // MARK: - collectionAndSlug

    @Test("collectionAndSlug parses a two-segment collection URL")
    func collectionAndSlugParsesTwoSegments() {
        let result = MicropubContentSync.collectionAndSlug(from: "https://me.example/notes/hello-abc123")
        #expect(result?.collection == "notes")
        #expect(result?.slug == "hello-abc123")
    }

    @Test("collectionAndSlug returns nil for the flat one-segment fallback URL")
    func collectionAndSlugNilForFlatURL() {
        #expect(MicropubContentSync.collectionAndSlug(from: "https://me.example/hello-abc123") == nil)
    }

    @Test("collectionAndSlug returns nil for a malformed URL")
    func collectionAndSlugNilForMalformedURL() {
        #expect(MicropubContentSync.collectionAndSlug(from: "not a url") == nil)
    }

    // MARK: - plainText

    @Test("plainText reads a bare string value")
    func plainTextReadsBareString() {
        #expect(MicropubContentSync.plainText(from: .string("hello")) == "hello")
    }

    @Test("plainText reads a rich-text object's value key")
    func plainTextReadsRichTextValue() {
        let value = JSONValue.object(["html": .string("<p>hi</p>"), "value": .string("hi")])
        #expect(MicropubContentSync.plainText(from: value) == "hi")
    }

    @Test("plainText returns nil for an unsupported shape")
    func plainTextNilForUnsupportedShape() {
        #expect(MicropubContentSync.plainText(from: .bool(true)) == nil)
        #expect(MicropubContentSync.plainText(from: nil) == nil)
    }

    // MARK: - values(for:properties:)

    @Test("values builds a note's fields from raw mf2 properties")
    func valuesBuildsNoteFields() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello world")],
            "published": [.string("2026-07-24T12:00:00Z")],
            "category": [.string("indieweb"), .string("test")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["body"] == .text("Hello world"))
        #expect(values["tags"] == .list(["indieweb", "test"]))
        guard case .date(let date) = values["publishDate"] else {
            Issue.record("expected publishDate to decode as a date")
            return
        }
        #expect(date?.timeIntervalSince1970 == 1_784_894_400)
    }

    @Test("values derives draft from the post-status extension property, not a raw field")
    func valuesDerivesDraftFromPostStatus() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello")],
            "published": [.string("2026-07-24T12:00:00Z")],
            "post-status": [.string("draft")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["draft"] == .flag(true))
    }

    @Test("values defaults draft to false when post-status is absent (published)")
    func valuesDefaultsDraftToFalse() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello")],
            "published": [.string("2026-07-24T12:00:00Z")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["draft"] == .flag(false))
    }

    @Test("values returns nil when a required field has no matching mf2 property")
    func valuesNilWhenRequiredFieldMissing() {
        let note = ContentTypeRegistry.note
        // "body" (e-content, required) is missing.
        let properties: [String: [JSONValue]] = ["published": [.string("2026-07-24T12:00:00Z")]]
        #expect(MicropubContentSync.values(for: note, properties: properties) == nil)
    }

    @Test("values requires all photo values to resolve album's imageArray, or fails")
    func valuesRequiresAlbumImages() {
        let album = ContentTypeRegistry.album
        let properties: [String: [JSONValue]] = [
            "name": [.string("Trip")],
            "published": [.string("2026-07-24T12:00:00Z")],
        ]
        // "images" (u-photo, required imageArray) has no matching values at all.
        #expect(MicropubContentSync.values(for: album, properties: properties) == nil)
    }

    // MARK: - resolve

    @Test("resolve maps a post to its descriptor via the URL's collection segment")
    func resolveMapsPostToDescriptor() throws {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/notes/hello-abc123", type: "h-entry",
            properties: ["content": [.string("Hello")], "published": [.string("2026-07-24T12:00:00Z")]],
            deleted: false, updatedAt: 1_753_300_000)
        let resolved = try #require(MicropubContentSync.resolve(post: post))
        #expect(resolved.collection == "notes")
        #expect(resolved.descriptor.id == "note")
        #expect(resolved.url == post.url)
        #expect(resolved.updatedAt == 1_753_300_000)
    }

    @Test("resolve returns nil for the flat fallback URL (no collection segment)")
    func resolveNilForFlatURL() {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/hello-abc123", type: "h-card",
            properties: ["name": [.string("Jane")]], deleted: false, updatedAt: 1_753_300_000)
        #expect(MicropubContentSync.resolve(post: post) == nil)
    }

    @Test("resolve returns nil when the URL's collection has no registered content type")
    func resolveNilForUnknownCollection() {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/mystery/abc123", type: "h-entry",
            properties: ["content": [.string("hi")]], deleted: false, updatedAt: 1_753_300_000)
        #expect(MicropubContentSync.resolve(post: post) == nil)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter MicropubContentSyncTests`
Expected: FAIL to build — `MicropubContentSync` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteCore/MicropubContentSync.swift
import Foundation

/// Orchestrates #912's "pull Micropub-created posts from D1 and turn each into a typed content
/// file" step. This file holds the pure URL-parsing and mf2-to-field mapping logic; `pullAndCommit`
/// / `pullAndCommitIfConfigured` (Task 7) extend this enum with the D1-query + commit glue.
/// See docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md.
public enum MicropubContentSync {
    /// One post resolved to its content type, ready for `MicropubContentCommitter`.
    public struct ResolvedPost: Sendable, Equatable {
        public let url: String
        public let collection: String
        public let descriptor: ContentTypeDescriptor
        public let values: TypedContentEditor.Values
        public let updatedAt: Int
    }

    /// Parses `{baseUrl}/{collection}/{slug}` — the shape `post-type-discovery.ts`'s
    /// `generatePostUrl` assigns at create time for a recognized mf2 type — into its collection
    /// and slug. Returns `nil` for any other shape: the flat `{baseUrl}/{slug}` fallback URL a
    /// post gets when its mf2 type wasn't recognized at create time, or a malformed URL. This
    /// bridge only ever reads the collection out of the URL — it never re-derives it from mf2
    /// properties, so classification happens exactly once (Worker-side, at create time).
    static func collectionAndSlug(from urlString: String) -> (collection: String, slug: String)? {
        guard let url = URL(string: urlString) else { return nil }
        let segments = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard segments.count == 2 else { return nil }
        return (segments[0], segments[1])
    }

    /// Extracts a plain-text string from one mf2 property value: a bare string, or a rich-text
    /// object's `value` key (mirrors `worker.ts`'s AP fan-out `extractMf2ContentString` — same
    /// mf2 shape, same fallback). `nil` for any other shape.
    static func plainText(from value: JSONValue?) -> String? {
        switch value {
        case .string(let s): return s
        case .object(let o):
            if case .string(let s)? = o["value"] { return s }
            return nil
        default: return nil
        }
    }

    private static let isoWithFractionalSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func parseDate(_ raw: String) -> Date? {
        if let d = isoWithFractionalSeconds.date(from: raw) { return d }
        if let d = ISO8601DateFormatter().date(from: raw) { return d }
        let df = DateFormatter()
        df.calendar = Calendar(identifier: .iso8601)
        df.timeZone = TimeZone(identifier: "UTC")
        df.dateFormat = "yyyy-MM-dd"
        return df.date(from: raw)
    }

    /// Builds one `ContentTypeField`'s value from a post's raw mf2 properties. Returns `nil` only
    /// when `field.required` and no usable value exists — the caller (`values(for:properties:)`)
    /// treats that as "skip the whole post."
    static func fieldValue(
        for field: ContentTypeField,
        rawProperty: String,
        properties: [String: [JSONValue]]
    ) -> TypedContentEditor.FieldValue? {
        let values = properties[rawProperty] ?? []
        switch field.kind {
        case .string, .text, .url, .image, .markdown:
            guard let text = values.first.flatMap(plainText) else {
                return field.required ? nil : .text("")
            }
            return .text(text)
        // No field in the built-in registry maps a raw mf2 property to `.bool` today (`draft` is
        // special-cased in `values(for:)` below, driven by `post-status` instead) — this arm
        // exists only for switch exhaustiveness / defense-in-depth against a future bool field.
        case .bool:
            return .flag(false)
        case .date, .datetime:
            guard let text = values.first.flatMap(plainText), let date = parseDate(text) else {
                return field.required ? nil : .date(nil)
            }
            return .date(date)
        case .number:
            guard let text = values.first.flatMap(plainText), let number = Double(text) else {
                return field.required ? nil : .number(nil)
            }
            return .number(number)
        case .stringArray:
            return .list(values.compactMap(plainText))
        case .imageArray:
            let strings = values.compactMap(plainText)
            return (field.required && strings.isEmpty) ? nil : .list(strings)
        }
    }

    /// Builds every field value for `descriptor` from a post's raw mf2 properties. Returns `nil`
    /// (skip the whole post) when a required field can't be resolved — a malformed/partial post
    /// shouldn't produce invalid frontmatter.
    static func values(
        for descriptor: ContentTypeDescriptor,
        properties: [String: [JSONValue]]
    ) -> TypedContentEditor.Values? {
        var out = TypedContentEditor.Values()
        for field in descriptor.fields {
            // `draft` has no mf2 property of its own — it's derived from the Post Status
            // extension's `post-status` property (`@dwk/micropub` validates this is either
            // "draft" or "published"/absent before storing it).
            if field.name == "draft" {
                let status = properties["post-status"]?.first.flatMap(plainText)
                out["draft"] = .flag(status == "draft")
                continue
            }
            guard let rawProperty = descriptor.projections.rawMf2Property(forField: field.name) else {
                if field.required { return nil }
                out[field.name] = TypedContentEditor.defaultValue(for: field.kind)
                continue
            }
            guard let value = fieldValue(for: field, rawProperty: rawProperty, properties: properties) else {
                return nil
            }
            out[field.name] = value
        }
        return out
    }

    /// Resolves one D1 row to a `ResolvedPost`, or `nil` (skip — the caller logs this) when its
    /// URL's collection isn't one this bridge maps to a registered content type, or a required
    /// field can't be resolved from its mf2 properties.
    static func resolve(
        post: MicropubPostD1Client.Post,
        registry: ContentTypeRegistry = .default
    ) -> ResolvedPost? {
        guard let (collection, _) = collectionAndSlug(from: post.url),
              let descriptor = registry.descriptor(forCollection: collection),
              let values = values(for: descriptor, properties: post.properties)
        else { return nil }
        return ResolvedPost(
            url: post.url, collection: collection, descriptor: descriptor,
            values: values, updatedAt: post.updatedAt)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter MicropubContentSyncTests`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/MicropubContentSync.swift Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift
git commit -m "feat(#912): map Micropub mf2 properties to typed content fields"
```

---

### Task 6: `MicropubContentCommitter` — reconcile + commit with slug-collision state

**Files:**
- Create: `Sources/AnglesiteCore/MicropubContentCommitter.swift`
- Test: `Tests/AnglesiteCoreTests/MicropubContentCommitterTests.swift`

**Interfaces:**
- Consumes: `MicropubContentSync.ResolvedPost` / `collectionAndSlug(from:)` (Task 5); `ContentScaffold.renderEntry(descriptor:title:now:)`, `ContentScaffold.postRelativePath(collection:slug:)` (existing); `TypedContentEditor.write(_:into:descriptor:)` (existing); `InboxSubmissionCommitter.processGitCommitBatch` (existing).
- Produces: `MicropubContentCommitter.commit(posts:into:configDirectory:fileManager:now:gitCommitBatch:) async -> Int` — consumed by Task 7's `MicropubContentSync.pullAndCommit`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/MicropubContentCommitterTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as ReceivedInteractionCommitterTests: real `git` subprocesses
// via raw `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct MicropubContentCommitterTests {
    private static func post(
        url: String, collection: String = "notes", body: String = "Hello world",
        updatedAt: Int = 1_753_300_000
    ) -> MicropubContentSync.ResolvedPost {
        let descriptor = ContentTypeRegistry.default.descriptor(forCollection: collection)!
        var values = TypedContentEditor.Values()
        values["body"] = .text(body)
        values["publishDate"] = .date(Date(timeIntervalSince1970: 1_753_358_400))
        values["tags"] = .list([])
        values["draft"] = .flag(false)
        return MicropubContentSync.ResolvedPost(
            url: url, collection: collection, descriptor: descriptor, values: values, updatedAt: updatedAt)
    }

    @Test("commit writes a new post to src/content/<collection>/<slug>.md and records it in micropubSync.json")
    func commitWritesNewPost() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let count = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123")],
            into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)

        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")
        #expect(FileManager.default.fileExists(atPath: written.path))
        let contents = try String(contentsOf: written, encoding: .utf8)
        #expect(contents.contains("Hello world"))

        let stateURL = configDirectory.appendingPathComponent("micropubSync.json")
        let stateData = try Data(contentsOf: stateURL)
        let state = try JSONDecoder().decode([String: String].self, from: stateData)
        #expect(state["https://me.example/notes/hello-abc123"] == "src/content/notes/hello-abc123.md")
    }

    @Test("a second sync of the same post updates the same file without re-suffixing")
    func secondSyncUpdatesInPlace() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123", body: "First version")],
            into: siteDirectory, configDirectory: configDirectory)

        let count = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123", body: "Edited version")],
            into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)

        // Still exactly the original path — no "-2" suffix from a spurious collision.
        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")
        let contents = try String(contentsOf: written, encoding: .utf8)
        #expect(contents.contains("Edited version"))
        #expect(!FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123-2.md").path))
    }

    @Test("a slug colliding with an existing hand-authored file is suffixed, never overwritten")
    func collisionWithHandAuthoredFileIsSuffixed() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let notesDir = siteDirectory.appendingPathComponent("src/content/notes", isDirectory: true)
        try FileManager.default.createDirectory(at: notesDir, withIntermediateDirectories: true)
        try "---\nbody: \"hand-authored\"\n---\n".write(
            to: notesDir.appendingPathComponent("hello-abc123.md"), atomically: true, encoding: .utf8)

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123", body: "From Micropub")],
            into: siteDirectory, configDirectory: configDirectory)

        let original = try String(contentsOf: notesDir.appendingPathComponent("hello-abc123.md"), encoding: .utf8)
        #expect(original.contains("hand-authored"))
        let suffixed = try String(contentsOf: notesDir.appendingPathComponent("hello-abc123-2.md"), encoding: .utf8)
        #expect(suffixed.contains("From Micropub"))
    }

    @Test("commit deletes the file and state entry for a post no longer in the resolved set")
    func commitDeletesStalePost() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123")],
            into: siteDirectory, configDirectory: configDirectory)
        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")
        #expect(FileManager.default.fileExists(atPath: written.path))

        // The post is now absent from the resolved set (soft-deleted in D1, or fell out of scope).
        let count = await MicropubContentCommitter.commit(
            posts: [], into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)
        #expect(!FileManager.default.fileExists(atPath: written.path))

        let stateData = try Data(contentsOf: configDirectory.appendingPathComponent("micropubSync.json"))
        let state = try JSONDecoder().decode([String: String].self, from: stateData)
        #expect(state.isEmpty)
    }

    @Test("commit is a no-op when nothing changed")
    func commitNoOpWhenNothingChanged() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let posts = [Self.post(url: "https://me.example/notes/hello-abc123")]
        _ = await MicropubContentCommitter.commit(posts: posts, into: siteDirectory, configDirectory: configDirectory)

        let callCount = CallCounter()
        let count = await MicropubContentCommitter.commit(
            posts: posts, into: siteDirectory, configDirectory: configDirectory,
            gitCommitBatch: { _, _, _ in
                await callCount.increment()
                return "should-not-be-called"
            })
        #expect(count == 0)
        #expect(await callCount.value == 0)
    }

    @Test("a git-commit failure still records state, so a retry doesn't duplicate the file with a suffixed slug")
    func gitFailureStillRecordsStateToAvoidDuplication() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let posts = [Self.post(url: "https://me.example/notes/hello-abc123")]
        let firstCount = await MicropubContentCommitter.commit(
            posts: posts, into: siteDirectory, configDirectory: configDirectory,
            gitCommitBatch: { _, _, _ in nil })
        #expect(firstCount == 0)

        // The file is on disk (uncommitted) and state.json already points at it — a retry must
        // reuse that exact path rather than treating the leftover file as a foreign collision.
        let retryCount = await MicropubContentCommitter.commit(posts: posts, into: siteDirectory, configDirectory: configDirectory)
        #expect(retryCount == 0) // content unchanged since the failed attempt — nothing to (re-)commit
        #expect(!FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123-2.md").path))
    }

    @Test("commitMessage describes write-only, delete-only, and mixed reconciles")
    func commitMessageVariants() {
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 1, deletedCount: 0) == "micropub: sync 1 post")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 2, deletedCount: 0) == "micropub: sync 2 posts")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 0, deletedCount: 1) == "micropub: remove 1 post")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 0, deletedCount: 2) == "micropub: remove 2 posts")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 1, deletedCount: 1) == "micropub: sync 1 post, remove 1")
    }

    /// A throwaway `.anglesite`-style package: `Source/` (a git repo) beside `Config/`.
    private static func makeThrowawaySite() throws -> (siteDirectory: URL, configDirectory: URL) {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("micropub-commit-test-\(UUID().uuidString)", isDirectory: true)
        let siteDirectory = root.appendingPathComponent("Source", isDirectory: true)
        let configDirectory = root.appendingPathComponent("Config", isDirectory: true)
        try fm.createDirectory(at: siteDirectory, withIntermediateDirectories: true)
        try fm.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        try "placeholder\n".write(to: siteDirectory.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = siteDirectory
            p.environment = ProcessInfo.processInfo.environment.merging([
                "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@anglesite.test",
                "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@anglesite.test",
            ]) { _, new in new }
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else {
                struct GitFailed: Error {}
                throw GitFailed()
            }
        }
        try git(["init", "-q"])
        try git(["config", "user.email", "test@anglesite.test"])
        try git(["config", "user.name", "test"])
        try git(["add", "-A"])
        try git(["commit", "-q", "-m", "initial"])
        return (siteDirectory, configDirectory)
    }
}

private actor CallCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter MicropubContentCommitterTests`
Expected: FAIL to build — `MicropubContentCommitter` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteCore/MicropubContentCommitter.swift
import Foundation

/// Writes Micropub posts resolved by `MicropubContentSync` into the site's local git working
/// copy as typed content files (`src/content/<collection>/<slug>.md`), then commits them in one
/// commit. This is the "commit resolved posts into git" half of #912 — mirrors
/// `ReceivedInteractionCommitter`'s full-set reconciliation, but per-collection and slug-aware:
/// its id-keyed `data/interactions/` has no collision risk, while `src/content/<collection>/` is
/// a directory humans hand-edit too. See
/// docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §4.
public enum MicropubContentCommitter {
    /// `Config/micropubSync.json`'s persisted shape: Micropub post URL → the `Source/`-relative
    /// path it was written to. A flat `[String: String]` (not a wrapper struct with a
    /// `pathsByURL` field) so the file on disk is exactly `{"<url>": "<relPath>", ...}` — simpler
    /// to inspect/decode directly (including from tests) than a nested shape would be. Read/
    /// written outside the git commit (it lives in `Config/`, never `Source/`) so a later
    /// re-sync of the same post updates that exact file instead of re-resolving (and potentially
    /// re-suffixing) its slug every time.
    typealias SyncState = [String: String]

    private static let stateFileName = "micropubSync.json"

    private static func loadState(from configDirectory: URL) -> SyncState {
        let url = configDirectory.appendingPathComponent(stateFileName)
        guard let data = try? Data(contentsOf: url),
              let state = try? JSONDecoder().decode(SyncState.self, from: data)
        else { return [:] }
        return state
    }

    private static func saveState(_ state: SyncState, to configDirectory: URL, fileManager: FileManager) {
        let url = configDirectory.appendingPathComponent(stateFileName)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(state) else { return }
        try? fileManager.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    /// Resolves the relative path a post should be written to: the path already recorded in
    /// `state` for its URL, or (first sync) a freshly slugified path — suffixed (`-2`, `-3`, …)
    /// until it names either a nonexistent file or one already owned by this committer (i.e.
    /// present in `state`'s values), so a Micropub-created file never silently overwrites a
    /// hand-authored one sharing the same slug.
    static func resolvePath(
        for post: MicropubContentSync.ResolvedPost,
        state: SyncState,
        siteDirectory: URL,
        fileManager: FileManager
    ) -> String {
        if let existing = state[post.url] { return existing }

        let baseSlug = MicropubContentSync.collectionAndSlug(from: post.url)?.slug ?? post.url
        let ownedPaths = Set(state.values)
        var candidateSlug = baseSlug
        var attempt = 1
        while true {
            let relPath = ContentScaffold.postRelativePath(collection: post.collection, slug: candidateSlug)
            let fileURL = siteDirectory.appendingPathComponent(relPath)
            if ownedPaths.contains(relPath) || !fileManager.fileExists(atPath: fileURL.path) {
                return relPath
            }
            attempt += 1
            candidateSlug = "\(baseSlug)-\(attempt)"
        }
    }

    /// Reconciles `src/content/<collection>/` directories under `siteDirectory` against `posts`
    /// (the full, current, resolved set) and commits the result in one commit:
    /// - a new or changed post is written (or overwritten) at its resolved path
    /// - a previously-synced post (per `Config/micropubSync.json`) absent from `posts` has its
    ///   file deleted and its state entry removed
    /// - unchanged files are left untouched, so a sync with nothing new is a true no-op
    ///
    /// `micropubSync.json` is saved regardless of whether the git commit itself succeeds: the
    /// physical file write already happened, so a later retry must see that path as already
    /// resolved rather than re-deriving (and potentially re-suffixing) a fresh slug for the same
    /// post — only the *count this call reports* (and thus whether a caller treats it as "synced
    /// this round") depends on the commit having actually landed.
    @discardableResult
    public static func commit(
        posts: [MicropubContentSync.ResolvedPost],
        into siteDirectory: URL,
        configDirectory: URL,
        fileManager: FileManager = .default,
        now: @Sendable () -> Date = Date.init,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = InboxSubmissionCommitter.processGitCommitBatch
    ) async -> Int {
        var state = loadState(from: configDirectory)
        let currentURLs = Set(posts.map(\.url))

        var relPaths: [String] = []
        var writtenCount = 0
        var deletedCount = 0

        // Delete files for URLs no longer in the current resolved set before writing, so a slug
        // freed by a deletion is immediately available to a same-round collision resolution.
        for (url, relPath) in state where !currentURLs.contains(url) {
            let fileURL = siteDirectory.appendingPathComponent(relPath)
            guard (try? fileManager.removeItem(at: fileURL)) != nil else { continue }
            relPaths.append(relPath)
            deletedCount += 1
            state.removeValue(forKey: url)
        }

        for post in posts {
            let relPath = resolvePath(for: post, state: state, siteDirectory: siteDirectory, fileManager: fileManager)
            let fileURL = siteDirectory.appendingPathComponent(relPath)
            let existingContents = try? String(contentsOf: fileURL, encoding: .utf8)
            let baseContents = existingContents
                ?? ContentScaffold.renderEntry(descriptor: post.descriptor, title: nil, now: now())
            let newContents = TypedContentEditor.write(post.values, into: baseContents, descriptor: post.descriptor)
            state[post.url] = relPath
            guard newContents != existingContents else { continue }
            try? fileManager.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            guard (try? newContents.data(using: .utf8)?.write(to: fileURL, options: .atomic)) != nil else { continue }
            relPaths.append(relPath)
            writtenCount += 1
        }

        guard !relPaths.isEmpty else {
            saveState(state, to: configDirectory, fileManager: fileManager)
            return 0
        }

        let message = Self.commitMessage(writtenCount: writtenCount, deletedCount: deletedCount)
        let committed = await gitCommitBatch(siteDirectory, relPaths, message) != nil
        saveState(state, to: configDirectory, fileManager: fileManager)
        return committed ? writtenCount + deletedCount : 0
    }

    static func commitMessage(writtenCount: Int, deletedCount: Int) -> String {
        switch (writtenCount, deletedCount) {
        case (let w, 0):
            return w == 1 ? "micropub: sync 1 post" : "micropub: sync \(w) posts"
        case (0, let d):
            return d == 1 ? "micropub: remove 1 post" : "micropub: remove \(d) posts"
        case (let w, let d):
            return "micropub: sync \(w) post\(w == 1 ? "" : "s"), remove \(d)"
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter MicropubContentCommitterTests`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/MicropubContentCommitter.swift Tests/AnglesiteCoreTests/MicropubContentCommitterTests.swift
git commit -m "feat(#912): add MicropubContentCommitter with collision-safe sync state"
```

---

### Task 7: `MicropubContentSync.pullAndCommit` / `pullAndCommitIfConfigured`

**Files:**
- Modify: `Sources/AnglesiteCore/MicropubContentSync.swift` (append to the existing `enum MicropubContentSync`)
- Modify: `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift` (append new test cases)

**Interfaces:**
- Consumes: `MicropubPostD1Client` (Task 3), `MicropubContentCommitter.commit` (Task 6), `SiteConfigStore.read(from:)`, `SecretStore.readCloudflareToken()`, `PlatformSecretStore.make()`, `HTTPCloudflareClient.defaultTransport` (existing).
- Produces: `MicropubContentSync.pullAndCommit(client:siteDirectory:configDirectory:) async -> Int` and `MicropubContentSync.pullAndCommitIfConfigured(siteDirectory:configDirectory:secretStore:baseURL:transport:) async -> Int` — consumed by Task 8's `PreviewModel.open(site:)`.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift`:

```swift
// MARK: - pullAndCommit / pullAndCommitIfConfigured
// Serialized for the same reason as ReceivedInteractionSyncTests: real `git` subprocesses trip a
// rare CI heap-corruption crash when run concurrently with the rest of the subprocess-heavy suite.
extension MicropubContentSyncTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    private static func d1Body(_ rowsJSON: String) -> Data {
        Data("""
        {"success": true, "result": [{"success": true, "results": [\(rowsJSON)]}]}
        """.utf8)
    }

    @Test("pullAndCommit resolves and commits every recognized live post")
    func pullAndCommitResolvesAndCommits() async throws {
        let (siteDirectory, _) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }
        let configDirectory = siteDirectory.deletingLastPathComponent().appendingPathComponent("Config")

        let body = Self.d1Body("""
        {"url": "https://me.example/notes/hello-abc123", "type": "h-entry",
         "properties": "{\\"content\\":[\\"Hello\\"],\\"published\\":[\\"2026-07-24T12:00:00Z\\"]}",
         "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (body, Self.response(200)) })

        let count = await MicropubContentSync.pullAndCommit(
            client: client, siteDirectory: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)
        #expect(FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md").path))
    }

    @Test("pullAndCommit returns 0 without touching git when the D1 query fails")
    func pullAndCommitD1FailureIsNoOp() async {
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (Data(), Self.response(500)) })
        let count = await MicropubContentSync.pullAndCommit(
            client: client, siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: URL(fileURLWithPath: "/nonexistent"))
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured no-ops when the site has no provisioned D1 database")
    func noOpsWithoutD1Database() async {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("micropub-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }

        let count = await MicropubContentSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "unused"),
            transport: { _ in
                Issue.record("transport must not be called with no provisioned D1 database")
                struct UnexpectedNetworkCall: Error {}
                throw UnexpectedNetworkCall()
            })
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured resolves the account id, queries D1, and commits")
    func resolvesAccountAndCommits() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("micropub-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(d1DatabaseID: "db1")))

        let (siteDirectory, _) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let accountsBody = Data("""
        {"success": true, "result": [{"id": "acct1"}]}
        """.utf8)
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/hello-abc123", "type": "h-entry",
         "properties": "{\\"content\\":[\\"Hello\\"],\\"published\\":[\\"2026-07-24T12:00:00Z\\"]}",
         "deleted": 0, "updated_at": 1753300000}
        """)

        let count = await MicropubContentSync.pullAndCommitIfConfigured(
            siteDirectory: siteDirectory,
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "token"),
            transport: { request in
                if request.url!.path.hasSuffix("/accounts") { return (accountsBody, Self.response(200)) }
                if request.url!.path.contains("/d1/database/db1/query") { return (body, Self.response(200)) }
                return (Data(), Self.response(404))
            })
        #expect(count == 1)
        #expect(FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md").path))
    }

    /// A throwaway `.anglesite`-style package: `Source/` (a git repo) beside `Config/`. Mirrors
    /// `MicropubContentCommitterTests.makeThrowawaySite`.
    private static func makeThrowawaySite() throws -> (siteDirectory: URL, configDirectory: URL) {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("micropub-sync-test-\(UUID().uuidString)", isDirectory: true)
        let siteDirectory = root.appendingPathComponent("Source", isDirectory: true)
        let configDirectory = root.appendingPathComponent("Config", isDirectory: true)
        try fm.createDirectory(at: siteDirectory, withIntermediateDirectories: true)
        try fm.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        try "placeholder\n".write(to: siteDirectory.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = siteDirectory
            p.environment = ProcessInfo.processInfo.environment.merging([
                "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@anglesite.test",
                "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@anglesite.test",
            ]) { _, new in new }
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else {
                struct GitFailed: Error {}
                throw GitFailed()
            }
        }
        try git(["init", "-q"])
        try git(["config", "user.email", "test@anglesite.test"])
        try git(["config", "user.name", "test"])
        try git(["add", "-A"])
        try git(["commit", "-q", "-m", "initial"])
        return (siteDirectory, configDirectory)
    }
}

private struct FakeSecretStore: SecretStore {
    let token: String?
    func read(account: String) throws -> String? { account == SecretAccounts.cloudflareToken ? token : nil }
    func write(_ value: String, account: String) throws {}
    func delete(account: String) throws {}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter MicropubContentSyncTests`
Expected: FAIL to build — `pullAndCommit`/`pullAndCommitIfConfigured` don't exist yet.

- [ ] **Step 3: Write the implementation**

Append to `Sources/AnglesiteCore/MicropubContentSync.swift`, inside the existing `public enum MicropubContentSync { ... }` (after `resolve`, before the closing `}`):

```swift
    /// Queries `client` for every current post (live and soft-deleted), resolves each to its
    /// content type, and reconciles the result into `siteDirectory` via
    /// `MicropubContentCommitter`. Returns 0 (never throws) if the D1 query failed. Soft-deleted
    /// and unresolvable posts are simply absent from the resolved set passed to the committer — a
    /// previously-synced post whose row later became unresolvable (soft-deleted, or an edit that
    /// broke a required field) is removed from git the same way a truly-deleted post is.
    public static func pullAndCommit(
        client: MicropubPostD1Client, siteDirectory: URL, configDirectory: URL
    ) async -> Int {
        guard let posts = try? await client.listAllPosts() else { return 0 }
        let resolved = posts.filter { !$0.deleted }.compactMap { resolve(post: $0) }
        return await MicropubContentCommitter.commit(
            posts: resolved, into: siteDirectory, configDirectory: configDirectory)
    }

    /// Reads the site's `SiteSettings` and the Cloudflare API token from `secretStore`; no-ops
    /// (returns 0, no network call) unless a D1 database has been provisioned — same gate
    /// `ReceivedInteractionSync` uses, since Micropub shares the same D1 database.
    /// `configDirectory` is the package's `Config/` directory (`AnglesitePackage.configURL`), a
    /// sibling of `siteDirectory` (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        secretStore: any SecretStore = PlatformSecretStore.make(),
        baseURL: String = "https://api.cloudflare.com/client/v4",
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let databaseID = settings.provisionedWorkerResources?.d1DatabaseID, !databaseID.isEmpty,
              let token = try? secretStore.readCloudflareToken(), !token.isEmpty
        else { return 0 }
        guard let accountID = await Self.resolveAccountID(apiToken: token, baseURL: baseURL, transport: transport)
        else { return 0 }

        let client = MicropubPostD1Client(
            accountID: accountID, databaseID: databaseID, apiToken: token, baseURL: baseURL, transport: transport)
        return await pullAndCommit(client: client, siteDirectory: siteDirectory, configDirectory: configDirectory)
    }

    private struct CFAccount: Decodable, Sendable { let id: String }
    private struct CFEnvelope: Decodable, Sendable { let success: Bool; let result: [CFAccount]? }

    /// Resolves the token's first visible Cloudflare account id — same resolution
    /// `ReceivedInteractionSync` uses, since a personal Anglesite deployment has exactly one
    /// Cloudflare account per token.
    private static func resolveAccountID(apiToken: String, baseURL: String, transport: CloudflareTransport) async -> String? {
        guard let url = URL(string: "\(baseURL)/accounts?per_page=1") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        guard let (data, http) = try? await transport(request), (200..<300).contains(http.statusCode),
              let envelope = try? JSONDecoder().decode(CFEnvelope.self, from: data), envelope.success
        else { return nil }
        return envelope.result?.first?.id
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter MicropubContentSyncTests`
Expected: PASS (17 tests total: 13 from Task 5 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/MicropubContentSync.swift Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift
git commit -m "feat(#912): wire MicropubContentSync to MICROPUB_DB and the committer"
```

---

### Task 8: Wire into `PreviewModel.open(site:)`

**Files:**
- Modify: `Sources/AnglesiteApp/PreviewModel.swift:187-206` (the `Task { ... }` block inside `open(site:)`)

**Interfaces:**
- Consumes: `MicropubContentSync.pullAndCommitIfConfigured(siteDirectory:configDirectory:)` (Task 7).
- Produces: nothing new consumed elsewhere — this is the final integration point.

- [ ] **Step 1: Make the change**

In `Sources/AnglesiteApp/PreviewModel.swift`, inside `open(site:)`'s `Task { ... }` block, change:

```swift
            _ = await ReceivedInteractionSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            clearDevServerCommandInFlight(token: token)
```

to:

```swift
            _ = await ReceivedInteractionSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            // #912: pull Micropub-created posts from MICROPUB_DB and sync each into a typed
            // content file under src/content/. No-ops for sites without a provisioned D1
            // database (same gate as ReceivedInteractionSync — Micropub shares the database).
            _ = await MicropubContentSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            clearDevServerCommandInFlight(token: token)
```

- [ ] **Step 2: Build the app target to verify it compiles**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED. (If `Anglesite.xcodeproj` is stale relative to `project.yml` — unlikely here since no new targets/files were added outside existing globbed directories — run `xcodegen generate` first and rebuild.)

- [ ] **Step 3: Run the full Swift test suite once, to catch any cross-file regression**

Run: `swift test --package-path .`
Expected: PASS — every suite, including all of Tasks 3–7's new tests and the pre-existing `AnglesiteCoreTests`/`AnglesiteBridgeTests`/`AnglesiteSiteModelTests`/`AnglesiteIntentsTests` suites.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/PreviewModel.swift
git commit -m "feat(#912): sync Micropub posts into git on site-open"
```

---

## Final verification (after all 8 tasks)

- [ ] Run the full test matrix once more from a clean state:
  - `swift test --package-path .` (Swift)
  - `npm run test:worker` from `Resources/Template/` (Worker TS)
  - `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` (app target)
- [ ] Re-read `CONTRIBUTING.md` ▸ "Commits and pull requests" before opening the PR — use `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan), not a generic Summary/Test-plan shape. This is an app-only change (template's `worker.ts`/`Resources/Template` + `Sources/AnglesiteCore`/`AnglesiteApp`) — no MCP message schema changed, so the **Paired PR check** section should say so explicitly rather than being silently omitted.
- [ ] Remove the `🛠️ In Progress` label from #912 once the PR is open: `gh issue edit 912 --remove-label "🛠️ In Progress"`.
