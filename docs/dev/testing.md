# Testing

**Framework:** Vitest 3.1.1

```sh
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

**Test layout:**
- `tests/` — TypeScript tests (token calc, instruction validation, config, image gen, platform detection, pre-deploy checks, skill registry)
- `test/` — JavaScript tests (BaseLayout, convert skill, scaffold .gitignore, Wix extraction + color utils)
- `test/fixtures/` — Sample HTML for Wix extraction tests

**Config:** `vitest.config.ts` includes both directories, aliases `./config.js` and `./platform.js` to template sources for import resolution.

## Testing changes manually

```sh
mkdir /tmp/test-site
zsh scripts/scaffold.sh /tmp/test-site
cd /tmp/test-site
npm install
npm run dev
```

## Manual validation: Safari rendered-extraction backend

CI covers the Safari driver against a fake safaridriver
(`test/fixtures/fake-safaridriver.mjs`). Before releases that touch
`scripts/import/browser/`, validate against live Safari on macOS:

1. Safari Technology Preview installed; Settings → Developer →
   "Allow remote automation" enabled.
2. `node scripts/import/browser/safari-driver.mjs --check` → exit 0.
3. `node scripts/import/browser/safari-driver.mjs "https://cami-demo.squarespace.com"`
   → NDJSON line with `tokens["--color-bg"] === "#c8a47e"` (template tan)
   and body containing "Sandra Cami".
4. `node scripts/import/browser/safari-driver.mjs "https://www.wix.com/blog" --content-only`
   → body with full `static.wixstatic.com` image URLs.
