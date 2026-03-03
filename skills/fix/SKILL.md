---
name: Fix
description: "Diagnose and fix common problems"
user-invocable: true
---

Something isn't working. Diagnose and fix it.

## Step 1 — Check for iCloud / path issues

Before anything else, run the prereq checker and check the project path:

```sh
zsh scripts/check-prereqs.sh
```

Then read `.site-config` to verify it has `SITE_NAME` and `DEV_HOSTNAME`. If either is missing, suggest running `/anglesite:start` first.

### Common iCloud issues
- **`.nosync` symlinks broken:** A git clone or copy can break them. Run `zsh scripts/setup.sh` to recreate.
- **`node_modules` missing:** iCloud doesn't sync `.nosync` dirs (by design). Run `npm install`.
- **Files showing as "downloading":** iCloud is syncing. Wait, or click the download icon in Finder.
- **Build artifacts in iCloud:** The prereq checker reports `.nosync` status. If any show "missing", run `zsh scripts/setup.sh`.

### Common tool issues
- **Wrangler auth expired:** Run `npx wrangler login` to re-authenticate.
- **MCP disconnected:** Check `/mcp` for the relevant service.
- **Dev server port conflict:** Run `lsof -i :4321` to find what's using port 4321, or `lsof -i :443` for port 443.
- **fnm/Node not in PATH:** Run `zsh scripts/setup.sh` to fix shell profile.

### HTTPS / local preview issues
- **Certificate error in browser:** The local CA may not be trusted. Run `zsh scripts/setup.sh` to reinstall it.
- **"This site can't be reached":** Check hostname resolution — run `dscacheutil -q host -a name HOSTNAME` (replace HOSTNAME with the value from `.site-config`). If it doesn't resolve to 127.0.0.1, run `zsh scripts/setup.sh`.
- **Port 443 not forwarding:** Run `zsh scripts/check-prereqs.sh` and look for `https_portforward`. If missing, run `zsh scripts/setup.sh`.
- **Certificate hostname mismatch:** Domain changed since cert was generated. Run `zsh scripts/setup.sh` to regenerate.
- **"Your connection is not private" warning:** The local CA cert expired or was removed from Keychain. Run `zsh scripts/setup.sh`.
- **HTTPS works at :4321 but not :443:** pfctl rules not loaded. Run `zsh scripts/setup.sh` to reload them.

## Step 2 — Diagnose the reported problem

1. Ask the owner to describe what's wrong (or what error they saw)
2. Check log files:
   - `~/.anglesite/logs/build.log` — build errors
   - `~/.anglesite/logs/deploy.log` — deploy errors
   - `~/.anglesite/logs/check.log` — check errors
   - `~/.anglesite/logs/dev.log` — dev server errors
3. Run `npx astro check` and `npm run build` to reproduce

## Step 3 — Fix it

1. Explain what went wrong in plain language
2. Fix it
3. Verify by running checks again
4. Ask if they want to publish the fix

## Important: Keep docs in sync

If the fix changed any configuration, update the corresponding doc in `docs/`.
