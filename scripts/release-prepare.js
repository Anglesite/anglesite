// ABOUTME: Script to prepare releases by validating readiness and generating release artifacts
// ABOUTME: Checks tests, security, builds, and generates comprehensive release notes

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
}

function warning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function header(message) {
  log(`\n${colors.bold}${colors.cyan}${message}${colors.reset}`);
  log('='.repeat(message.length), colors.cyan);
}

/**
 * Execute command and return output
 */
function exec(command, silent = false) {
  try {
    if (!silent) {
      info(`Running: ${command}`);
    }
    return execSync(command, { encoding: 'utf-8', stdio: silent ? 'pipe' : 'inherit' });
  } catch (error) {
    if (!silent) {
      error(`Command failed: ${command}`);
    }
    throw error;
  }
}

/**
 * Check if command exists
 */
function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current version from package.json
 */
function getCurrentVersion(packagePath = '.') {
  const pkgPath = path.join(packagePath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * Get all workspace packages
 */
function getWorkspaces() {
  try {
    const output = execSync('npm ls --json --workspaces --depth=0', { 
      encoding: 'utf-8',
      stdio: 'pipe' 
    });
    const data = JSON.parse(output);
    return Object.keys(data.dependencies || {}).filter(name => name.startsWith('@dwk/'));
  } catch {
    return [];
  }
}

/**
 * Check git status
 */
function checkGitStatus() {
  header('Git Status Check');
  
  // Check for uncommitted changes
  const status = execSync('git status --porcelain', { encoding: 'utf-8' });
  if (status.trim()) {
    error('Uncommitted changes detected:');
    console.log(status);
    return false;
  }
  success('Working directory clean');
  
  // Check current branch
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  info(`Current branch: ${branch}`);
  
  if (branch === 'main') {
    warning('On main branch - consider creating a release branch');
  }
  
  // Check if up to date with remote
  exec('git fetch', true);
  const behind = execSync('git rev-list HEAD..@{u} --count', { encoding: 'utf-8' }).trim();
  if (behind !== '0') {
    warning(`Branch is ${behind} commits behind remote`);
    return false;
  }
  success('Branch up to date with remote');
  
  return true;
}

/**
 * Run tests
 */
function runTests() {
  header('Running Tests');
  
  try {
    exec('npm test');
    success('All tests passed');
    return true;
  } catch (error) {
    error('Tests failed');
    return false;
  }
}

/**
 * Run security audit
 */
function runSecurityAudit() {
  header('Security Audit');
  
  try {
    const output = execSync('npm audit --json', { encoding: 'utf-8', stdio: 'pipe' });
    const audit = JSON.parse(output);
    
    if (audit.metadata.vulnerabilities.total === 0) {
      success('No vulnerabilities found');
      return true;
    }
    
    const { critical, high, moderate, low } = audit.metadata.vulnerabilities;
    
    if (critical > 0 || high > 0) {
      error(`Found ${critical} critical and ${high} high vulnerabilities`);
      return false;
    }
    
    if (moderate > 0) {
      warning(`Found ${moderate} moderate vulnerabilities`);
    }
    
    if (low > 0) {
      info(`Found ${low} low vulnerabilities`);
    }
    
    return critical === 0 && high === 0;
  } catch (error) {
    error('Security audit failed');
    return false;
  }
}

/**
 * Build all packages
 */
function buildPackages() {
  header('Building Packages');
  
  try {
    exec('npm run build');
    success('All packages built successfully');
    return true;
  } catch (error) {
    error('Build failed');
    return false;
  }
}

/**
 * Check bundle sizes
 */
function checkBundleSizes() {
  header('Bundle Size Check');
  
  const bundleScript = path.join(__dirname, 'analyze-bundle-sizes.js');
  if (!fs.existsSync(bundleScript)) {
    warning('Bundle size analysis script not found');
    return true;
  }
  
  try {
    exec(`node ${bundleScript}`);
    success('Bundle sizes within limits');
    return true;
  } catch (error) {
    warning('Bundle size check failed - review sizes carefully');
    return true; // Don't block release for bundle size
  }
}

/**
 * Generate changelog preview
 */
function generateChangelog() {
  header('Changelog Generation');
  
  const changelogScript = path.join(__dirname, 'generate-changelog.js');
  if (!fs.existsSync(changelogScript)) {
    warning('Changelog generation script not found');
    return true;
  }
  
  try {
    exec(`node ${changelogScript} --preview`);
    success('Changelog preview generated');
    return true;
  } catch (error) {
    warning('Changelog generation failed');
    return true; // Don't block release
  }
}

/**
 * Validate NPM access
 */
function validateNpmAccess() {
  header('NPM Access Validation');
  
  try {
    const whoami = execSync('npm whoami', { encoding: 'utf-8' }).trim();
    success(`Logged in as: ${whoami}`);
    
    // Check org membership
    const orgs = execSync('npm org ls @dwk', { encoding: 'utf-8', stdio: 'pipe' });
    if (orgs.includes(whoami)) {
      success('Has @dwk organization access');
      return true;
    } else {
      warning('May not have @dwk organization access');
      return false;
    }
  } catch (error) {
    error('Not logged in to NPM');
    info('Run: npm login');
    return false;
  }
}

/**
 * Check version conflicts
 */
function checkVersionConflicts() {
  header('Version Conflict Check');
  
  const workspaces = getWorkspaces();
  let hasConflicts = false;
  
  for (const pkg of workspaces) {
    const localVersion = getCurrentVersion(`node_modules/${pkg}`);
    
    try {
      const npmVersion = execSync(`npm view ${pkg} version`, { 
        encoding: 'utf-8',
        stdio: 'pipe' 
      }).trim();
      
      if (localVersion === npmVersion) {
        warning(`${pkg}@${localVersion} already exists on NPM`);
        hasConflicts = true;
      } else {
        success(`${pkg}@${localVersion} is new version (current: ${npmVersion})`);
      }
    } catch {
      info(`${pkg} not yet published to NPM`);
    }
  }
  
  return !hasConflicts;
}

/**
 * Create release checklist
 */
function createChecklist() {
  header('Release Checklist');
  
  const checklist = [
    { name: 'Git status clean', check: checkGitStatus },
    { name: 'Tests passing', check: runTests },
    { name: 'Security audit', check: runSecurityAudit },
    { name: 'Packages build', check: buildPackages },
    { name: 'Bundle sizes', check: checkBundleSizes },
    { name: 'NPM access', check: validateNpmAccess },
    { name: 'Version conflicts', check: checkVersionConflicts },
    { name: 'Changelog ready', check: generateChangelog }
  ];
  
  const results = [];
  let allPassed = true;
  
  for (const item of checklist) {
    const passed = item.check();
    results.push({ ...item, passed });
    if (!passed) {
      allPassed = false;
    }
  }
  
  // Summary
  header('Release Readiness Summary');
  
  for (const result of results) {
    if (result.passed) {
      success(`✓ ${result.name}`);
    } else {
      error(`✗ ${result.name}`);
    }
  }
  
  return allPassed;
}

/**
 * Main release preparation
 */
function main() {
  log(`${colors.bold}${colors.cyan}🚀 Release Preparation${colors.reset}`);
  log('Validating release readiness for @dwk monorepo\n');
  
  // Check prerequisites
  if (!commandExists('git')) {
    error('Git is not installed');
    process.exit(1);
  }
  
  if (!commandExists('npm')) {
    error('NPM is not installed');
    process.exit(1);
  }
  
  // Run checklist
  const ready = createChecklist();
  
  console.log();
  if (ready) {
    success('🎉 Release preparation complete - ready to release!');
    info('\nNext steps:');
    info('1. Review the changelog');
    info('2. Update version numbers: npm version <major|minor|patch>');
    info('3. Create release branch: git checkout -b release/vX.Y.Z');
    info('4. Push and create PR');
  } else {
    error('⚠️  Release preparation incomplete - address issues above');
    info('\nFix the issues and run this script again');
  }
  
  process.exit(ready ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  checkGitStatus,
  runTests,
  runSecurityAudit,
  buildPackages,
  validateNpmAccess
};