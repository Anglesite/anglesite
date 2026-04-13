# Releasing

## Version management

Versions must stay in sync across three files:
- `package.json`
- `.claude-plugin/plugin.json`
- `template/package.json`

Use `bin/release.ts` to bump all at once. It creates a git tag (`v*`) which triggers the CI release workflow.

## CI/CD

**`.github/workflows/test.yml`** — Runs on PRs and pushes to `main`:
1. Verifies skill registry is up to date (`npm run registry` + git diff check)
2. Runs the full test suite (`npm test`)

**`.github/workflows/release.yml`** — Triggered on `v*` tags:
1. Verifies version consistency across all manifests
2. Runs `scripts/pack-plugin.sh` to build plugin ZIP
3. Creates GitHub Release with ZIP artifact

## Security hooks

The `hooks/hooks.json` defines a PreToolUse hook that runs `scripts/pre-deploy-check.sh` before any Bash tool use. It enforces four mandatory scans before deploying to `main`:
1. **PII scan** — emails, phone numbers (configurable allowlist via `PII_EMAIL_ALLOW` in `.site-config`)
2. **Token scan** — exposed API keys and secrets
3. **Third-party script scan** — blocks unauthorized external JS
4. **Keystatic admin route scan** — ensures CMS admin is not publicly exposed
