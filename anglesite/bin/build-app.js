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
    const dirs = ['dist/src', 'dist/src/renderer', 'dist/src/renderer/ui/templates', 'dist/src/main/eleventy'];

    dirs.forEach((dir) => {
      fs.mkdirSync(dir, { recursive: true });
    });

    // Copy HTML files
    console.log('Copying HTML files...');
    copyFiles('src/renderer', 'dist/src/renderer', '*.html');

    // Copy CSS files
    console.log('Copying CSS files...');
    copyFiles('src/renderer', 'dist/src/renderer', '*.css');

    // Copy UI HTML files
    console.log('Copying UI HTML files...');
    copyFiles('src/renderer/ui', 'dist/src/renderer/ui', '*.html');

    // Copy UI templates
    console.log('Copying UI templates...');
    copyFiles('src/renderer/ui/templates', 'dist/src/renderer/ui/templates', '*.html');

    // Copy UI templates for main process
    console.log('Copying UI templates for main process...');
    copyDirectory('src/renderer/ui/templates', 'dist/src/main/ui/templates');
    copyFiles('src/renderer/ui', 'dist/src/main/ui', 'first-launch.html');

    // Inject static icons into templates
    console.log('Injecting static icons into templates...');
    const { injectStaticIcons } = require('./inject-static-icons');
    injectStaticIcons();

    // Sync Eleventy files
    console.log('Syncing Eleventy files...');
    copyDirectory('src/main/eleventy', 'dist/src/main/eleventy');

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

  // Create destination directory if it doesn't exist
  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

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
