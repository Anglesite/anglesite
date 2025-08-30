// ABOUTME: Secrets verification script to check NPM token configuration and permissions
// ABOUTME: Helps validate that required secrets are properly configured for CI/CD workflows

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
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
  log(`\n${colors.bold}${message}${colors.reset}`);
  log('='.repeat(message.length));
}

/**
 * Check if NPM token is available
 */
function checkNpmToken() {
  header('NPM Token Verification');
  
  const token = process.env.NPM_TOKEN;
  
  if (!token) {
    error('NPM_TOKEN environment variable not set');
    warning('To test locally, set NPM_TOKEN environment variable:');
    info('export NPM_TOKEN="your-token-here"');
    return false;
  }
  
  success('NPM_TOKEN environment variable is set');
  
  // Basic token format validation
  if (token.length < 20) {
    warning('NPM_TOKEN seems too short, verify it\'s a valid token');
    return false;
  }
  
  if (!token.startsWith('npm_')) {
    warning('NPM_TOKEN doesn\'t start with "npm_" - might be an old format token');
  } else {
    success('NPM_TOKEN appears to be in modern format (npm_...)');
  }
  
  return true;
}

/**
 * Test NPM authentication
 */
function testNpmAuth() {
  header('NPM Authentication Test');
  
  const token = process.env.NPM_TOKEN;
  if (!token) {
    error('NPM_TOKEN not available, skipping authentication test');
    return false;
  }
  
  try {
    // Create temporary .npmrc file
    const npmrcPath = path.join(process.cwd(), '.npmrc.tmp');
    const npmrcContent = `//registry.npmjs.org/:_authToken=${token}`;
    
    fs.writeFileSync(npmrcPath, npmrcContent);
    
    try {
      // Test authentication
      const result = execSync('npm whoami --registry https://registry.npmjs.org', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      
      success(`Authenticated as NPM user: ${result}`);
      return result;
    } catch (authError) {
      error('NPM authentication failed');
      error(authError.message);
      return false;
    } finally {
      // Clean up temporary .npmrc
      if (fs.existsSync(npmrcPath)) {
        fs.unlinkSync(npmrcPath);
      }
    }
  } catch (error) {
    error(`Error testing NPM authentication: ${error.message}`);
    return false;
  }
}

/**
 * Check organization access
 */
function checkOrgAccess() {
  header('Organization Access Check');
  
  const token = process.env.NPM_TOKEN;
  if (!token) {
    warning('NPM_TOKEN not available, skipping organization check');
    return false;
  }
  
  try {
    const npmrcPath = path.join(process.cwd(), '.npmrc.tmp');
    const npmrcContent = `//registry.npmjs.org/:_authToken=${token}`;
    fs.writeFileSync(npmrcPath, npmrcContent);
    
    try {
      // Check organization access
      const orgResult = execSync('npm org ls --registry https://registry.npmjs.org 2>/dev/null || echo "No organizations"', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      
      if (orgResult === 'No organizations') {
        warning('No NPM organizations found');
        warning('You may need to create or join the @dwk organization');
      } else {
        success('NPM organization access verified');
        info(`Organizations: ${orgResult}`);
      }
      
      // Check @dwk organization specifically
      try {
        const dwkResult = execSync('npm access list packages @dwk --registry https://registry.npmjs.org 2>/dev/null || echo "No @dwk access"', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        
        if (dwkResult === 'No @dwk access') {
          warning('@dwk organization access not found');
          warning('You may need to create the @dwk organization or get access to it');
        } else {
          success('@dwk organization access verified');
        }
      } catch (error) {
        warning('Could not check @dwk organization access');
      }
      
      return true;
    } finally {
      if (fs.existsSync(npmrcPath)) {
        fs.unlinkSync(npmrcPath);
      }
    }
  } catch (error) {
    error(`Error checking organization access: ${error.message}`);
    return false;
  }
}

/**
 * Verify package configurations
 */
function verifyPackageConfigs() {
  header('Package Configuration Verification');
  
  const packages = [
    { name: 'anglesite-11ty', path: './anglesite-11ty' },
    { name: 'anglesite-starter', path: './anglesite-starter' },
    { name: 'web-components', path: './web-components' }
  ];
  
  let allValid = true;
  
  packages.forEach(pkg => {
    const packageJsonPath = path.join(pkg.path, 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      warning(`${pkg.name}: package.json not found at ${packageJsonPath}`);
      allValid = false;
      return;
    }
    
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Check package name
      if (!packageJson.name) {
        error(`${pkg.name}: No name field in package.json`);
        allValid = false;
      } else if (!packageJson.name.startsWith('@dwk/')) {
        warning(`${pkg.name}: Package name doesn't start with @dwk/ scope: ${packageJson.name}`);
      } else {
        success(`${pkg.name}: Package name correctly scoped: ${packageJson.name}`);
      }
      
      // Check version
      if (!packageJson.version) {
        error(`${pkg.name}: No version field in package.json`);
        allValid = false;
      } else {
        info(`${pkg.name}: Current version: ${packageJson.version}`);
      }
      
      // Check publishConfig
      if (packageJson.publishConfig) {
        if (packageJson.publishConfig.access === 'public') {
          success(`${pkg.name}: Configured for public publishing`);
        } else {
          warning(`${pkg.name}: publishConfig.access is not set to 'public'`);
        }
      } else {
        info(`${pkg.name}: No publishConfig found (will use default settings)`);
      }
      
    } catch (error) {
      error(`${pkg.name}: Error reading package.json: ${error.message}`);
      allValid = false;
    }
  });
  
  return allValid;
}

/**
 * Check repository setup
 */
function checkRepositorySetup() {
  header('Repository Setup Verification');
  
  // Check if we're in a git repository
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    success('Git repository detected');
  } catch (error) {
    error('Not in a git repository');
    return false;
  }
  
  // Check for GitHub remote
  try {
    const remotes = execSync('git remote -v', { encoding: 'utf8' });
    if (remotes.includes('github.com')) {
      success('GitHub remote detected');
    } else {
      warning('No GitHub remote found');
    }
  } catch (error) {
    warning('Could not check git remotes');
  }
  
  // Check for required files
  const requiredFiles = [
    '.github/workflows/release.yml',
    '.github/workflows/changelog.yml',
    'scripts/generate-changelog.js',
    'package.json'
  ];
  
  requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
      success(`Required file found: ${file}`);
    } else {
      error(`Required file missing: ${file}`);
    }
  });
  
  return true;
}

/**
 * Generate setup recommendations
 */
function generateRecommendations() {
  header('Setup Recommendations');
  
  const token = process.env.NPM_TOKEN;
  
  if (!token) {
    info('To set up NPM_TOKEN for local testing:');
    info('1. Go to https://www.npmjs.com/settings/tokens');
    info('2. Generate a new Automation token');
    info('3. Export it: export NPM_TOKEN="your-token-here"');
    info('4. Run this script again to verify');
    console.log();
  }
  
  info('To configure GitHub repository secrets:');
  info('1. Go to your GitHub repository');
  info('2. Settings → Secrets and variables → Actions');
  info('3. Add new repository secret: NPM_TOKEN');
  info('4. Paste your NPM automation token as the value');
  console.log();
  
  info('For detailed setup instructions, see:');
  info('- docs/SECRETS_SETUP_GUIDE.md');
  console.log();
}

/**
 * Main verification function
 */
function main() {
  log(`${colors.bold}🔐 NPM Secrets Verification Tool${colors.reset}`);
  log('This tool helps verify your NPM token configuration for CI/CD workflows.\n');
  
  let allChecksPass = true;
  
  // Run all checks
  allChecksPass &= checkNpmToken();
  
  const username = testNpmAuth();
  if (!username) allChecksPass = false;
  
  allChecksPass &= checkOrgAccess();
  allChecksPass &= verifyPackageConfigs();
  allChecksPass &= checkRepositorySetup();
  
  // Summary
  header('Verification Summary');
  
  if (allChecksPass && username) {
    success('All checks passed! Your setup is ready for publishing.');
    info(`NPM user: ${username}`);
  } else {
    warning('Some checks failed or require attention.');
    warning('Review the output above and follow the setup guide.');
  }
  
  generateRecommendations();
  
  return allChecksPass;
}

// Run verification if called directly
if (require.main === module) {
  const success = main();
  process.exit(success ? 0 : 1);
}

module.exports = {
  checkNpmToken,
  testNpmAuth,
  checkOrgAccess,
  verifyPackageConfigs,
  checkRepositorySetup
};