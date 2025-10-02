#!/usr/bin/env node

/**
 * Clear Anglesite application caches across platforms
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

function clearUserDataCache() {
  const platform = process.platform;
  let cacheDir;

  switch (platform) {
    case 'darwin':
      cacheDir = path.join(os.homedir(), 'Library', 'Application Support', '@dwk', 'anglesite');
      break;
    case 'win32':
      cacheDir = path.join(process.env.APPDATA || '', '@dwk', 'anglesite');
      break;
    default: // Linux and others
      cacheDir = path.join(os.homedir(), '.config', '@dwk', 'anglesite');
      break;
  }

  try {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log('✅ Cleared user data cache:', cacheDir);
    } else {
      console.log('ℹ️  User data cache already clear:', cacheDir);
    }
  } catch (error) {
    console.log('⚠️  Could not clear user data cache:', error.message);
  }
}

function clearWebpackCache() {
  const webpackCacheDir = path.join(__dirname, '..', 'node_modules', '.cache');

  try {
    if (fs.existsSync(webpackCacheDir)) {
      fs.rmSync(webpackCacheDir, { recursive: true, force: true });
      console.log('✅ Cleared webpack cache:', webpackCacheDir);
    } else {
      console.log('ℹ️  Webpack cache already clear:', webpackCacheDir);
    }
  } catch (error) {
    console.log('⚠️  Could not clear webpack cache:', error.message);
  }
}

function clearTempFiles() {
  const tempDirs = ['_site_temp', 'dist/', '_site'];

  tempDirs.forEach((dir) => {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log('✅ Cleared temp directory:', dir);
      } else {
        console.log('ℹ️  Temp directory already clear:', dir);
      }
    } catch (error) {
      console.log('⚠️  Could not clear temp directory:', dir, '-', error.message);
    }
  });
}

console.log('🧹 Clearing Anglesite caches...');
clearUserDataCache();
clearWebpackCache();
clearTempFiles();
console.log('✨ Cache clearing complete!');
