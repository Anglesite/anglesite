// ABOUTME: Automated changelog generation for monorepo packages and releases
// ABOUTME: Generates comprehensive changelogs from git history with conventional commit parsing

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Security-validated path resolver
 */
function validatePath(filePath, baseDir = __dirname) {
  const resolvedPath = path.resolve(filePath);
  const resolvedBaseDir = path.resolve(baseDir);
  
  if (!resolvedPath.startsWith(resolvedBaseDir)) {
    throw new Error(`Path outside base directory: ${filePath}`);
  }
  
  return resolvedPath;
}

/**
 * Parse conventional commit message
 * @param {string} message - Commit message
 * @returns {Object} Parsed commit information
 */
function parseConventionalCommit(message) {
  // Conventional commit pattern: type(scope): description
  const conventionalPattern = /^(\w+)(?:\(([^)]+)\))?: (.+)$/;
  const match = message.match(conventionalPattern);
  
  if (match) {
    const [, type, scope, description] = match;
    return {
      type,
      scope: scope || null,
      description,
      isConventional: true,
      isBreaking: message.includes('BREAKING CHANGE') || message.includes('!:'),
      category: categorizeCommitType(type)
    };
  }
  
  // Fallback parsing for non-conventional commits
  return {
    type: 'other',
    scope: null,
    description: message.split('\n')[0].trim(),
    isConventional: false,
    isBreaking: false,
    category: 'other'
  };
}

/**
 * Categorize commit type for changelog sections
 */
function categorizeCommitType(type) {
  const categories = {
    feat: 'features',
    fix: 'fixes',
    perf: 'performance',
    refactor: 'refactor',
    docs: 'documentation',
    test: 'testing',
    ci: 'ci',
    chore: 'chore',
    style: 'style',
    build: 'build'
  };
  
  return categories[type] || 'other';
}

/**
 * Get git commits since last tag or specific range
 */
function getCommits(since = null, packagePath = null) {
  try {
    let command = 'git log --format="%H|%s|%an|%ae|%ad|%B" --date=iso --no-merges';
    
    if (since) {
      // If since is a tag, get commits since that tag
      if (since.startsWith('v') || since.match(/^\d+\.\d+\.\d+/)) {
        command += ` ${since}..HEAD`;
      } else {
        command += ` --since="${since}"`;
      }
    } else {
      // Get commits since last tag
      try {
        const lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8' }).trim();
        if (lastTag) {
          command += ` ${lastTag}..HEAD`;
        } else {
          // No tags, get last 50 commits
          command += ' -n 50';
        }
      } catch {
        // No tags found, get last 50 commits
        command += ' -n 50';
      }
    }
    
    // Filter by package path if specified
    if (packagePath) {
      command += ` -- ${packagePath}`;
    }
    
    const output = execSync(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    
    if (!output.trim()) {
      return [];
    }
    
    return output.trim().split('\n\n').map(commitBlock => {
      const lines = commitBlock.split('\n');
      const [hash, subject, author, email, date] = lines[0].split('|');
      const body = lines.slice(1).join('\n').trim();
      
      const parsed = parseConventionalCommit(subject);
      
      return {
        hash: hash.substring(0, 7),
        fullHash: hash,
        subject,
        author,
        email,
        date: new Date(date),
        body,
        ...parsed
      };
    });
  } catch (error) {
    console.warn(`Warning: Could not get git commits: ${error.message}`);
    return [];
  }
}

/**
 * Group commits by category for changelog
 */
function groupCommitsByCategory(commits) {
  const groups = {
    breaking: [],
    features: [],
    fixes: [],
    performance: [],
    refactor: [],
    documentation: [],
    testing: [],
    ci: [],
    build: [],
    style: [],
    chore: [],
    other: []
  };
  
  commits.forEach(commit => {
    if (commit.isBreaking) {
      groups.breaking.push(commit);
    } else {
      groups[commit.category].push(commit);
    }
  });
  
  return groups;
}

/**
 * Format changelog section
 */
function formatChangelogSection(title, commits, options = {}) {
  if (commits.length === 0) return '';
  
  const { includeHash = true, includeAuthor = false, includeScope = true } = options;
  
  let section = `### ${title}\n\n`;
  
  commits.forEach(commit => {
    let line = '- ';
    
    // Add scope if available and requested
    if (includeScope && commit.scope) {
      line += `**${commit.scope}**: `;
    }
    
    // Add description
    line += commit.description;
    
    // Add hash if requested
    if (includeHash) {
      line += ` ([${commit.hash}](https://github.com/$REPO_OWNER/$REPO_NAME/commit/${commit.fullHash}))`;
    }
    
    // Add author if requested
    if (includeAuthor) {
      line += ` by @${commit.author}`;
    }
    
    section += line + '\n';
  });
  
  return section + '\n';
}

/**
 * Generate changelog for a package
 */
function generatePackageChangelog(packagePath, packageName, options = {}) {
  const {
    since = null,
    version = null,
    includeHash = true,
    includeAuthor = false,
    format = 'markdown'
  } = options;
  
  console.log(`📝 Generating changelog for ${packageName}...`);
  
  // Get commits for this package
  const commits = getCommits(since, packagePath);
  
  if (commits.length === 0) {
    console.log(`ℹ️  No commits found for ${packageName}`);
    return null;
  }
  
  // Group commits by category
  const groups = groupCommitsByCategory(commits);
  
  // Generate changelog content
  let changelog = '';
  
  // Header
  const versionHeader = version ? `v${version}` : 'Unreleased';
  const dateStr = new Date().toISOString().split('T')[0];
  changelog += `## ${versionHeader} (${dateStr})\n\n`;
  
  // Breaking changes first (most important)
  changelog += formatChangelogSection('💥 BREAKING CHANGES', groups.breaking, {
    includeHash,
    includeAuthor,
    includeScope: true
  });
  
  // Features
  changelog += formatChangelogSection('🚀 Features', groups.features, {
    includeHash,
    includeAuthor
  });
  
  // Bug fixes
  changelog += formatChangelogSection('🐛 Bug Fixes', groups.fixes, {
    includeHash,
    includeAuthor
  });
  
  // Performance improvements
  changelog += formatChangelogSection('⚡ Performance Improvements', groups.performance, {
    includeHash,
    includeAuthor
  });
  
  // Refactoring
  changelog += formatChangelogSection('♻️ Code Refactoring', groups.refactor, {
    includeHash,
    includeAuthor
  });
  
  // Documentation
  changelog += formatChangelogSection('📚 Documentation', groups.documentation, {
    includeHash,
    includeAuthor
  });
  
  // Testing
  changelog += formatChangelogSection('🧪 Tests', groups.testing, {
    includeHash,
    includeAuthor: false // Usually not interesting for users
  });
  
  // CI/CD
  changelog += formatChangelogSection('👷 Build System & CI', [...groups.ci, ...groups.build], {
    includeHash,
    includeAuthor: false
  });
  
  // Other changes
  const otherCommits = [...groups.style, ...groups.chore, ...groups.other];
  changelog += formatChangelogSection('🔧 Other Changes', otherCommits, {
    includeHash: false, // Usually not important enough for hash
    includeAuthor: false
  });
  
  return {
    packageName,
    version: versionHeader,
    date: dateStr,
    content: changelog,
    stats: {
      totalCommits: commits.length,
      breaking: groups.breaking.length,
      features: groups.features.length,
      fixes: groups.fixes.length,
      authors: [...new Set(commits.map(c => c.author))].length
    }
  };
}

/**
 * Generate comprehensive monorepo changelog
 */
function generateMonorepoChangelog(options = {}) {
  const {
    since = null,
    outputPath = 'CHANGELOG.md',
    includePackages = true,
    format = 'markdown'
  } = options;
  
  console.log('📋 Generating monorepo changelog...');
  
  // Define workspace packages
  const packages = [
    { name: 'anglesite', path: './anglesite' },
    { name: 'anglesite-11ty', path: './anglesite-11ty' },
    { name: 'anglesite-starter', path: './anglesite-starter' },
    { name: 'web-components', path: './web-components' }
  ];
  
  let fullChangelog = '';
  
  // Header
  fullChangelog += '# Changelog\n\n';
  fullChangelog += 'All notable changes to this project will be documented in this file.\n\n';
  fullChangelog += 'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\n';
  fullChangelog += 'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n';
  
  // Overall project changes
  const projectChangelog = generatePackageChangelog('.', '@dwk/monorepo', {
    since,
    includeHash: true,
    includeAuthor: true
  });
  
  if (projectChangelog) {
    fullChangelog += projectChangelog.content;
  }
  
  // Individual package changes
  if (includePackages) {
    const packageChangelogs = [];
    
    packages.forEach(pkg => {
      if (fs.existsSync(pkg.path)) {
        const pkgChangelog = generatePackageChangelog(pkg.path, pkg.name, {
          since,
          includeHash: true,
          includeAuthor: false
        });
        
        if (pkgChangelog) {
          packageChangelogs.push(pkgChangelog);
        }
      }
    });
    
    if (packageChangelogs.length > 0) {
      fullChangelog += '---\n\n## Package Changes\n\n';
      
      packageChangelogs.forEach(pkgLog => {
        fullChangelog += `### 📦 ${pkgLog.packageName}\n\n`;
        fullChangelog += pkgLog.content;
      });
    }
  }
  
  // Add generation metadata
  fullChangelog += '---\n\n';
  fullChangelog += `*This changelog was generated automatically on ${new Date().toISOString()}*\n`;
  
  // Write changelog file
  try {
    const safePath = validatePath(outputPath, process.cwd());
    fs.writeFileSync(safePath, fullChangelog, 'utf8');
    console.log(`✅ Changelog written to ${outputPath}`);
  } catch (error) {
    console.error(`❌ Error writing changelog: ${error.message}`);
    throw error;
  }
  
  return {
    outputPath,
    content: fullChangelog,
    stats: projectChangelog ? projectChangelog.stats : { totalCommits: 0 }
  };
}

/**
 * Generate release notes for GitHub releases
 */
function generateReleaseNotes(version, options = {}) {
  const {
    previousVersion = null,
    includePackageDetails = true,
    format = 'markdown'
  } = options;
  
  console.log(`🎉 Generating release notes for v${version}...`);
  
  // Get commits since previous version
  const since = previousVersion ? `v${previousVersion}` : null;
  
  // Generate changelog content
  const changelog = generatePackageChangelog('.', `@dwk/monorepo v${version}`, {
    since,
    version,
    includeHash: true,
    includeAuthor: true
  });
  
  if (!changelog) {
    throw new Error('No changes found for release notes');
  }
  
  let releaseNotes = '';
  
  // Release header
  releaseNotes += `# Release v${version}\n\n`;
  
  if (changelog.stats.breaking > 0) {
    releaseNotes += '🚨 **This release contains breaking changes. Please review the changelog carefully before updating.** 🚨\n\n';
  }
  
  // Quick stats
  releaseNotes += '## 📊 Release Statistics\n\n';
  releaseNotes += `- **${changelog.stats.totalCommits}** commits\n`;
  releaseNotes += `- **${changelog.stats.features}** new features\n`;
  releaseNotes += `- **${changelog.stats.fixes}** bug fixes\n`;
  releaseNotes += `- **${changelog.stats.breaking}** breaking changes\n`;
  releaseNotes += `- **${changelog.stats.authors}** contributors\n\n`;
  
  // Main changelog content
  releaseNotes += changelog.content;
  
  return {
    version,
    content: releaseNotes,
    stats: changelog.stats
  };
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    switch (command) {
      case 'changelog':
        const since = args[1] || null;
        const result = generateMonorepoChangelog({
          since,
          outputPath: args[2] || 'CHANGELOG.md'
        });
        console.log(`📋 Generated changelog with ${result.stats.totalCommits} commits`);
        break;
        
      case 'release-notes':
        const version = args[1];
        const previousVersion = args[2] || null;
        if (!version) {
          console.error('❌ Version required for release notes');
          process.exit(1);
        }
        const releaseNotes = generateReleaseNotes(version, { previousVersion });
        console.log('🎉 Release notes generated:');
        console.log(releaseNotes.content);
        break;
        
      case 'package':
        const packageName = args[1];
        const packagePath = args[2] || './';
        if (!packageName) {
          console.error('❌ Package name required');
          process.exit(1);
        }
        const pkgLog = generatePackageChangelog(packagePath, packageName);
        if (pkgLog) {
          console.log(pkgLog.content);
        }
        break;
        
      default:
        console.log('Usage:');
        console.log('  node generate-changelog.js changelog [since] [output-file]');
        console.log('  node generate-changelog.js release-notes <version> [previous-version]');
        console.log('  node generate-changelog.js package <name> [path]');
        break;
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  generateMonorepoChangelog,
  generatePackageChangelog,
  generateReleaseNotes,
  parseConventionalCommit,
  getCommits
};