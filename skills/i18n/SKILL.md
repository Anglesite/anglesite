---
name: i18n
description: "Set up multi-language support with localized routes, hreflang, and language switcher"
user-invokable: false
allowed-tools: Bash(npm run build), Bash(npx astro check), Write, Read, Glob
---

Add multi-language support to the site. Called during the design interview when the owner indicates they serve a multilingual community — not invoked directly.

Utilities are in `${CLAUDE_PLUGIN_ROOT}/template/scripts/i18n.ts`. Read them for the full API.

## When to invoke this skill

- During `/anglesite:start` or design interview when the owner mentions multiple languages
- When the owner asks to add a language to their site
- Business types that commonly need i18n: restaurant, salon, healthcare, house-of-worship, social-services, childcare, cleaning, laundry

## Step 1 — Determine languages

Ask the owner: "Does your business serve customers who speak languages other than English? For example, many [business type] businesses offer their site in Spanish too."

If yes, ask which languages. Common combinations for US small businesses:
- English + Spanish (most common)
- English + Chinese (Mandarin)
- English + Vietnamese
- English + Korean
- English + French (Louisiana, Maine, Quebec border)
- English + Haitian Creole (Florida, NYC)

Supported language codes are in `SUPPORTED_LANGUAGES` in `scripts/i18n.ts`.

Save to `.site-config`:
```
SITE_LANGUAGES=en,es
DEFAULT_LANGUAGE=en
```

## Step 2 — Configure Astro i18n

Update `astro.config.ts` to add the i18n configuration. Use `generateAstroI18nConfig()` to get the config object:

```typescript
export default defineConfig({
  site: siteUrl,
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  // ... rest of config
});
```

This gives URL structure:
- `/blog/post` — English (default, no prefix)
- `/es/blog/post` — Spanish

## Step 3 — Set up content structure

Create parallel content directories for the non-default locale(s):

```
src/content/posts/       ← English posts (existing)
src/content/posts/es/    ← Spanish posts
src/content/services/    ← English services
src/content/services/es/ ← Spanish services
```

Each translated entry has the same filename as its English counterpart. This allows matching content across languages.

## Step 4 — Update BaseLayout

Add to `BaseLayout.astro`:

1. **Dynamic `lang` attribute** — change `<html lang="en">` to use the current locale from `Astro.currentLocale` or the URL path.

2. **Hreflang tags** — add in the `<head>` section. Use `generateHreflangTags()`:

```html
<!-- Hreflang for SEO -->
<link rel="alternate" hreflang="en" href="https://example.com/blog/post" />
<link rel="alternate" hreflang="es" href="https://example.com/es/blog/post" />
<link rel="alternate" hreflang="x-default" href="https://example.com/blog/post" />
```

3. **Language switcher** — add in the header or footer. Use `generateLanguageSwitcherHtml()`:

```html
<nav aria-label="Language" class="language-switcher">
  <a href="/blog/post" aria-current="page" lang="en">English</a>
  <a href="/es/blog/post" lang="es">Español</a>
</nav>
```

## Step 5 — Create localized pages

For each non-default locale, create page files under the locale directory:

```
src/pages/es/index.astro
src/pages/es/blog/index.astro
src/pages/es/blog/[slug].astro
```

These mirror the English pages but query content from the locale-specific collection subdirectory.

## Step 6 — Language-specific RSS feeds

Create RSS feeds per language:
- `/rss.xml` — English posts
- `/es/rss.xml` — Spanish posts

Update the RSS title and description for each language.

## Step 7 — Translate UI strings

Create a simple translation object for UI strings (button labels, navigation, footer text):

```typescript
const ui = {
  en: { readMore: "Read more", subscribe: "Subscribe", contact: "Contact" },
  es: { readMore: "Leer más", subscribe: "Suscribirse", contact: "Contacto" },
};
```

Store in `src/i18n/ui.ts`. Pages import the current locale's strings.

## Step 8 — Verify

```sh
npm run build
```

```sh
npx astro check
```

Tell the owner: "Your site now supports [languages]. Here's how it works:"
- `example.com` — English version (default)
- `example.com/es/` — Spanish version
- A language switcher appears on every page
- Google knows about both versions via hreflang tags
- New content can be written in either language

## Translation workflow

When the owner creates content in their default language, offer: "Would you like me to translate this to [other language]?"

If yes, translate the content and create the parallel file. The owner can review and edit the translation in Keystatic.

Translations are always editable — the AI provides a starting point, not a final product.

## Keep docs in sync

After setup, update:
- `docs/architecture.md` — note multi-language support and URL structure
- `.site-config` — `SITE_LANGUAGES` and `DEFAULT_LANGUAGE`
