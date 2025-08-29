#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Build the TypeScript application and copy required files.
 */
function buildApp() {
  console.log('Building TypeScript application...');

  try {
    // Compile TypeScript
    execSync('tsc', { stdio: 'inherit' });

    // Create necessary directories
    const dirs = ['dist/app', 'dist/app/ui/templates', 'dist/app/eleventy'];

    dirs.forEach((dir) => {
      fs.mkdirSync(dir, { recursive: true });
    });

    // Copy HTML files
    console.log('Copying HTML files...');
    copyFiles('app', 'dist/app', '*.html');

    // Copy CSS files
    console.log('Copying CSS files...');
    copyFiles('app', 'dist/app', '*.css');

    // Copy UI HTML files
    console.log('Copying UI HTML files...');
    copyFiles('app/ui', 'dist/app/ui', '*.html');

    // Copy UI templates
    console.log('Copying UI templates...');
    copyFiles('app/ui/templates', 'dist/app/ui/templates', '*.html');

    // Inject static icons into templates
    console.log('Injecting static icons into templates...');
    const { injectStaticIcons } = require('./inject-static-icons');
    injectStaticIcons();

    // Sync Eleventy files
    console.log('Syncing Eleventy files...');
    copyDirectory('app/eleventy', 'dist/app/eleventy');

    console.log('App build complete!');
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

/**
 * Copy files matching a pattern from source to destination.
 * @param src Source directory
 * @param dest Destination directory
 * @param pattern File pattern to match
 */
function copyFiles(src, dest, pattern) {
  const srcPath = path.resolve(src);
  const destPath = path.resolve(dest);

  if (!fs.existsSync(srcPath)) {
    return;
  }

  const files = fs.readdirSync(srcPath).filter((file) => {
    if (pattern === '*.html') return file.endsWith('.html');
    if (pattern === '*.css') return file.endsWith('.css');
    return true;
  });

  files.forEach((file) => {
    const srcFile = path.join(srcPath, file);
    const destFile = path.join(destPath, file);

    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
    }
  });
}

/**
 * Recursively copy a directory.
 * @param src Source directory
 * @param dest Destination directory
 */
function copyDirectory(src, dest) {
  const srcPath = path.resolve(src);
  const destPath = path.resolve(dest);

  if (!fs.existsSync(srcPath)) {
    return;
  }

  // Create destination directory
  fs.mkdirSync(destPath, { recursive: true });

  // Read all items in source directory
  const items = fs.readdirSync(srcPath);

  items.forEach((item) => {
    const srcItem = path.join(srcPath, item);
    const destItem = path.join(destPath, item);
    const stat = fs.statSync(srcItem);

    if (stat.isDirectory()) {
      // Recursively copy subdirectory
      copyDirectory(srcItem, destItem);
    } else if (stat.isFile()) {
      // Copy file
      fs.copyFileSync(srcItem, destItem);
    }
  });
}

// Run the build
if (require.main === module) {
  buildApp();
}
