Something isn't working. Diagnose and fix it.

## Step 1 — Check for iCloud / path issues

Before anything else, run the prereq checker and check the project path:

```sh
zsh scripts/check-prereqs.sh
```

Then read `.farm-config` to verify `PROJECT_DIR` matches `$(pwd)`. If they don't match, update `.farm-config` and commit.

### Common iCloud issues
- **`.nosync` symlinks broken:** A git clone or copy can break them. Run `zsh scripts/setup.sh` to recreate.
- **`node_modules` missing:** iCloud doesn't sync `.nosync` dirs (by design). Run `npm install`.
- **Files showing as "downloading":** iCloud is syncing. Wait, or click the download icon in Finder.
- **Build artifacts in iCloud:** The prereq checker reports `.nosync` status. If any show "missing", run `zsh scripts/setup.sh`.

### App issues
- **App doesn't launch:** Right-click → Open (Gatekeeper). If that doesn't work, check `/Applications/Pairadocs Farm.app` exists.
- **Menu appears but actions fail:** fnm/Node not in PATH. Run `zsh scripts/setup.sh` to fix shell profile.
- **Wrangler auth expired:** Run `npx wrangler login` to re-authenticate.
- **Airtable MCP disconnected:** Check `/mcp`. If missing, walk Julia through creating a new token at https://airtable.com/create/tokens.
- **Dev server port conflict:** Run `lsof -i :4321` to find what's using the port.

## Step 2 — Diagnose the reported problem

1. Ask Julia to describe what's wrong (or what error she saw)
2. Check log files:
   - `~/.pairadocs/logs/build.log` — build errors
   - `~/.pairadocs/logs/deploy.log` — deploy errors
   - `~/.pairadocs/logs/check.log` — check errors
   - `~/.pairadocs/logs/dev.log` — dev server errors
3. Run `npx astro check` and `npm run build` to reproduce

## Step 3 — Fix it

1. Explain what went wrong in plain language
2. Fix it
3. Verify by running checks again
4. Ask Julia if she wants to publish the fix

## Important: Keep docs in sync

If the fix changed any configuration, update the corresponding doc in `docs/`.
