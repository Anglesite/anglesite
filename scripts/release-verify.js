// ABOUTME: Post-release verification script to ensure packages were published correctly
// ABOUTME: Validates NPM registry, GitHub releases, and installation testing

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

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
 * Get package version from package.json
 */
function getPackageVersion(packagePath = '.') {
  const pkgPath = path.join(packagePath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return { name: pkg.name, version: pkg.version };
}

/**
 * Get all workspace packages
 */
function getWorkspacePackages() {
  const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const packages = [];
  
  if (rootPkg.workspaces) {
    const workspaceDirs = rootPkg.workspaces.flatMap(pattern => {
      if (pattern.endsWith('/*')) {
        const dir = pattern.slice(0, -2);
        if (fs.existsSync(dir)) {
          return fs.readdirSync(dir)
            .map(subdir => path.join(dir, subdir))
            .filter(fullPath => fs.existsSync(path.join(fullPath, 'package.json')));
        }
      }
      return fs.existsSync(pattern) ? [pattern] : [];
    });
    
    for (const dir of workspaceDirs) {
      const pkg = getPackageVersion(dir);
      packages.push({ ...pkg, path: dir });
    }
  }
  
  return packages;
}

/**
 * Verify NPM publication
 */
async function verifyNpmPublication(packageName, expectedVersion) {
  try {
    const npmInfo = execSync(`npm view ${packageName} version`, { 
      encoding: 'utf-8',
      stdio: 'pipe' 
    }).trim();
    
    if (npmInfo === expectedVersion) {
      success(`${packageName}@${expectedVersion} is live on NPM`);
      return true;
    } else {
      error(`${packageName} version mismatch - Expected: ${expectedVersion}, Found: ${npmInfo}`);
      return false;
    }
  } catch (error) {
    error(`${packageName} not found on NPM registry`);
    return false;
  }
}

/**
 * Test package installation
 */
function testPackageInstallation(packageName, version) {
  const testDir = path.join(os.tmpdir(), `release-verify-${Date.now()}`);
  
  try {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
    
    // Initialize package.json
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-installation', version: '1.0.0' }, null, 2)
    );
    
    // Install package
    info(`Testing installation of ${packageName}@${version}`);
    execSync(`npm install ${packageName}@${version}`, {
      cwd: testDir,
      stdio: 'pipe'
    });
    
    // Verify installation
    const installedPkgPath = path.join(testDir, 'node_modules', packageName, 'package.json');
    if (fs.existsSync(installedPkgPath)) {
      const installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, 'utf-8'));
      if (installedPkg.version === version) {
        success(`${packageName}@${version} installs correctly`);
        return true;
      }
    }
    
    error(`${packageName}@${version} installation verification failed`);
    return false;
  } catch (error) {
    error(`Failed to install ${packageName}@${version}: ${error.message}`);
    return false;
  } finally {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

/**
 * Verify GitHub release
 */
function verifyGitHubRelease(version) {
  header('GitHub Release Verification');
  
  try {
    const releases = execSync('gh release list --limit 5', { 
      encoding: 'utf-8',
      stdio: 'pipe' 
    });
    
    const tagName = `v${version}`;
    if (releases.includes(tagName)) {
      success(`GitHub release ${tagName} exists`);
      
      // Get release details
      const releaseInfo = execSync(`gh release view ${tagName}`, {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      
      // Check for assets
      if (releaseInfo.includes('asset')) {
        success('Release has attached assets');
      } else {
        warning('Release has no attached assets');
      }
      
      return true;
    } else {
      error(`GitHub release ${tagName} not found`);
      return false;
    }
  } catch (error) {
    warning('Could not verify GitHub release (gh CLI may not be installed)');
    return null;
  }
}

/**
 * Verify git tags
 */
function verifyGitTags(version) {
  header('Git Tag Verification');
  
  const tagName = `v${version}`;
  
  try {
    // Check local tags
    const localTags = execSync('git tag -l', { encoding: 'utf-8' });
    if (!localTags.includes(tagName)) {
      error(`Local tag ${tagName} not found`);
      return false;
    }
    success(`Local tag ${tagName} exists`);
    
    // Check remote tags
    execSync('git fetch --tags', { stdio: 'pipe' });
    const remoteTags = execSync('git ls-remote --tags origin', { encoding: 'utf-8' });
    if (!remoteTags.includes(tagName)) {
      error(`Remote tag ${tagName} not found`);
      info('Run: git push origin --tags');
      return false;
    }
    success(`Remote tag ${tagName} exists`);
    
    return true;
  } catch (error) {
    error(`Tag verification failed: ${error.message}`);
    return false;
  }
}

/**
 * Check package dependencies
 */
function checkPackageDependencies(packages) {
  header('Dependency Resolution Check');
  
  const testDir = path.join(os.tmpdir(), `dep-check-${Date.now()}`);
  
  try {
    // Create test project
    fs.mkdirSync(testDir, { recursive: true });
    
    // Create package.json with all workspace packages
    const deps = {};
    for (const pkg of packages) {
      deps[pkg.name] = pkg.version;
    }
    
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'dependency-test',
        version: '1.0.0',
        dependencies: deps
      }, null, 2)
    );
    
    // Try to install
    info('Testing cross-package dependency resolution');
    execSync('npm install', {
      cwd: testDir,
      stdio: 'pipe'
    });
    
    success('All package dependencies resolve correctly');
    return true;
  } catch (error) {
    error('Package dependency resolution failed');
    console.log(error.message);
    return false;
  } finally {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

/**
 * Verify changelog
 */
function verifyChangelog(version) {
  header('Changelog Verification');
  
  const changelogPath = 'CHANGELOG.md';
  
  if (!fs.existsSync(changelogPath)) {
    error('CHANGELOG.md not found');
    return false;
  }
  
  const changelog = fs.readFileSync(changelogPath, 'utf-8');
  
  // Check for version entry
  if (changelog.includes(`## ${version}`) || changelog.includes(`## v${version}`)) {
    success(`Changelog contains entry for version ${version}`);
    return true;
  } else {
    error(`Changelog missing entry for version ${version}`);
    return false;
  }
}

/**
 * Main verification
 */
async function main() {
  log(`${colors.bold}${colors.cyan}🔍 Post-Release Verification${colors.reset}`);
  log('Verifying release deployment for @dwk monorepo\n');
  
  // Get workspace packages
  const packages = getWorkspacePackages();
  
  if (packages.length === 0) {
    error('No workspace packages found');
    process.exit(1);
  }
  
  info(`Found ${packages.length} packages to verify`);
  packages.forEach(pkg => info(`  - ${pkg.name}@${pkg.version}`));
  
  let allPassed = true;
  const results = {
    npm: [],
    installation: [],
    github: null,
    tags: null,
    dependencies: null,
    changelog: null
  };
  
  // Verify each package on NPM
  header('NPM Registry Verification');
  for (const pkg of packages) {
    const verified = await verifyNpmPublication(pkg.name, pkg.version);
    results.npm.push({ ...pkg, verified });
    if (!verified) allPassed = false;
  }
  
  // Test installations
  header('Installation Testing');
  for (const pkg of packages) {
    if (results.npm.find(p => p.name === pkg.name)?.verified) {
      const installed = testPackageInstallation(pkg.name, pkg.version);
      results.installation.push({ ...pkg, installed });
      if (!installed) allPassed = false;
    } else {
      info(`Skipping installation test for ${pkg.name} (not on NPM)`);
    }
  }
  
  // Verify GitHub release (use first package version)
  const mainVersion = packages[0].version;
  results.github = verifyGitHubRelease(mainVersion);
  if (results.github === false) allPassed = false;
  
  // Verify git tags
  results.tags = verifyGitTags(mainVersion);
  if (!results.tags) allPassed = false;
  
  // Check cross-package dependencies
  results.dependencies = checkPackageDependencies(packages);
  if (!results.dependencies) allPassed = false;
  
  // Verify changelog
  results.changelog = verifyChangelog(mainVersion);
  if (!results.changelog) allPassed = false;
  
  // Summary
  header('Verification Summary');
  
  // NPM results
  const npmSuccess = results.npm.filter(p => p.verified).length;
  if (npmSuccess === results.npm.length) {
    success(`NPM: All ${npmSuccess} packages published`);
  } else {
    error(`NPM: ${npmSuccess}/${results.npm.length} packages published`);
  }
  
  // Installation results
  const installSuccess = results.installation.filter(p => p.installed).length;
  if (installSuccess === results.installation.length) {
    success(`Installation: All ${installSuccess} packages install correctly`);
  } else {
    error(`Installation: ${installSuccess}/${results.installation.length} packages install`);
  }
  
  // Other checks
  if (results.github === true) success('GitHub release created');
  else if (results.github === false) error('GitHub release missing');
  
  if (results.tags) success('Git tags properly pushed');
  else error('Git tags not synchronized');
  
  if (results.dependencies) success('Package dependencies resolve');
  else error('Package dependency issues');
  
  if (results.changelog) success('Changelog updated');
  else error('Changelog not updated');
  
  // Final result
  console.log();
  if (allPassed) {
    success('🎉 Release verification passed - all packages deployed successfully!');
  } else {
    error('⚠️  Release verification failed - some issues need attention');
    info('\nTroubleshooting:');
    info('1. Check npm authentication: npm whoami');
    info('2. Verify git tags: git push origin --tags');
    info('3. Create GitHub release manually if needed');
    info('4. Review the release workflow logs');
  }
  
  process.exit(allPassed ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    error(`Verification failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  verifyNpmPublication,
  testPackageInstallation,
  verifyGitHubRelease,
  verifyGitTags
};