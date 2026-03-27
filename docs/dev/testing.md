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
