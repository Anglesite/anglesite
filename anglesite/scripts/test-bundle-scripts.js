#!/usr/bin/env node
// ABOUTME: Tests all bundle analysis npm scripts to ensure they work correctly
// ABOUTME: Validates webpack-bundle-analyzer integration across different modes

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist', 'app', 'ui', 'react');

console.log('🧪 Testing Bundle Analyzer Integration\n');

const tests = [
  {
    name: 'Static Mode',
    script: 'ANALYZE_BUNDLE=true ANALYZER_MODE=static ANALYZER_OPEN=false npm run analyze:bundle',
    expectedFiles: ['bundle-report.html']
  },
  {
    name: 'JSON Mode', 
    script: 'ANALYZE_BUNDLE=true ANALYZER_MODE=json ANALYZER_OPEN=false npm run analyze:bundle',
    expectedFiles: []
  },
  {
    name: 'Stats Generation',
    script: 'npm run analyze:bundle:stats',
    expectedFiles: ['bundle-stats.json']
  },
  {
    name: 'CI Mode',
    script: 'npm run analyze:bundle:ci',
    expectedFiles: ['bundle-stats.json']
  }
];

let allPassed = true;

for (const test of tests) {
  try {
    console.log(`✅ Testing ${test.name}...`);
    
    // Run the command
    execSync(test.script, { 
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe'
    });
    
    // Check expected files exist
    for (const expectedFile of test.expectedFiles) {
      const filePath = path.join(DIST_DIR, expectedFile);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Expected file ${expectedFile} was not created`);
      }
    }
    
    console.log(`   ✓ ${test.name} working correctly\n`);
    
  } catch (error) {
    console.log(`   ❌ ${test.name} failed:`);
    console.log(`   Error: ${error.message}\n`);
    allPassed = false;
  }
}

// Test bundle summary script
try {
  console.log('✅ Testing Bundle Summary...');
  execSync('npm run analyze:summary', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe'
  });
  console.log('   ✓ Bundle summary working correctly\n');
} catch (error) {
  console.log('   ❌ Bundle summary failed:');
  console.log(`   Error: ${error.message}\n`);
  allPassed = false;
}

if (allPassed) {
  console.log('🎉 All bundle analyzer scripts are working correctly!');
  console.log('\nAvailable commands:');
  console.log('  npm run analyze:bundle         - Interactive server mode');
  console.log('  npm run analyze:bundle:static  - Generate HTML report');  
  console.log('  npm run analyze:bundle:json    - Generate JSON stats');
  console.log('  npm run analyze:bundle:gzip    - Analyze gzipped sizes');
  console.log('  npm run analyze:bundle:stats   - Generate detailed stats');
  console.log('  npm run analyze:bundle:ci      - CI-friendly analysis');
  console.log('  npm run analyze:summary        - Text summary of bundle');
  console.log('  npm run analyze:view           - Open HTML report');
  console.log('  npm run dev:react:analyze      - Development mode analysis');
  process.exit(0);
} else {
  console.log('❌ Some bundle analyzer scripts have issues.');
  process.exit(1);
}