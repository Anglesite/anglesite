# Release Process

## Overview

This document outlines the release process for the Anglesite monorepo and its constituent packages. We follow semantic versioning and maintain a regular release cadence.

## Release Cadence

- **Major Releases**: Quarterly (breaking changes, major features)
- **Minor Releases**: Monthly (new features, enhancements)
- **Patch Releases**: As needed (bug fixes, security updates)

## Monorepo Structure

### Packages

1. **anglesite** - Main Electron application
2. **anglesite-11ty** - Eleventy configuration package
3. **anglesite-starter** - Basic starter template
4. **web-components** - Reusable WebC components

### Version Synchronization

- All packages maintain independent versions
- Major version changes should be coordinated
- Dependencies between packages use `^` version ranges

## Pre-Release Checklist

### 1. Code Quality

- [ ] All tests passing (`npm test`)
- [ ] 90% code coverage achieved
- [ ] No linting errors (`npm run lint`)
- [ ] TypeScript compilation successful (`npm run typecheck`)
- [ ] Bundle size within limits (`npm run analyze:bundle`)

### 2. Documentation

- [ ] CHANGELOG.md updated
- [ ] README.md current
- [ ] JSDoc comments complete
- [ ] Migration guide for breaking changes

### 3. Security

- [ ] Security audit passed (`npm audit`)
- [ ] No exposed secrets (checked by pre-commit hooks)
- [ ] Dependencies updated

## Release Steps

### 1. Prepare Release Branch

```bash
# Create release branch from main
git checkout main
git pull origin main
git checkout -b release/v1.2.0
```

### 2. Update Versions

For each package that needs updating:

```bash
# Navigate to package directory
cd anglesite
npm version minor  # or major/patch

cd ../anglesite-11ty
npm version patch

cd ../web-components
npm version minor
```

### 3. Update Dependencies

Update inter-package dependencies:

```json
// anglesite/package.json
{
  "dependencies": {
    "@dwk/anglesite-11ty": "^1.2.0",
    "@dwk/web-components": "^1.1.0"
  }
}
```

### 4. Update Changelog

Create or update CHANGELOG.md for each package:

```markdown
# Changelog

## [1.2.0] - 2024-08-31

### Added

- Microsoft Fluent UI integration
- Webpack bundle analysis tools
- Enhanced file watching system

### Changed

- Replaced custom UI with Fluent components
- Improved build performance

### Fixed

- CA detection logic for keychain
- WebC plugin conflicts

### Security

- Updated all dependencies
- Fixed vulnerability in dependency X
```

### 5. Run Final Tests

```bash
# From root directory
npm test
npm run lint
npm run typecheck
npm run test:integration
npm run test:performance
```

### 6. Create Pull Request

```bash
git add .
git commit -m "chore: prepare release v1.2.0

- Update package versions
- Update changelogs
- Update dependencies"

git push origin release/v1.2.0
```

Create PR with:

- Title: "Release v1.2.0"
- Description: Summary of changes
- Labels: "release", "documentation"

### 7. Merge and Tag

After PR approval:

```bash
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

### 8. Publish to NPM

```bash
# Publish each package
cd anglesite-11ty
npm publish --access public

cd ../web-components
npm publish --access public

cd ../anglesite-starter
npm publish --access public
```

### 9. Create GitHub Release

1. Go to GitHub Releases page
2. Click "Create a new release"
3. Select tag `v1.2.0`
4. Title: "v1.2.0 - Feature Name"
5. Description: Copy from CHANGELOG
6. Attach built artifacts if applicable

### 10. Post-Release

- [ ] Verify packages on NPM
- [ ] Test installation from NPM
- [ ] Update documentation site
- [ ] Announce release (Discord, Twitter, etc.)
- [ ] Close related issues and PRs

## Hotfix Process

For critical bugs in production:

1. Create hotfix branch from tag

```bash
git checkout -b hotfix/v1.2.1 v1.2.0
```

2. Make minimal fix
3. Update patch version only
4. Fast-track through abbreviated process
5. Cherry-pick to main if applicable

## Rollback Process

If issues are discovered post-release:

1. **NPM Deprecation**

```bash
npm deprecate @dwk/anglesite@1.2.0 "Critical bug - use 1.1.0"
```

2. **Revert Release**

```bash
git revert <release-commit>
git tag -a v1.2.1 -m "Revert to stable"
```

3. **Communication**

- Update GitHub release notes
- Notify users via all channels
- Document issue and resolution

## Automation

### GitHub Actions

The `.github/workflows/release.yml` workflow automates:

- Version bumping
- Changelog generation
- NPM publishing
- GitHub release creation

Triggered by:

- Push to `release/*` branches
- Manual workflow dispatch

### Scripts

Helper scripts in `/scripts/`:

- `prepare-release.js` - Automates version updates
- `publish-packages.js` - Publishes all packages
- `generate-changelog.js` - Creates changelog from commits

## Version Strategy

### Semantic Versioning

We follow [SemVer](https://semver.org/):

- **MAJOR**: Breaking API changes
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

### Breaking Changes

Breaking changes require:

1. Major version bump
2. Migration guide
3. Deprecation warnings in previous version
4. Clear communication to users

### Pre-releases

For testing before official release:

```bash
npm version prerelease --preid=beta
# Results in: 1.2.0-beta.0

npm publish --tag beta
```

Users can install with:

```bash
npm install @dwk/anglesite@beta
```

## Package Relationships

### Dependency Graph

```
anglesite (main app)
├── @dwk/anglesite-11ty (config)
├── @dwk/web-components (UI components)
└── @fluentui/web-components (UI framework)

anglesite-starter (template)
├── @dwk/anglesite-11ty
└── @11ty/eleventy

web-components (standalone)
└── @11ty/webc
```

### Publishing Order

1. **web-components** (no internal dependencies)
2. **anglesite-11ty** (depends on web-components)
3. **anglesite-starter** (depends on anglesite-11ty)
4. **anglesite** (depends on all above)

## Troubleshooting

### NPM Publishing Issues

1. **Authentication Failed**

```bash
npm login
npm whoami  # Verify logged in
```

2. **Version Already Exists**

- Bump version again
- Or unpublish if within 24 hours

3. **Missing NPM_TOKEN**

- Set in GitHub Secrets
- Or use `npm config set //registry.npmjs.org/:_authToken`

### Git Tag Issues

1. **Tag Already Exists**

```bash
git tag -d v1.2.0
git push origin :refs/tags/v1.2.0
```

2. **Wrong Tag**

```bash
git tag -f v1.2.0 <correct-commit>
git push -f origin v1.2.0
```

## Communication

### Release Notes Template

```markdown
# 🎉 Anglesite v1.2.0 Released!

## ✨ Highlights

- Major feature 1
- Major feature 2
- Performance improvements

## 🚀 What's New

[Detailed feature descriptions]

## 🐛 Bug Fixes

[List of fixed issues]

## 💔 Breaking Changes

[If applicable, with migration guide]

## 📦 Installation

npm install -g anglesite

## 📖 Documentation

[Links to updated docs]

## 🙏 Contributors

Thanks to everyone who contributed!
```

### Announcement Channels

1. GitHub Release
2. NPM package page
3. Project website
4. Social media
5. Discord/Slack community
6. Email newsletter (if applicable)
