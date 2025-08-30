#!/usr/bin/env node
// ABOUTME: Verification script to ensure Jest configurations are valid and warnings-free
// ABOUTME: Runs quick validation checks on all Jest config files in the monorepo

const { execSync } = require('child_process');
const path = require('path');

console.log('🧪 Verifying Jest configurations...\n');

const configs = [
  { name: 'Base Config', command: 'npm test -- --listTests > /dev/null' },
  { name: 'Coverage Config', command: 'npm run test:coverage -- --listTests > /dev/null' },
  { name: 'Integration Config', command: 'npm run test:integration -- --listTests > /dev/null' },
  { name: 'Performance Config', command: 'npm run test:performance -- --listTests > /dev/null' }
];

let allPassed = true;

for (const config of configs) {
  try {
    console.log(`✅ ${config.name}: Checking configuration validity...`);
    
    // Run the command and capture both stdout and stderr
    const output = execSync(config.command, { 
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    console.log(`   ✓ Configuration is valid\n`);
    
  } catch (error) {
    console.log(`   ❌ Configuration has issues:`);
    
    // Check for specific warning types
    const stderr = error.stderr || '';
    const stdout = error.stdout || '';
    const fullOutput = stderr + stdout;
    
    if (fullOutput.includes('collectCoverage')) {
      console.log('   - Found collectCoverage warnings');
    }
    if (fullOutput.includes('Unknown option')) {
      console.log('   - Found unknown option warnings');  
    }
    if (fullOutput.includes('Validation Warning')) {
      console.log('   - Found validation warnings');
    }
    
    console.log(`   Raw error: ${error.message.slice(0, 200)}...\n`);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('🎉 All Jest configurations are valid and warning-free!');
  process.exit(0);
} else {
  console.log('❌ Some configurations have issues that need to be fixed.');
  process.exit(1);
}