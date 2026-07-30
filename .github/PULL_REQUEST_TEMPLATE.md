Closes #<!-- issue number(s) this PR resolves, e.g. "123" or "123, 456". Use a GitHub closing keyword (Closes/Fixes/Resolves) so the issue auto-closes on merge — a bare mention in prose does not link or close it. Delete this line only if the PR has no issue to close. -->

## Summary

<!-- 1–3 bullets. What changed, and why. -->

## Paired PR check

- [ ] This change is **self-contained** to `Anglesite/Anglesite`.
- [ ] This change **needs a paired PR** in [`Anglesite/anglesite-skills`](https://github.com/Anglesite/anglesite-skills) (MCP sidecar server). Link it here: <!-- e.g. Anglesite/anglesite-skills#123 -->

> Cross-cutting work (extending MCP messages) lands as paired PRs. The sidecar PR ships first in a tagged release; the app PR consumes it and re-vendors the container image. Template changes are app-only (`Resources/Template/`). See `CLAUDE.md` ▸ "Two-repo coordination".

## Test plan

- [ ] `swift test --package-path .`
- [ ] `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
- [ ] Manual smoke (if UI-touching): <!-- describe -->
