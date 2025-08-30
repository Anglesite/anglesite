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

## @dwk Monorepo TODO

- [x] Make mono-repo
- [x] Get CI going for NPM packages & pages
  - [x] Add performance testing automation
  - [x] Configure enhanced caching strategies
  - [x] Fix secret validation in .github/workflows/release.yml
  - [x] Add TypeScript to CodeQL language matrix
  - [x] Implement path validation in scripts/analyze-bundle-sizes.js
  - [x] Add retry mechanisms for performance tests
  - [x] Implement workflow concurrency controls
  - [x] Add automated changelog generation
  - [x] Create required secrets (NPM_TOKEN) setup guide
  - [x] Create environment configuration docs
  - [x] Create release process documentation
- [ ] Add app icon
- [ ] Publish Schema to `https://anglesite.dwk.io/schema/website.json`
- [ ] Make simple static site build of /docs

## Anglesite App TODO

- [x] Optimized source maps for development vs production
- [x] Separate Dev/Prod webpack Configs
- [x] Watch Mode Integration: File watching with incremental compilation
- [x] Bundle Analysis: webpack-bundle-analyzer integration
- [ ] Code Splitting
- [ ] Concurrency in Development: concurrent package for parallel development
- [ ] Add Microsoft Fluent UI
- [ ] Build GeoCities themed About box with "View Source" link

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

- [x] XML NPM Package?
- [ ] .well-known/dnt-policy.txt - Do Not Track policy
- [x] .well-known/gpc.json - Global Privacy Control support
- [ ] .well-known/accessibility - Accessibility statement location
- [ ] .well-known/privacy-policy - Privacy policy location (redirect)
- [ ] .well-known/terms-of-service - Terms of service location (redirect)
