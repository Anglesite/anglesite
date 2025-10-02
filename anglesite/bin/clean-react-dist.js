#!/usr/bin/env node

/**
 * Clean React dist directory before webpack build
 * Prevents webpack clean race condition (ENOTEMPTY errors)
 */

const path = require('path');
const fs = require('fs');

const distDir = path.join(__dirname, '..', 'dist', 'src', 'renderer', 'ui', 'react');

try {
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
    console.log('✅ Cleaned React dist directory:', distDir);
  } else {
    console.log('ℹ️  React dist directory already clean');
  }
} catch (error) {
  console.log('⚠️  Could not clean React dist:', error.message);
  // Don't fail the build, webpack will handle it
  process.exit(0);
}
