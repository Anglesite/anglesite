// ABOUTME: Environment validation script to verify configuration across all environments
// ABOUTME: Checks required variables, validates values, and provides setup recommendations

const fs = require('fs');
const path = require('path');

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
 * Environment variable definitions with validation rules
 */
const ENV_DEFINITIONS = {
  // Core variables
  NODE_ENV: {
    required: true,
    values: ['development', 'test', 'production'],
    default: 'development',
    description: 'Node.js environment mode'
  },
  DEBUG: {
    required: false,
    type: 'boolean',
    default: 'false',
    description: 'Enable debug logging'
  },
  LOG_LEVEL: {
    required: false,
    values: ['error', 'warn', 'info', 'debug'],
    default: 'info',
    description: 'Application logging level'
  },
  
  // Build variables
  WEBPACK_MODE: {
    required: false,
    values: ['development', 'production'],
    default: 'development',
    description: 'Webpack build mode'
  },
  GENERATE_SOURCEMAP: {
    required: false,
    type: 'boolean',
    default: 'true',
    description: 'Generate source maps'
  },
  
  // Testing variables
  JEST_WORKERS: {
    required: false,
    type: 'string_or_number',
    default: '50%',
    description: 'Number of Jest workers'
  },
  TEST_TIMEOUT: {
    required: false,
    type: 'number',
    min: 1000,
    max: 300000,
    default: '5000',
    description: 'Default test timeout in milliseconds'
  },
  BENCHMARK_ITERATIONS: {
    required: false,
    type: 'number',
    min: 1,
    max: 100,
    default: '10',
    description: 'Performance test iterations'
  },
  
  // Anglesite variables
  ANGLESITE_AUTO_UPDATE: {
    required: false,
    type: 'boolean',
    default: 'true',
    description: 'Enable automatic updates'
  },
  ANGLESITE_TELEMETRY: {
    required: false,
    type: 'boolean',
    default: 'false',
    description: 'Enable telemetry collection'
  },
  
  // Security variables
  NPM_TOKEN: {
    required: false, // Required in CI/CD but not locally
    type: 'string',
    sensitive: true,
    minLength: 20,
    description: 'NPM authentication token'
  }
};

/**
 * Environment-specific requirements
 */
const ENV_REQUIREMENTS = {
  development: {
    required: ['NODE_ENV'],
    recommended: ['DEBUG', 'LOG_LEVEL', 'GENERATE_SOURCEMAP']
  },
  test: {
    required: ['NODE_ENV'],
    recommended: ['JEST_WORKERS', 'TEST_TIMEOUT', 'BENCHMARK_ITERATIONS']
  },
  production: {
    required: ['NODE_ENV'],
    recommended: ['LOG_LEVEL', 'ANGLESITE_AUTO_UPDATE', 'ANGLESITE_TELEMETRY']
  },
  ci: {
    required: ['NODE_ENV', 'CI'],
    recommended: ['NPM_TOKEN', 'JEST_WORKERS']
  }
};

/**
 * Detect current environment
 */
function detectEnvironment() {
  if (process.env.CI) return 'ci';
  if (process.env.NODE_ENV === 'test') return 'test';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

/**
 * Validate individual environment variable
 */
function validateVariable(name, value, definition) {
  const issues = [];
  
  // Check if required
  if (definition.required && !value) {
    issues.push({
      type: 'error',
      message: `Required variable ${name} is not set`
    });
    return issues;
  }
  
  // Skip further validation if not set and not required
  if (!value) return issues;
  
  // Validate type
  if (definition.type) {
    switch (definition.type) {
      case 'boolean':
        if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) {
          issues.push({
            type: 'error',
            message: `${name} should be a boolean (true/false), got: ${value}`
          });
        }
        break;
        
      case 'number':
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          issues.push({
            type: 'error',
            message: `${name} should be a number, got: ${value}`
          });
        } else {
          if (definition.min && num < definition.min) {
            issues.push({
              type: 'warning',
              message: `${name} is below recommended minimum (${definition.min}): ${num}`
            });
          }
          if (definition.max && num > definition.max) {
            issues.push({
              type: 'warning',
              message: `${name} is above recommended maximum (${definition.max}): ${num}`
            });
          }
        }
        break;
        
      case 'string_or_number':
        if (!value.match(/^\d+$/) && !value.match(/^\d+%$/)) {
          issues.push({
            type: 'warning',
            message: `${name} should be a number or percentage, got: ${value}`
          });
        }
        break;
    }
  }
  
  // Validate allowed values
  if (definition.values && !definition.values.includes(value)) {
    issues.push({
      type: 'error',
      message: `${name} has invalid value: ${value}. Allowed: ${definition.values.join(', ')}`
    });
  }
  
  // Validate string length for sensitive variables
  if (definition.sensitive && definition.minLength && value.length < definition.minLength) {
    issues.push({
      type: 'warning',
      message: `${name} appears too short (${value.length} characters)`
    });
  }
  
  return issues;
}

/**
 * Check environment file existence
 */
function checkEnvironmentFiles() {
  header('Environment Files Check');
  
  const files = [
    { path: '.env.example', required: true, description: 'Example environment file' },
    { path: '.env', required: false, description: 'Default environment file' },
    { path: '.env.local', required: false, description: 'Local overrides (gitignored)' },
    { path: '.env.development', required: false, description: 'Development environment' },
    { path: '.env.test', required: true, description: 'Test environment' },
    { path: '.env.production', required: true, description: 'Production environment' },
    { path: 'anglesite/.env.example', required: true, description: 'Anglesite example environment' }
  ];
  
  let allRequiredExists = true;
  
  files.forEach(file => {
    if (fs.existsSync(file.path)) {
      success(`${file.description}: ${file.path}`);
    } else if (file.required) {
      error(`Missing required file: ${file.path}`);
      allRequiredExists = false;
    } else {
      info(`Optional file not found: ${file.path}`);
    }
  });
  
  return allRequiredExists;
}

/**
 * Validate current environment configuration
 */
function validateCurrentEnvironment() {
  const env = detectEnvironment();
  header(`Current Environment Validation (${env})`);
  
  const requirements = ENV_REQUIREMENTS[env];
  let hasErrors = false;
  let hasWarnings = false;
  
  // Check required variables
  requirements.required.forEach(varName => {
    const value = process.env[varName];
    const definition = ENV_DEFINITIONS[varName] || {};
    
    const issues = validateVariable(varName, value, { ...definition, required: true });
    
    issues.forEach(issue => {
      if (issue.type === 'error') {
        error(issue.message);
        hasErrors = true;
      } else {
        warning(issue.message);
        hasWarnings = true;
      }
    });
    
    if (!issues.length) {
      success(`${varName}: ${definition.sensitive ? '[REDACTED]' : value || definition.default}`);
    }
  });
  
  // Check recommended variables
  info('\nRecommended variables:');
  requirements.recommended.forEach(varName => {
    const value = process.env[varName];
    const definition = ENV_DEFINITIONS[varName] || {};
    
    if (value) {
      const issues = validateVariable(varName, value, definition);
      if (issues.length === 0) {
        success(`${varName}: ${definition.sensitive ? '[REDACTED]' : value}`);
      } else {
        issues.forEach(issue => {
          if (issue.type === 'error') {
            error(issue.message);
            hasErrors = true;
          } else {
            warning(issue.message);
            hasWarnings = true;
          }
        });
      }
    } else {
      info(`${varName}: Not set (using default: ${definition.default || 'none'})`);
    }
  });
  
  return { hasErrors, hasWarnings };
}

/**
 * Check environment-specific configurations
 */
function checkEnvironmentSpecificConfig() {
  header('Environment-Specific Configuration');
  
  const currentEnv = process.env.NODE_ENV || 'development';
  
  // Development-specific checks
  if (currentEnv === 'development') {
    if (process.env.GENERATE_SOURCEMAP !== 'false') {
      success('Source maps enabled for development');
    } else {
      warning('Source maps disabled in development - debugging may be difficult');
    }
    
    if (process.env.DEBUG === 'true') {
      success('Debug logging enabled for development');
    }
  }
  
  // Production-specific checks
  if (currentEnv === 'production') {
    if (process.env.GENERATE_SOURCEMAP === 'false') {
      success('Source maps disabled for production');
    } else {
      warning('Source maps enabled in production - consider disabling for security');
    }
    
    if (process.env.DEBUG !== 'true') {
      success('Debug logging disabled for production');
    } else {
      warning('Debug logging enabled in production - may impact performance');
    }
  }
  
  // CI-specific checks
  if (process.env.CI) {
    if (process.env.NPM_TOKEN) {
      success('NPM_TOKEN configured for CI publishing');
    } else if (currentEnv === 'production') {
      warning('NPM_TOKEN not configured - publishing will fail');
    }
    
    if (process.env.JEST_WORKERS) {
      success(`Jest workers configured for CI: ${process.env.JEST_WORKERS}`);
    }
  }
}

/**
 * Check for common configuration issues
 */
function checkCommonIssues() {
  header('Common Configuration Issues Check');
  
  // Check for conflicting NODE_ENV and other settings
  const nodeEnv = process.env.NODE_ENV;
  const webpackMode = process.env.WEBPACK_MODE;
  
  if (nodeEnv === 'production' && webpackMode === 'development') {
    warning('NODE_ENV is production but WEBPACK_MODE is development');
  }
  
  if (nodeEnv === 'development' && webpackMode === 'production') {
    warning('NODE_ENV is development but WEBPACK_MODE is production');
  }
  
  // Check for performance test settings
  const iterations = parseInt(process.env.BENCHMARK_ITERATIONS || '10', 10);
  if (process.env.CI && iterations > 20) {
    warning(`High benchmark iterations in CI (${iterations}) may slow down builds`);
  }
  
  // Check for security issues
  if (process.env.NPM_TOKEN && !process.env.CI) {
    warning('NPM_TOKEN set in local environment - consider using .env.local');
  }
  
  // Check Jest configuration
  const jestWorkers = process.env.JEST_WORKERS;
  if (jestWorkers === '1' && !process.env.CI && nodeEnv !== 'test') {
    info('Jest workers set to 1 - tests will run slowly but more stable');
  }
}

/**
 * Generate environment setup recommendations
 */
function generateRecommendations(validation) {
  header('Setup Recommendations');
  
  const env = detectEnvironment();
  
  if (validation.hasErrors) {
    error('Configuration has errors that need to be fixed:');
    info('1. Review error messages above');
    info('2. Check docs/ENVIRONMENT_CONFIGURATION.md for guidance');
    info('3. Compare with .env.example files');
  }
  
  if (validation.hasWarnings) {
    warning('Configuration has warnings that should be addressed:');
    info('1. Review warning messages above');
    info('2. Consider updating configuration for better performance/security');
  }
  
  if (!validation.hasErrors && !validation.hasWarnings) {
    success('Configuration looks good!');
  }
  
  // Environment-specific recommendations
  info(`\nFor ${env} environment:`);
  
  switch (env) {
    case 'development':
      info('• Consider setting DEBUG=true for detailed logging');
      info('• Enable GENERATE_SOURCEMAP=true for easier debugging');
      info('• Copy .env.example to .env.local for customization');
      break;
      
    case 'test':
      info('• Use JEST_WORKERS=1 for more stable test execution');
      info('• Set lower BENCHMARK_ITERATIONS for faster tests');
      info('• Consider TEST_TIMEOUT adjustments for slow tests');
      break;
      
    case 'production':
      info('• Set GENERATE_SOURCEMAP=false for security');
      info('• Enable ANGLESITE_AUTO_UPDATE=true');
      info('• Configure ANGLESITE_TELEMETRY based on privacy policy');
      break;
      
    case 'ci':
      info('• Configure NPM_TOKEN secret for publishing');
      info('• Set appropriate JEST_WORKERS for parallel execution');
      info('• Enable security auditing with ENABLE_SECURITY_AUDIT=true');
      break;
  }
  
  info('\nNext steps:');
  info('• Review docs/ENVIRONMENT_CONFIGURATION.md for detailed guidance');
  info('• Update .env.local with your preferred local settings');
  info('• Test configuration with npm run test');
  info('• Run this validation again after making changes');
}

/**
 * Main validation function
 */
function main() {
  log(`${colors.bold}${colors.cyan}🌍 Environment Configuration Validator${colors.reset}`);
  log('Checking environment configuration for the @dwk monorepo\n');
  
  const currentEnv = detectEnvironment();
  info(`Detected environment: ${currentEnv}`);
  info(`Node.js version: ${process.version}`);
  info(`Platform: ${process.platform} ${process.arch}`);
  
  // Run all checks
  const filesOk = checkEnvironmentFiles();
  const validation = validateCurrentEnvironment();
  checkEnvironmentSpecificConfig();
  checkCommonIssues();
  generateRecommendations(validation);
  
  // Summary
  header('Validation Summary');
  
  if (filesOk && !validation.hasErrors) {
    success('✅ Environment configuration is valid');
    if (validation.hasWarnings) {
      warning('⚠️  Some warnings should be addressed');
    }
  } else {
    error('❌ Environment configuration has issues that need fixing');
  }
  
  return filesOk && !validation.hasErrors;
}

// Run validation if called directly
if (require.main === module) {
  const success = main();
  process.exit(success ? 0 : 1);
}

module.exports = {
  validateVariable,
  validateCurrentEnvironment,
  detectEnvironment,
  ENV_DEFINITIONS,
  ENV_REQUIREMENTS
};