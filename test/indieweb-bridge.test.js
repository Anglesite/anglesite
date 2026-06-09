import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderMdoc, sync } from "../template/worker/indieweb-bridge.js";

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

    it("returns early when no unsynced rows", async () => {
      prepareStub.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });
      await sync(env);
      expect(prepareStub).toHaveBeenCalledOnce();
    });

    it("queries for unsynced posts with BATCH_SIZE limit", async () => {
      const bindFn = vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });
      prepareStub.mockReturnValue({ bind: bindFn });
      await sync(env);
      expect(prepareStub).toHaveBeenCalledWith(
        expect.stringContaining("synced = 0"),
      );
      expect(bindFn).toHaveBeenCalledWith(25);
    });

    it("marks row as synced after successful commit", async () => {
      const updateBind = vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({}),
      });
      const selectBind = vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 1,
              slug: "test-note",
              properties: JSON.stringify({
                published: ["2026-06-09T12:00:00Z"],
                content: ["Test"],
              }),
              deleted: 0,
              created_at: "2026-06-09T12:00:00Z",
              updated_at: null,
            },
          ],
        }),
      });

      let callCount = 0;
      prepareStub.mockImplementation((sql) => {
        if (sql.includes("SELECT")) return { bind: selectBind };
        if (sql.includes("UPDATE")) return { bind: updateBind };
        return { bind: vi.fn() };
      });

      // Mock global fetch for GitHub API calls
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          status: 404,
          ok: false,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: { sha: "abc" } }),
        });

      try {
        await sync(env);
        expect(updateBind).toHaveBeenCalledWith(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not mark row synced on GitHub API failure", async () => {
      const updateBind = vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({}),
      });
      const selectBind = vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 1,
              slug: "fail-note",
              properties: JSON.stringify({
                published: ["2026-06-09T12:00:00Z"],
              }),
              deleted: 0,
              created_at: "2026-06-09T12:00:00Z",
              updated_at: null,
            },
          ],
        }),
      });

      prepareStub.mockImplementation((sql) => {
        if (sql.includes("SELECT")) return { bind: selectBind };
        if (sql.includes("UPDATE")) return { bind: updateBind };
        return { bind: vi.fn() };
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ status: 404, ok: false })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        });

      try {
        await sync(env);
        expect(updateBind).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
