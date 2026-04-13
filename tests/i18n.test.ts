import { describe, it, expect } from "vitest";
import {
  generateAstroI18nConfig,
  generateHreflangTags,
  localizedPath,
  languageDisplayName,
  generateLanguageSwitcherHtml,
  SUPPORTED_LANGUAGES,
} from "../template/scripts/i18n.js";

// ---------------------------------------------------------------------------
// SUPPORTED_LANGUAGES
// ---------------------------------------------------------------------------

describe("SUPPORTED_LANGUAGES", () => {
  it("includes English", () => {
    expect(SUPPORTED_LANGUAGES.en).toBe("English");
  });

  it("includes Spanish", () => {
    expect(SUPPORTED_LANGUAGES.es).toBe("Español");
  });

  it("includes Chinese", () => {
    expect(SUPPORTED_LANGUAGES.zh).toBeDefined();
  });

  it("includes at least 10 languages", () => {
    expect(Object.keys(SUPPORTED_LANGUAGES).length).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// generateAstroI18nConfig
// ---------------------------------------------------------------------------

describe("generateAstroI18nConfig", () => {
  it("sets the default locale", () => {
    const config = generateAstroI18nConfig("en", ["en", "es"]);
    expect(config.defaultLocale).toBe("en");
  });

  it("includes all locales", () => {
    const config = generateAstroI18nConfig("en", ["en", "es", "zh"]);
    expect(config.locales).toEqual(["en", "es", "zh"]);
  });

  it("sets routing to prefix-other-locales", () => {
    const config = generateAstroI18nConfig("en", ["en", "es"]);
    expect(config.routing).toBeDefined();
  });

  it("uses prefix-other-locales strategy (no prefix for default)", () => {
    const config = generateAstroI18nConfig("en", ["en", "es"]);
    expect(config.routing?.prefixDefaultLocale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateHreflangTags
// ---------------------------------------------------------------------------

describe("generateHreflangTags", () => {
  it("generates link tags for each locale", () => {
    const tags = generateHreflangTags("/blog/post", ["en", "es"], "en", "https://example.com");
    expect(tags).toContain('hreflang="en"');
    expect(tags).toContain('hreflang="es"');
  });

  it("includes x-default for the default locale", () => {
    const tags = generateHreflangTags("/blog/post", ["en", "es"], "en", "https://example.com");
    expect(tags).toContain('hreflang="x-default"');
  });

  it("generates correct URLs for non-default locale", () => {
    const tags = generateHreflangTags("/blog/post", ["en", "es"], "en", "https://example.com");
    expect(tags).toContain("https://example.com/es/blog/post");
  });

  it("uses unprefixed URL for default locale", () => {
    const tags = generateHreflangTags("/blog/post", ["en", "es"], "en", "https://example.com");
    expect(tags).toContain("https://example.com/blog/post");
    expect(tags).not.toContain("https://example.com/en/blog/post");
  });

  it("returns rel=alternate link elements", () => {
    const tags = generateHreflangTags("/", ["en", "es"], "en", "https://example.com");
    expect(tags).toContain('rel="alternate"');
  });

  it("strips trailing slash from siteUrl to avoid double slashes", () => {
    const tags = generateHreflangTags("/blog/post", ["en", "es"], "en", "https://example.com/");
    expect(tags).toContain("https://example.com/blog/post");
    expect(tags).not.toContain("https://example.com//");
  });

  it("prepends https:// when siteUrl has no protocol", () => {
    const tags = generateHreflangTags("/blog/post", ["en"], "en", "example.com");
    expect(tags).toContain("https://example.com/blog/post");
  });
});

// ---------------------------------------------------------------------------
// localizedPath
// ---------------------------------------------------------------------------

describe("localizedPath", () => {
  it("returns path unchanged for default locale", () => {
    expect(localizedPath("/blog/post", "en", "en")).toBe("/blog/post");
  });

  it("adds locale prefix for non-default locale", () => {
    expect(localizedPath("/blog/post", "es", "en")).toBe("/es/blog/post");
  });

  it("handles root path", () => {
    expect(localizedPath("/", "es", "en")).toBe("/es/");
  });

  it("handles root path for default locale", () => {
    expect(localizedPath("/", "en", "en")).toBe("/");
  });

  it("does not double-prefix", () => {
    expect(localizedPath("/es/blog/post", "es", "en")).toBe("/es/blog/post");
  });
});

// ---------------------------------------------------------------------------
// languageDisplayName
// ---------------------------------------------------------------------------

describe("languageDisplayName", () => {
  it("returns English for en", () => {
    expect(languageDisplayName("en")).toBe("English");
  });

  it("returns Español for es", () => {
    expect(languageDisplayName("es")).toBe("Español");
  });

  it("returns the code itself for unknown languages", () => {
    expect(languageDisplayName("xx")).toBe("xx");
  });
});

// ---------------------------------------------------------------------------
// generateLanguageSwitcherHtml
// ---------------------------------------------------------------------------

describe("generateLanguageSwitcherHtml", () => {
  it("generates a nav element", () => {
    const html = generateLanguageSwitcherHtml("/blog/post", ["en", "es"], "en", "en");
    expect(html).toContain("<nav");
  });

  it("has aria-label for accessibility", () => {
    const html = generateLanguageSwitcherHtml("/", ["en", "es"], "en", "en");
    expect(html).toContain("aria-label");
  });

  it("includes links for all locales", () => {
    const html = generateLanguageSwitcherHtml("/", ["en", "es", "zh"], "en", "en");
    expect(html).toContain("English");
    expect(html).toContain("Español");
  });

  it("marks current locale with aria-current", () => {
    const html = generateLanguageSwitcherHtml("/", ["en", "es"], "en", "en");
    expect(html).toContain('aria-current="page"');
  });

  it("links non-current locales to localized paths", () => {
    const html = generateLanguageSwitcherHtml("/blog/post", ["en", "es"], "en", "en");
    expect(html).toContain("/es/blog/post");
  });
});
