# @DWK

This is a directory for my `@dwk/` node modules.

## AI Setup

- TypeScript
- Jest @ 90% coverage
- Linting: Typescript/JavaScript, YAML, Markdown, HTML, CSS

## Vibing with Claude

Tell User Stories for new features. Show ad hoc wireframes from Freeform.

Pre-commit:

```text
1. Remove all code obsoleted by the changes since the last commit and any leftover debug logging.
2. Update existing tests for changed code.
3. Ensure we have 90% test coverage on the new code.
4. Check and fix any linting errors.
5. Add all changes and summarize them into a commit message for me to approve.
```

Double check linting and tests. Spot check changes in app.

```text
👍 Commit & push.
```

## Anglesite App TODO

- [ ] Optimized source maps for development vs production
- [ ] Separate Dev/Prod webpack Configs
- [ ] Watch Mode Integration: File watching with incremental compilation
- [ ] Bundle Analysis: webpack-bundle-analyzer integration
- [ ] Code Splitting
- [ ] Concurrency in Development: concurrent package for parallel development
- [ ] Add Microsoft Fluent UI

### Phase 2: Remaining Work (60% incomplete)

🔴 Critical Blockers (Fix First)

1. Missing Dependencies - Install @rjsf/\* packages to fix WebsiteConfigEditor
2. No File Editors - Zero WYSIWYG editors implemented (core Phase 2 feature)
3. IPC Integration Gap - React components can't actually edit/save file content

📝 Major Missing Features

WYSIWYG Editors (0% complete):

- Markdown editor with live preview
- HTML visual editor
- CSS editor with syntax highlighting
- SVG visual editor
- XML/data file editor

  Plugin System (0% complete):

- Angular-style API architecture
- Plugin registration system
- Extension point framework

  SEO & Accessibility (0% complete):

- Structured metadata generation
- Schema.org integration
- Social media card generation
- WCAG 2.1 AA compliance tools
- Built-in accessibility auditing

  🔧 Technical Gaps

  State Management:

- Expand React Context for file editing state
- Add undo/redo functionality
- Implement draft saving

  Integration:

- Make React editor primary (not fallback)
- Complete IPC handlers for file operations
- Add real-time preview sync

  📊 Current Status: 40% Complete

### Phase 3: Schema-Driven Forms

- [ ] RJSF Integration: Full website configuration editor
- [ ] Schema Loading: Dynamic schema loading from anglesite-11ty
- [ ] Validation & Docs: Rich validation with inline documentation

### Phase 4: Advanced Features

- [ ] Drag & Drop: File organization and media uploads
- [ ] Live Preview: Real-time preview updates
- [ ] Plugin System: Extensible architecture for new features

## anglesite-11ty TOOD

Official RFC-defined well-known URIs:

1. .well-known/host-meta - Host metadata for discovery (RFC 6415)
2. .well-known/nodeinfo - Node information for federated networks
3. .well-known/openid_configuration - OpenID Connect discovery

Common unofficial but widely supported:

1. .well-known/apple-app-site-association - iOS universal links
2. .well-known/assetlinks.json - Android app links verification
3. .well-known/browserconfig.xml - Microsoft browser tile configuration
4. .well-known/dnt-policy.txt - Do Not Track policy
5. .well-known/gpc.json - Global Privacy Control support
6. .well-known/accessibility - Accessibility statement location
7. .well-known/privacy-policy - Privacy policy location (redirect)
8. .well-known/terms-of-service - Terms of service location (redirect)
