/**
 * Internationalization (i18n) utilities.
 *
 * Generates Astro i18n configuration, hreflang tags, localized paths,
 * and a language switcher component. Used by the i18n skill during
 * design interview setup.
 */

// ---------------------------------------------------------------------------
// Supported languages — display names in their own language
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ko: "한국어",
  ja: "日本語",
  vi: "Tiếng Việt",
  ar: "العربية",
  ru: "Русский",
  hi: "हिन्दी",
  tl: "Filipino",
  it: "Italiano",
  pl: "Polski",
  ht: "Kreyòl Ayisyen",
};

// ---------------------------------------------------------------------------
// Astro i18n config
// ---------------------------------------------------------------------------

export interface AstroI18nConfig {
  defaultLocale: string;
  locales: string[];
  routing: {
    prefixDefaultLocale: boolean;
  };
}

/**
 * Generate Astro i18n configuration object.
 * Uses prefix-other-locales strategy — default locale has no prefix.
 * @param defaultLocale - BCP 47 language code for the primary locale (e.g. "en").
 * @param locales - All supported locale codes including the default.
 * @returns Astro-compatible i18n configuration object.
 */
export function generateAstroI18nConfig(
  defaultLocale: string,
  locales: string[],
): AstroI18nConfig {
  return {
    defaultLocale,
    locales,
    routing: {
      prefixDefaultLocale: false,
    },
  };
}

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

/**
 * Generate a localized path.
 * Default locale gets no prefix; others get /<locale>/path.
 * @param path - The base path to localize (e.g. "/about").
 * @param locale - Target locale code.
 * @param defaultLocale - The site's default locale code.
 * @returns The path with a locale prefix, or unchanged for the default locale.
 */
export function localizedPath(
  path: string,
  locale: string,
  defaultLocale: string,
): string {
  if (locale === defaultLocale) return path;

  // Don't double-prefix
  if (path.startsWith(`/${locale}/`) || path === `/${locale}`) return path;

  return `/${locale}${path}`;
}

/**
 * Get the display name for a language code.
 * @param code - BCP 47 language code (e.g. "es").
 * @returns Native-language display name, or the code itself if unknown.
 */
export function languageDisplayName(code: string): string {
  return SUPPORTED_LANGUAGES[code] || code;
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// SEO — hreflang tags
// ---------------------------------------------------------------------------

/**
 * Generate hreflang link tags for all locales.
 * Includes x-default pointing to the default locale's URL.
 * @param currentPath - The current page path (e.g. "/about").
 * @param locales - All supported locale codes.
 * @param defaultLocale - The site's default locale code.
 * @param siteUrl - The site's base URL (with or without protocol).
 * @returns Newline-separated HTML `<link rel="alternate">` tags.
 */
export function generateHreflangTags(
  currentPath: string,
  locales: string[],
  defaultLocale: string,
  siteUrl: string,
): string {
  let baseUrl = siteUrl;
  if (!/^https?:\/\//.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  baseUrl = baseUrl.replace(/\/+$/, "");

  const tags: string[] = [];

  for (const locale of locales) {
    const path = localizedPath(currentPath, locale, defaultLocale);
    const href = escapeHtml(`${baseUrl}${path}`);
    const safeLang = escapeHtml(locale);
    tags.push(`<link rel="alternate" hreflang="${safeLang}" href="${href}" />`);

    if (locale === defaultLocale) {
      tags.push(`<link rel="alternate" hreflang="x-default" href="${href}" />`);
    }
  }

  return tags.join("\n");
}

// ---------------------------------------------------------------------------
// Language switcher component
// ---------------------------------------------------------------------------

/**
 * Generate accessible language switcher HTML.
 * @param currentPath - The current page path (e.g. "/about").
 * @param locales - All supported locale codes.
 * @param currentLocale - The locale of the current page.
 * @param defaultLocale - The site's default locale code.
 * @returns An HTML `<nav>` element containing localized links with `aria-current` on the active locale.
 */
export function generateLanguageSwitcherHtml(
  currentPath: string,
  locales: string[],
  currentLocale: string,
  defaultLocale: string,
): string {
  const links = locales.map((locale) => {
    const path = escapeHtml(localizedPath(currentPath, locale, defaultLocale));
    const name = escapeHtml(languageDisplayName(locale));
    const safeLang = escapeHtml(locale);
    const isCurrent = locale === currentLocale;

    if (isCurrent) {
      return `<a href="${path}" aria-current="page" lang="${safeLang}">${name}</a>`;
    }
    return `<a href="${path}" lang="${safeLang}">${name}</a>`;
  });

  return `<nav aria-label="Language" class="language-switcher">\n  ${links.join("\n  ")}\n</nav>`;
}
