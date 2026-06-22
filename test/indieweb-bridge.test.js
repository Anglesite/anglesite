import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderMdoc, sync, slugFromUrl } from "../template/worker/indieweb-bridge.js";

describe("indieweb-bridge", () => {
  describe("renderMdoc", () => {
    it("renders a minimal note with slug and publishDate", () => {
      const row = {
        slug: "2026-06-09-abc123",
        properties: JSON.stringify({ published: ["2026-06-09T12:00:00Z"] }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("slug: 2026-06-09-abc123");
      expect(result).toContain('publishDate: "2026-06-09T12:00:00Z"');
      expect(result).toContain("draft: false");
      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---\n/);
    });

    it("includes title when name property is present", () => {
      const row = {
        slug: "test-note",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          name: ["My Test Note"],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("title: My Test Note");
    });

    it("omits title when name property is absent", () => {
      const row = {
        slug: "titleless",
        properties: JSON.stringify({ published: ["2026-06-09T12:00:00Z"] }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).not.toContain("title:");
    });

    it("maps mf2 photo to image and imageAlt", () => {
      const row = {
        slug: "photo-note",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          photo: [{ value: "/images/notes/cat.webp", alt: "A fluffy cat" }],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("image: /images/notes/cat.webp");
      expect(result).toContain("imageAlt: A fluffy cat");
    });

    it("handles photo as a plain string URL", () => {
      const row = {
        slug: "photo-string",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          photo: ["/images/notes/dog.webp"],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("image: /images/notes/dog.webp");
    });

    it("maps in-reply-to, bookmark-of, like-of, repost-of", () => {
      const row = {
        slug: "interactions",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          "in-reply-to": ["https://example.com/post/1"],
          "bookmark-of": ["https://example.com/article"],
          "like-of": ["https://example.com/liked"],
          "repost-of": ["https://example.com/reposted"],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain('inReplyTo: "https://example.com/post/1"');
      expect(result).toContain('bookmarkOf: "https://example.com/article"');
      expect(result).toContain('likeOf: "https://example.com/liked"');
      expect(result).toContain('repostOf: "https://example.com/reposted"');
    });

    it("includes syndication links as a YAML array", () => {
      const row = {
        slug: "syndicated",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          syndication: [
            "https://twitter.com/user/status/123",
            "https://mastodon.social/@user/456",
          ],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("syndication:");
      expect(result).toContain(
        '  - "https://twitter.com/user/status/123"',
      );
      expect(result).toContain(
        '  - "https://mastodon.social/@user/456"',
      );
    });

    it("extracts plain text content as the body", () => {
      const row = {
        slug: "plain-content",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          content: ["Hello, world!"],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toMatch(/---\nHello, world!\n$/);
    });

    it("extracts content from { value } object", () => {
      const row = {
        slug: "value-content",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          content: [{ value: "Text from value field" }],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("Text from value field");
    });

    it("strips HTML tags from html content", () => {
      const row = {
        slug: "html-content",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          content: [{ html: "<p>Hello <strong>world</strong></p>" }],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("Hello world");
      expect(result).not.toContain("<p>");
      expect(result).not.toContain("<strong>");
    });

    it("falls back to created_at when published is missing", () => {
      const row = {
        slug: "no-published",
        properties: JSON.stringify({}),
        created_at: "2026-06-09T08:30:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain('publishDate: "2026-06-09T08:30:00Z"');
    });

    it("handles properties as a pre-parsed object", () => {
      const row = {
        slug: "parsed",
        properties: { published: ["2026-06-09T12:00:00Z"], name: ["Parsed"] },
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain("title: Parsed");
    });

    it("quotes values that contain YAML-special characters", () => {
      const row = {
        slug: "special-chars",
        properties: JSON.stringify({
          published: ["2026-06-09T12:00:00Z"],
          name: ["Title: with colon"],
        }),
        created_at: "2026-06-09T12:00:00Z",
      };
      const result = renderMdoc(row);
      expect(result).toContain('title: "Title: with colon"');
    });
  });

  describe("sync", () => {
    let env;
    let prepareStub;

    beforeEach(() => {
      prepareStub = vi.fn();
      env = {
        MICROPUB_DB: { prepare: prepareStub },
        GITHUB_TOKEN: "ghp_test123",
        GITHUB_REPO: "testowner/testrepo",
        GITHUB_BRANCH: "main",
      };
    });

    // Route a prepare() call to the right fake by inspecting its SQL: the
    // bridge issues a CREATE TABLE (bridge_sync), one SELECT (the unsynced
    // join), and an INSERT ... ON CONFLICT (mark synced) per committed post.
    function wireDb({ rows = [], createBind, selectBind, syncBind }) {
      createBind = createBind ?? { run: vi.fn().mockResolvedValue({}) };
      selectBind =
        selectBind ??
        vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: rows }),
        });
      syncBind =
        syncBind ??
        vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
      prepareStub.mockImplementation((sql) => {
        if (sql.includes("CREATE TABLE")) return createBind;
        if (sql.includes("SELECT")) return { bind: selectBind };
        if (sql.includes("INSERT INTO bridge_sync")) return { bind: syncBind };
        return { bind: vi.fn() };
      });
      return { createBind, selectBind, syncBind };
    }

    it("returns early when MICROPUB_DB is missing", async () => {
      await sync({ GITHUB_TOKEN: "x", GITHUB_REPO: "a/b" });
      expect(prepareStub).not.toHaveBeenCalled();
    });

    it("returns early when GITHUB_TOKEN is missing", async () => {
      await sync({ MICROPUB_DB: {}, GITHUB_REPO: "a/b" });
      expect(prepareStub).not.toHaveBeenCalled();
    });

    it("returns early when GITHUB_REPO is missing", async () => {
      await sync({ MICROPUB_DB: {}, GITHUB_TOKEN: "x" });
      expect(prepareStub).not.toHaveBeenCalled();
    });

    it("ensures the bridge_sync table before querying", async () => {
      wireDb({ rows: [] });
      await sync(env);
      expect(prepareStub).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS bridge_sync"),
      );
    });

    it("queries unsynced posts via the bridge_sync join with a BATCH_SIZE limit", async () => {
      const { selectBind } = wireDb({ rows: [] });
      await sync(env);
      expect(prepareStub).toHaveBeenCalledWith(
        expect.stringContaining("LEFT JOIN bridge_sync"),
      );
      expect(selectBind).toHaveBeenCalledWith(25);
    });

    it("records sync state keyed by url after a successful commit", async () => {
      const syncRun = vi.fn().mockResolvedValue({});
      const syncBind = vi.fn().mockReturnValue({ run: syncRun });
      wireDb({
        syncBind,
        rows: [
          {
            url: "https://example.com/notes/test-note/",
            properties: JSON.stringify({
              published: ["2026-06-09T12:00:00Z"],
              content: ["Test"],
            }),
            deleted: 0,
            created_at: 1749470400,
            updated_at: 1749470400,
          },
        ],
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ status: 404, ok: false })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: { sha: "abc" } }),
        });

      try {
        await sync(env);
        expect(syncBind).toHaveBeenCalledWith(
          "https://example.com/notes/test-note/",
          1749470400,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("commits the note under its url-derived slug", async () => {
      wireDb({
        rows: [
          {
            url: "https://example.com/notes/hello-world/",
            properties: JSON.stringify({ content: ["hi"] }),
            deleted: 0,
            created_at: 1749470400,
            updated_at: 1749470400,
          },
        ],
      });

      const originalFetch = globalThis.fetch;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ status: 404, ok: false })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: { sha: "abc" } }),
        });
      globalThis.fetch = fetchMock;

      try {
        await sync(env);
        const putCall = fetchMock.mock.calls.find(
          ([, init]) => init?.method === "PUT",
        );
        expect(putCall[0]).toContain(
          "src/content/notes/hello-world.mdoc",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("records sync state (no commit) for a row whose url has no /notes/ slug, so the cron stops re-picking it", async () => {
      const syncRun = vi.fn().mockResolvedValue({});
      const syncBind = vi.fn().mockReturnValue({ run: syncRun });
      wireDb({
        syncBind,
        rows: [
          {
            url: "https://example.com/about/",
            properties: JSON.stringify({ content: ["nope"] }),
            deleted: 0,
            created_at: 1749470400,
            updated_at: 1749470400,
          },
        ],
      });

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      try {
        await sync(env);
        // No GitHub call for an unmaterializable row...
        expect(fetchMock).not.toHaveBeenCalled();
        // ...but it IS recorded so the unsynced query excludes it next run.
        expect(syncBind).toHaveBeenCalledWith(
          "https://example.com/about/",
          1749470400,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not record sync state on GitHub API failure", async () => {
      const syncRun = vi.fn().mockResolvedValue({});
      const syncBind = vi.fn().mockReturnValue({ run: syncRun });
      wireDb({
        syncBind,
        rows: [
          {
            url: "https://example.com/notes/fail-note/",
            properties: JSON.stringify({
              published: ["2026-06-09T12:00:00Z"],
            }),
            deleted: 0,
            created_at: 1749470400,
            updated_at: 1749470400,
          },
        ],
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ status: 404, ok: false })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        });

      try {
        await sync(env);
        expect(syncBind).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("slugFromUrl", () => {
    it("extracts the slug from a /notes/<slug>/ url", () => {
      expect(slugFromUrl("https://example.com/notes/my-post/")).toBe("my-post");
    });

    it("handles a missing trailing slash", () => {
      expect(slugFromUrl("https://example.com/notes/my-post")).toBe("my-post");
    });

    it("returns empty string for a non-note url", () => {
      expect(slugFromUrl("https://example.com/about/")).toBe("");
    });

    it("returns empty string for an unparseable value", () => {
      expect(slugFromUrl("not a url")).toBe("");
    });
  });
});
