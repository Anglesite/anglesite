Update dependencies and resolve security issues.

1. Run `npm outdated` to check for available updates
2. Run `npm audit` to check for known vulnerabilities
3. For each update:
   - Explain what the package does and why it needs updating
   - Check if it's a major version bump (may have breaking changes)
   - Update one at a time: `npm install package@latest`
   - Run `npx astro check` and `npm run build` after each
   - If something breaks, revert and explain
4. If `npm audit` shows vulnerabilities:
   - Try `npm audit fix` first
   - For remaining issues, evaluate severity and explain options
5. Commit: `git add -A && git commit -m "Update dependencies: $(date '+%Y-%m-%d')"`
6. Ask if they want to deploy

## Important: Keep docs in sync

If a major version update changes how something works (e.g., Astro config format), update the relevant doc.
