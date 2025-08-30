# Changelog Generation Guide

This guide explains how automated changelog generation works in the @dwk monorepo and how to use it effectively.

## 📋 Overview

The monorepo uses automated changelog generation based on conventional commits to:

- Generate comprehensive changelogs for the entire project
- Create package-specific changelogs for each workspace
- Generate release notes for GitHub releases
- Provide changelog previews in pull requests

## 🚀 Features

### Automated Generation

- **Conventional Commit Parsing**: Automatically categorizes commits by type (feat, fix, docs, etc.)
- **Breaking Change Detection**: Identifies and highlights breaking changes
- **Multi-Package Support**: Generates changelogs for the entire monorepo and individual packages
- **Release Notes**: Creates detailed release notes with statistics and comparisons
- **GitHub Integration**: Automatically runs on releases, version updates, and manual triggers

### Supported Commit Types

| Type       | Description              | Changelog Section           |
| ---------- | ------------------------ | --------------------------- |
| `feat`     | New features             | 🚀 Features                 |
| `fix`      | Bug fixes                | 🐛 Bug Fixes                |
| `perf`     | Performance improvements | ⚡ Performance Improvements |
| `refactor` | Code refactoring         | ♻️ Code Refactoring         |
| `docs`     | Documentation changes    | 📚 Documentation            |
| `test`     | Test changes             | 🧪 Tests                    |
| `ci`       | CI/CD changes            | 👷 Build System & CI        |
| `build`    | Build system changes     | 👷 Build System & CI        |
| `style`    | Code style changes       | 🔧 Other Changes            |
| `chore`    | Maintenance tasks        | 🔧 Other Changes            |

### Breaking Changes

- Detected by `BREAKING CHANGE:` in commit body
- Or by `!` after the type (e.g., `feat!: remove old API`)
- Always listed first in changelogs with 💥 BREAKING CHANGES section

## 🛠️ Usage

### Manual Generation

Generate changelog for entire monorepo:

```bash
npm run changelog
```

Generate changelog since specific date/tag:

```bash
npm run changelog:since "2024-01-01"
npm run changelog:since "v1.0.0"
```

Generate package-specific changelog:

```bash
npm run changelog:package anglesite ./anglesite
npm run changelog:package anglesite-11ty ./anglesite-11ty
```

Generate release notes:

```bash
npm run changelog:release-notes 1.2.0 1.1.0
```

### GitHub Actions Integration

The changelog system integrates with several GitHub Actions workflows:

#### 1. Changelog Workflow (`.github/workflows/changelog.yml`)

- **Triggers**: Releases, version updates, manual dispatch, PRs
- **Automatic**: Runs on new releases and version bumps
- **Manual**: Can be triggered via GitHub Actions UI
- **PR Integration**: Shows changelog previews in pull request comments

#### 2. Release Workflow Integration

- Automatically generates release notes when creating GitHub releases
- Compares with previous version to show what changed
- Includes detailed statistics and categorized changes

### Workflow Triggers

| Trigger               | When                        | What Happens                               |
| --------------------- | --------------------------- | ------------------------------------------ |
| **Release Published** | New GitHub release          | Generates changelog and release notes      |
| **Version Bump**      | package.json version change | Updates main changelog                     |
| **Manual Dispatch**   | GitHub Actions UI           | Generates changelog with custom parameters |
| **Pull Request**      | PR opened/updated           | Shows changelog preview in comments        |

## ✍️ Writing Good Commit Messages

To get the best changelog output, follow conventional commit format:

### Format

```
type(scope): description

Optional body explaining the change

Optional footer with breaking changes or issue references
```

### Examples

**New Feature:**

```
feat(anglesite): add dark mode support

Implement dark mode toggle in settings panel with automatic
system preference detection.

Closes #123
```

**Bug Fix:**

```
fix(anglesite-11ty): resolve plugin loading race condition

Fix intermittent plugin loading failures by adding proper
initialization sequence and error handling.
```

**Breaking Change:**

```
feat(anglesite)!: redesign theme API

BREAKING CHANGE: Theme configuration format has changed.
Update your theme files to use the new schema.

Migrate from:
- theme.colors.primary
To:
- theme.palette.primary.main
```

**Documentation:**

```
docs: update installation instructions

Add troubleshooting section for common installation issues
and update system requirements.
```

## 📁 Generated Files

### Main Changelog (`CHANGELOG.md`)

- Comprehensive changelog for entire project
- Groups changes by category
- Includes commit hashes and links
- Shows contributor information

### Package Changelogs (`package/CHANGELOG.md`)

- Package-specific changes only
- Useful for understanding individual package evolution
- Generated for each workspace package

### Release Notes (`RELEASE_NOTES.md`)

- Generated during releases
- Includes version comparison statistics
- Formatted for GitHub releases
- Contains contributor acknowledgments

## 🎨 Customization

### Configuration

The changelog generator supports several configuration options:

```javascript
// Example usage in scripts
const { generateMonorepoChangelog } = require("./scripts/generate-changelog");

generateMonorepoChangelog({
  since: "2024-01-01", // Date/tag to start from
  outputPath: "CHANGELOG.md", // Output file path
  includePackages: true, // Include package-specific sections
  format: "markdown", // Output format
});
```

### Custom Commit Types

To add new commit types, modify the `categorizeCommitType()` function in `scripts/generate-changelog.js`:

```javascript
const categories = {
  feat: "features",
  fix: "fixes",
  security: "security", // Add custom type
  // ... other types
};
```

## 🔧 Troubleshooting

### Common Issues

**No changelog generated:**

- Check that you have conventional commit messages
- Ensure git history is available (not shallow clone)
- Verify the date/tag range includes commits

**Missing commits:**

- Check commit message format follows conventional commits
- Ensure commits are not merge commits (filtered out by default)
- Verify the path filter includes your changes

**GitHub Actions failing:**

- Check that repository has full git history (`fetch-depth: 0`)
- Ensure Node.js and dependencies are properly installed
- Verify file permissions for writing changelog files

### Debug Mode

For detailed debugging, modify the script to include more verbose logging:

```bash
DEBUG=1 npm run changelog
```

## 📚 Best Practices

1. **Use Conventional Commits**: Always follow the conventional commit format for automatic categorization
2. **Meaningful Scopes**: Use consistent scopes like `anglesite`, `anglesite-11ty`, etc.
3. **Clear Descriptions**: Write imperative descriptions that explain what the change does
4. **Document Breaking Changes**: Always document breaking changes in commit footer
5. **Regular Updates**: Let the automated system generate changelogs rather than manual updates
6. **Review Generated Content**: Check generated changelogs before releases

## 🤖 Automation Details

### Git Integration

- Uses `git log` with custom formatting to extract commit information
- Parses conventional commit format with regex patterns
- Groups commits by type and generates appropriate sections
- Links commits to GitHub repository for easy navigation

### Security Features

- Path validation prevents directory traversal
- Input sanitization for commit messages and file paths
- Resource limits prevent DoS from large repositories
- Safe file operations with error handling

### Performance

- Efficiently processes large git histories
- Caches parsed commit information
- Optimized file operations
- Parallel processing where possible

---

_This changelog system is part of the @dwk monorepo automation infrastructure. For technical details, see `scripts/generate-changelog.js`._
