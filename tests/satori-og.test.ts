import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock references are available inside vi.mock factories
const { mockSatori, mockRender, MockResvg, mockDecompress, FAKE_FONT_PATH } =
  vi.hoisted(() => {
    const mockRender = vi.fn();
    return {
      mockSatori: vi.fn(),
      mockRender,
      MockResvg: vi.fn().mockImplementation(() => ({ render: mockRender })),
      mockDecompress: vi.fn(),
      FAKE_FONT_PATH: "/__mocked__/inter-latin-400-normal.woff2",
    };
  });

vi.mock("satori", () => ({ default: mockSatori }));
vi.mock("@resvg/resvg-js", () => ({ Resvg: MockResvg }));
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("wawoff2", () => ({ default: { decompress: mockDecompress } }));

// Intercept the @fontsource/inter require.resolve + readFileSync chain so the
// loadFont code path runs without needing the npm package installed locally.
vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => ({
      resolve: (id: string) => {
        if (id.includes("inter-latin-400-normal.woff2")) return FAKE_FONT_PATH;
        throw new Error(`createRequire mock: unhandled id ${id}`);
      },
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: unknown, ...rest: unknown[]) => {
      if (path === FAKE_FONT_PATH) {
        // Fake WOFF2 bytes — wawoff2.decompress is mocked, so contents don't matter
        return Buffer.from([0x77, 0x4f, 0x46, 0x32]);
      }
      // @ts-expect-error — pass through to the real implementation
      return actual.readFileSync(path, ...rest);
    }),
  };
});

import { renderOgImage } from "../template/scripts/satori-og.js";
import { OG_WIDTH, OG_HEIGHT, type OgColors } from "../template/scripts/og-templates.js";

const colors: OgColors = { primary: "#2563eb", bg: "#ffffff", text: "#1a1a1a" };
const fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>';
const fakePng = Buffer.from("fake-png-data");

beforeEach(() => {
  vi.clearAllMocks();
  mockSatori.mockResolvedValue(fakeSvg);
  mockRender.mockReturnValue({ asPng: () => new Uint8Array(fakePng) });
  mockDecompress.mockResolvedValue(new Uint8Array([0x00, 0x01, 0x00, 0x00]));
});

// ---------------------------------------------------------------------------
// renderOgImage
// ---------------------------------------------------------------------------

describe("renderOgImage", () => {
  it("calls satori with correct dimensions and returns a Buffer", async () => {
    const result = await renderOgImage({
      title: "Hello",
      siteName: "Test Site",
      colors,
      template: "text-only",
      fontData: Buffer.from("fake-font"),
    });

    expect(mockSatori).toHaveBeenCalledTimes(1);
    const [, options] = mockSatori.mock.calls[0];
    expect(options.width).toBe(OG_WIDTH);
    expect(options.height).toBe(OG_HEIGHT);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("passes the SVG output to Resvg for rasterization", async () => {
    await renderOgImage({
      title: "Page",
      siteName: "Site",
      colors,
      template: "text-only",
      fontData: Buffer.from("fake-font"),
    });

    expect(MockResvg).toHaveBeenCalledWith(fakeSvg);
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("uses text-logo template when specified with a logo", async () => {
    const logoSvg = '<svg><circle r="10"/></svg>';
    await renderOgImage({
      title: "About",
      siteName: "Biz",
      colors,
      template: "text-logo",
      logoSvg,
      fontData: Buffer.from("fake-font"),
    });

    expect(mockSatori).toHaveBeenCalledTimes(1);
    // The element tree passed to satori should include an img for the logo
    const [element] = mockSatori.mock.calls[0];
    const hasImg = JSON.stringify(element).includes("data:image/svg+xml");
    expect(hasImg).toBe(true);
  });

  it("falls back to text-only when template is text-logo but no logo provided", async () => {
    await renderOgImage({
      title: "About",
      siteName: "Biz",
      colors,
      template: "text-logo",
      logoSvg: "",
      fontData: Buffer.from("fake-font"),
    });

    expect(mockSatori).toHaveBeenCalledTimes(1);
    // Should still work — no img element in tree
    const [element] = mockSatori.mock.calls[0];
    const hasImg = JSON.stringify(element).includes("data:image/svg+xml");
    expect(hasImg).toBe(false);
  });

  it("includes at least one font in satori options", async () => {
    await renderOgImage({
      title: "Fonts",
      siteName: "Site",
      colors,
      template: "text-only",
      fontData: Buffer.from("fake-font"),
    });

    const [, options] = mockSatori.mock.calls[0];
    expect(options.fonts).toBeDefined();
    expect(options.fonts.length).toBeGreaterThanOrEqual(1);
    expect(options.fonts[0].name).toBe("Inter");
  });

  it("decompresses WOFF2 to TTF when no fontData is provided", async () => {
    // Hand satori the bundled font path — must go through wawoff2 so that the
    // bytes it sees are TTF, never WOFF2. Regression guard for #305.
    await renderOgImage({
      title: "Bundled",
      siteName: "Site",
      colors,
      template: "text-only",
    });

    expect(mockDecompress).toHaveBeenCalledTimes(1);
    const [, options] = mockSatori.mock.calls[0];
    // Decompressed TTF starts with 0x00010000 (TrueType magic)
    expect(options.fonts[0].data[0]).toBe(0x00);
    expect(options.fonts[0].data[1]).toBe(0x01);
  });
});

// ---------------------------------------------------------------------------
// loadFont
// ---------------------------------------------------------------------------

describe("loadFont", () => {
  it("returns TTF bytes after decompressing the bundled WOFF2", async () => {
    // Reset so the module-level cache doesn't hide the decompress call when
    // this test runs after renderOgImage tests that already warmed the cache.
    vi.resetModules();
    const fresh = await import("../template/scripts/satori-og.js");
    const font = await fresh.loadFont();
    expect(Buffer.isBuffer(font)).toBe(true);
    expect(mockDecompress).toHaveBeenCalled();
  });

  it("caches the decompressed font across calls", async () => {
    vi.resetModules();
    mockDecompress.mockClear();
    const fresh = await import("../template/scripts/satori-og.js");
    await fresh.loadFont();
    await fresh.loadFont();
    expect(mockDecompress).toHaveBeenCalledTimes(1);
  });
});
