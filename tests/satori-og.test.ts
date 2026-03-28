import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock references are available inside vi.mock factories
const { mockSatori, mockRender, MockResvg } = vi.hoisted(() => {
  const mockRender = vi.fn();
  return {
    mockSatori: vi.fn(),
    mockRender,
    MockResvg: vi.fn().mockImplementation(() => ({ render: mockRender })),
  };
});

vi.mock("satori", () => ({ default: mockSatori }));
vi.mock("@resvg/resvg-js", () => ({ Resvg: MockResvg }));
vi.mock("sharp", () => ({ default: vi.fn() }));

import { renderOgImage } from "../template/scripts/satori-og.js";
import { OG_WIDTH, OG_HEIGHT, type OgColors } from "../template/scripts/og-templates.js";

const colors: OgColors = { primary: "#2563eb", bg: "#ffffff", text: "#1a1a1a" };
const fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>';
const fakePng = Buffer.from("fake-png-data");

beforeEach(() => {
  vi.clearAllMocks();
  mockSatori.mockResolvedValue(fakeSvg);
  mockRender.mockReturnValue({ asPng: () => new Uint8Array(fakePng) });
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
});
