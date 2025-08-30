# Release Process Documentation

This guide covers the complete release process for the @dwk monorepo packages.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Version Management](#version-management)
- [Release Types](#release-types)
- [Manual Release Process](#manual-release-process)
- [Automated Release Process](#automated-release-process)
- [Publishing to NPM](#publishing-to-npm)
- [GitHub Releases](#github-releases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Overview

The @dwk monorepo follows a structured release process that ensures:

- Consistent versioning across packages
- Automated changelog generation
- Security scanning before releases
- Proper testing and validation
- Coordinated NPM publishing

### Release Philosophy

- **Semantic Versioning**: All packages follow semver (MAJOR.MINOR.PATCH)
- **Conventional Commits**: Commit messages determine version bumps
- **Independent Versioning**: Packages can be versioned independently
- **Automated Workflows**: CI/CD handles most release tasks

## Prerequisites

### Required Access

1. **NPM Publishing Rights**
   - Must be a member of the @dwk organization on NPM
   - NPM_TOKEN configured in GitHub Secrets
   - See [SECRETS_SETUP_GUIDE.md](./SECRETS_SETUP_GUIDE.md)

2. **GitHub Permissions**
   - Write access to the repository
   - Ability to create releases and tags
   - Access to repository secrets

3. **Local Setup**

   ```bash
   # Ensure you're logged in to NPM
   npm login

   # Verify access to @dwk organization
   npm org ls @dwk

   # Install dependencies
   npm install

   # Run validation
   npm run validate:release
   ```

## Version Management

### Semantic Versioning Guidelines

| Change Type      | Version Bump  | Commit Prefix             | Example               |
| ---------------- | ------------- | ------------------------- | --------------------- |
| Breaking Changes | MAJOR (x.0.0) | `BREAKING CHANGE:` or `!` | API changes, removals |
| New Features     | MINOR (0.x.0) | `feat:`                   | New functionality     |
| Bug Fixes        | PATCH (0.0.x) | `fix:`                    | Bug corrections       |
| Documentation    | No bump       | `docs:`                   | README updates        |
| Chores           | No bump       | `chore:`                  | Dependency updates    |

### Conventional Commit Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Examples:

```bash
# Feature (minor bump)
feat(anglesite): add dark mode support

# Fix (patch bump)
fix(web-components): resolve render issue in Safari

# Breaking change (major bump)
feat(anglesite)!: redesign configuration API

BREAKING CHANGE: Configuration now requires explicit schema version
```

## Release Types

### 1. Standard Release

Regular releases following normal development cycles.

### 2. Pre-release (Beta/RC)

For testing before stable releases.

```bash
# Beta release
npm version prerelease --preid=beta
# Results in: 1.2.3-beta.0

# Release candidate
npm version prerelease --preid=rc
# Results in: 1.2.3-rc.0
```

### 3. Hotfix Release

Emergency patches to production.

```bash
# Create hotfix branch from main
git checkout -b hotfix/security-patch main

# Make fixes and commit
git commit -m "fix: patch security vulnerability"

# Version and release
npm version patch
```

### 4. Coordinated Release

Releasing multiple packages together.

## Manual Release Process

### Step 1: Prepare Release Branch

```bash
# Create release branch
git checkout -b release/v1.2.3

# Update versions
npm version minor --no-git-tag-version

# Or for specific package
npm version minor -w anglesite --no-git-tag-version
```

### Step 2: Update Documentation

```bash
# Generate changelog
npm run changelog:generate

# Update README if needed
# Review and edit CHANGELOG.md

# Commit changes
git add .
git commit -m "chore: prepare release v1.2.3"
```

### Step 3: Run Pre-release Checks

```bash
# Full test suite
npm test

# Security audit
npm audit

# Build all packages
npm run build

# Bundle size check
npm run analyze:bundles

# Performance tests
npm run test:performance
```

### Step 4: Create Pull Request

```bash
# Push release branch
git push origin release/v1.2.3

# Create PR via GitHub CLI
gh pr create \
  --title "Release v1.2.3" \
  --body "$(npm run changelog:preview --silent)" \
  --base main
```

### Step 5: Merge and Tag

After PR approval:

```bash
# Merge to main
git checkout main
git merge --no-ff release/v1.2.3

# Create tag
git tag -a v1.2.3 -m "Release v1.2.3"

# Push with tags
git push origin main --tags
```

### Step 6: Publish to NPM

```bash
# Publish all changed packages
npm publish --workspaces --access public

# Or specific package
npm publish -w @dwk/anglesite --access public
```

## Automated Release Process

### GitHub Actions Workflow

The automated release is triggered by:

1. Creating a new tag
2. Manual workflow dispatch
3. Merging to main with release commits

### Triggering Automated Release

#### Option 1: Via GitHub UI

1. Go to Actions tab
2. Select "Release" workflow
3. Click "Run workflow"
4. Select version type (patch/minor/major)

#### Option 2: Via Command Line

```bash
# Using GitHub CLI
gh workflow run release.yml \
  -f version_type=minor \
  -f prerelease=false
```

#### Option 3: Via Git Tag

```bash
# Create annotated tag
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3

# This triggers the release workflow
```

### What Happens During Automated Release

1. **Version Validation**
   - Checks version format
   - Ensures no conflicts
   - Validates package.json files

2. **Build & Test**
   - Runs full test suite
   - Builds all packages
   - Performs security scanning

3. **Changelog Generation**
   - Parses commits since last release
   - Groups by type
   - Updates CHANGELOG.md

4. **NPM Publishing**
   - Authenticates with NPM
   - Publishes changed packages
   - Verifies publication

5. **GitHub Release**
   - Creates GitHub release
   - Attaches build artifacts
   - Posts release notes

## Publishing to NPM

### Pre-publication Checklist

- [ ] All tests passing
- [ ] Security audit clean
- [ ] Bundle sizes acceptable
- [ ] Performance benchmarks pass
- [ ] Documentation updated
- [ ] CHANGELOG.md current
- [ ] Version numbers correct

### Manual NPM Publishing

```bash
# Dry run first
npm publish --dry-run

# Publish with OTP
npm publish --otp=123456

# Publish specific package
npm publish -w @dwk/anglesite

# Publish with specific tag
npm publish --tag beta
```

### Verifying Publication

```bash
# Check NPM registry
npm view @dwk/anglesite

# Verify all packages
npm ls --workspaces --depth=0

# Test installation
npx create-temporary-directory
npm install @dwk/anglesite
```

## GitHub Releases

### Creating GitHub Release

#### Automated (Recommended)

Handled by CI/CD when tags are pushed.

#### Manual Process

```bash
# Using GitHub CLI
gh release create v1.2.3 \
  --title "Release v1.2.3" \
  --notes-file CHANGELOG.md \
  --target main

# Attach artifacts
gh release upload v1.2.3 \
  dist/anglesite-*.zip \
  dist/checksums.txt
```

### Release Notes Format

```markdown
## What's Changed

- feat: Add new feature by @contributor
- fix: Resolve critical bug by @contributor

## Breaking Changes

- API endpoint renamed from /old to /new

## Full Changelog

https://github.com/davidwkeith/@dwk/compare/v1.2.2...v1.2.3
```

## Rollback Procedures

### NPM Package Rollback

#### Option 1: Deprecate Bad Version

```bash
# Mark version as deprecated
npm deprecate @dwk/anglesite@1.2.3 "Critical bug - use 1.2.4"

# Publish fix
npm version patch
npm publish
```

#### Option 2: Unpublish (Within 72 hours)

```bash
# Unpublish specific version
npm unpublish @dwk/anglesite@1.2.3

# Note: Can only unpublish within 72 hours
```

### Git Rollback

#### Revert Release Commit

```bash
# Create revert commit
git revert -m 1 <merge-commit-hash>

# Push to main
git push origin main

# Tag as patch
git tag -a v1.2.4 -m "Revert v1.2.3"
git push origin v1.2.4
```

#### Delete Tag (Emergency)

```bash
# Delete local tag
git tag -d v1.2.3

# Delete remote tag
git push origin --delete v1.2.3
```

## Troubleshooting

### Common Issues and Solutions

#### NPM Authentication Failures

```bash
# Problem: 401 Unauthorized
# Solution:
npm logout
npm login
npm whoami

# Verify token
npm token list
```

#### Version Conflicts

```bash
# Problem: Version already exists
# Solution:
# Check current versions
npm view @dwk/anglesite versions

# Bump to next available
npm version patch
```

#### Build Failures in CI

```bash
# Problem: Tests fail in CI but pass locally
# Solutions:
# 1. Check environment variables
node scripts/validate-environment.js

# 2. Clear caches
npm ci

# 3. Match Node version
nvm use
```

#### Partial Release Failure

```bash
# Problem: Some packages published, others failed
# Solution:
# 1. Identify failed packages
npm ls --workspaces --depth=0

# 2. Manually publish failed packages
npm publish -w @dwk/failed-package

# 3. Update release notes
gh release edit v1.2.3 --notes "Partial release completed"
```

### Emergency Contacts

For critical release issues:

1. Check GitHub Actions logs
2. Review npm audit reports
3. Consult TROUBLESHOOTING.md
4. Create issue with `release-blocker` label

## Best Practices

### Do's

- ✅ Always run tests before releasing
- ✅ Use conventional commits
- ✅ Create release branches for major versions
- ✅ Document breaking changes clearly
- ✅ Verify NPM publication immediately
- ✅ Keep CHANGELOG.md updated
- ✅ Tag releases in git

### Don'ts

- ❌ Skip security audits
- ❌ Release on Fridays
- ❌ Force push to main
- ❌ Ignore failing tests
- ❌ Publish without changelog
- ❌ Use --force with npm

## Release Schedule

### Regular Releases

- **Weekly**: Patch releases (bug fixes)
- **Bi-weekly**: Minor releases (features)
- **Quarterly**: Major releases (breaking changes)

### Special Releases

- **Hotfixes**: As needed for critical issues
- **Security**: Within 24 hours of disclosure
- **Beta**: Before major releases

## Automation Scripts

### Useful Commands

```bash
# Full release preparation
npm run release:prepare

# Validate release readiness
npm run release:validate

# Generate release notes
npm run release:notes

# Publish all packages
npm run release:publish

# Post-release verification
npm run release:verify
```

## Additional Resources

- [Semantic Versioning Spec](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [NPM Publishing Docs](https://docs.npmjs.com/cli/v8/commands/npm-publish)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [SECRETS_SETUP_GUIDE.md](./SECRETS_SETUP_GUIDE.md)
- [ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
