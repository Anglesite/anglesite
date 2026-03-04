---
name: fix
description: "Diagnose and fix common problems"
argument-hint: "[describe the problem]"
allowed-tools: ["Bash(npm run *)", "Bash(npx astro check)", "Bash(lsof *)", "Bash(dscacheutil *)", "Write", "Read", "Glob"]
---

Something isn't working. Diagnose and fix it.

## Step 1 — Check prerequisites

Before anything else, run the prereq checker and check the project path:

```sh
npm run ai-check
```

Then read `.site-config` to verify it has `SITE_NAME` and `DEV_HOSTNAME`. If either is missing, suggest running `/anglesite:start` first.

### Common tool issues
- **Wrangler auth expired:** Run `npx wrangler login` to re-authenticate.
- **MCP disconnected:** Check `/mcp` for the relevant service.
- **Dev server port conflict:** Run `lsof -i :4321` to find what's using port 4321, or `lsof -i :443` for port 443.
- **fnm/Node not in PATH:** Run `npm run ai-setup` to fix shell profile.

### HTTPS / local preview issues
- **Certificate error in browser:** The local CA may not be trusted. Run `npm run ai-setup` to reinstall it.
- **"This site can't be reached":** Check hostname resolution — run `dscacheutil -q host -a name HOSTNAME` (replace HOSTNAME with the value from `.site-config`). If it doesn't resolve to 127.0.0.1, run `npm run ai-setup`.
- **Port 443 not forwarding:** Run `npm run ai-check` and look for `https_portforward`. If missing, run `npm run ai-setup`.
- **Certificate hostname mismatch:** Domain changed since cert was generated. Run `npm run ai-setup` to regenerate.
- **"Your connection is not private" warning:** The local CA cert expired or was removed from Keychain. Run `npm run ai-setup`.
- **HTTPS works at :4321 but not :443:** pfctl rules not loaded. Run `npm run ai-setup` to reload them.

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
