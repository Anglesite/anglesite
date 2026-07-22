## Summary

<!-- 1–3 bullets. What changed, and why. -->

## Paired PR check

- [ ] This change preserves the existing MCP contract.
- [ ] This change updates the MCP contract and has a paired PR in [`Anglesite/Anglesite-app`](https://github.com/Anglesite/Anglesite-app): <!-- e.g. Anglesite/Anglesite-app#123 -->

> The sidecar is the source of truth for the MCP message schema. Schema changes require a paired app PR.

## Test plan

- [ ] `npm test`
- [ ] If touching the MCP schema: paired app PR exercises the changed messages
