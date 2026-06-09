## Summary

<!-- 1–3 bullets. What changed, and why. -->

## Paired PR check

- [ ] This change is **self-contained** to the plugin (skills / hooks / template / docs / MCP server with no consumer-visible contract change).
- [ ] This change **needs a paired PR** in [`Anglesite/Anglesite-app`](https://github.com/Anglesite/Anglesite-app) (MCP message schema, template fields the app reads, hook surface, anything the native app embeds or shells out to). Link it here: <!-- e.g. Anglesite/Anglesite-app#123 -->

> Cross-cutting changes land as paired PRs: the plugin ships first in a tagged release, then the app bumps its bundled-plugin pointer. The plugin is the source of truth for skills, hooks, and the MCP message schema. See `Anglesite-app/CLAUDE.md` ▸ "Two-repo coordination".

## Test plan

- [ ] Plugin self-checks pass (`scripts/pre-deploy-check.sh`, lint, any relevant audits)
- [ ] If touching the template: `scripts/scaffold.sh` produces a buildable site
- [ ] If touching the MCP server: paired app PR exercises the new/changed messages
