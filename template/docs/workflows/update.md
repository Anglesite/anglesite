# Update Workflow

Update your site's dependencies and template files to the latest Anglesite version.

## Prerequisites

- Site was scaffolded with Anglesite (`ANGLESITE_VERSION` in `.site-config`)
- `npm run build` passes before starting

## Steps

### 1. Check current state

```sh
npm run build
```

Fix any build failures before proceeding.

### 2. Check for dependency updates

```sh
npm outdated
```

Update dependencies one at a time:

```sh
npm install package@version
```

Run `npx astro check` and `npm run build` after each update. If something breaks, revert.

### 3. Check for security issues

```sh
npm audit
```

Try `npm audit fix` for auto-fixable issues. Evaluate severity for the rest.

### 4. Verify

```sh
npx astro check
npm run build
```

### 5. Save a snapshot

```sh
git add -A
git commit -m "Update dependencies: YYYY-MM-DD"
```

### 6. Deploy (optional)

Follow `docs/workflows/deploy.md` to publish the updated site.

## Notes

- Update one package at a time to isolate breakage
- Use exact versions from the Anglesite template's `package.json` — they're tested together
- Never update during a deploy freeze
- Run `/anglesite:check` after major updates to verify accessibility, security, and SEO
