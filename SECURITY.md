# Security Policy

## Supported versions

Anglesite is pre-release and moving fast — only the latest release (and `main`) is supported. There are no older maintained lines to backport fixes to.

## Reporting a vulnerability

Please report security vulnerabilities privately using [GitHub Security Advisories](https://github.com/Anglesite/Anglesite/security/advisories/new) ("Report a vulnerability" under the Security tab) rather than filing a public issue.

Include as much detail as you can: affected version/commit, reproduction steps, and impact. This is a solo-maintained project, so response times are best-effort, but reports are taken seriously and will be acknowledged as soon as possible.

## Scope

This repo is the native macOS app (SwiftUI shell, website template, WKWebView preview, edit overlay). It ships sandboxed for the Mac App Store and runs site builds/deploys inside a container runtime.

If the vulnerability is in the MCP sidecar server instead, please report it against [`Anglesite/anglesite-skills`](https://github.com/Anglesite/anglesite-skills/security/advisories/new) — see `CLAUDE.md` ▸ "Two-repo coordination" for how the two repos relate.
