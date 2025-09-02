#!/usr/bin/env node

const { execSync } = require('child_process');

/**
 * Build distribution packages for Anglesite.
 */
function distBuild() {
  const platform = process.argv[2];

  console.log('Starting distribution build...');

  try {
    // Clear cache
    console.log('Clearing cache...');
    execSync('node bin/clear-cache.js', { stdio: 'inherit' });

    // Build app
    console.log('Building application...');
    execSync('npm run build', { stdio: 'inherit' });

    // Build icons
    console.log('Building icons...');
    execSync('node bin/build-icons.js', { stdio: 'inherit' });

    // Run electron-builder with appropriate flags
    let builderCommand = 'npx electron-builder';

    switch (platform) {
      case 'mac':
        console.log('Building for macOS...');
        builderCommand += ' --mac';
        break;
      case 'win':
        console.log('Building for Windows...');
        builderCommand += ' --win';
        break;
      case 'linux':
        console.log('Building for Linux...');
        builderCommand += ' --linux';
        break;
      case 'dir':
        console.log('Building unpacked directory...');
        builderCommand += ' --dir';
        break;
      default:
        console.log('Building for all platforms...');
        break;
    }

    execSync(builderCommand, { stdio: 'inherit' });

    console.log('Distribution build complete!');
  } catch (error) {
    console.error('Distribution build failed:', error.message);
    process.exit(1);
  }
}

// Check if electron-builder is available
try {
  execSync('npx electron-builder --version', { stdio: 'ignore' });
} catch {
  console.error('Error: electron-builder not found. Please run "npm install" first.');
  process.exit(1);
}

// Run the build
if (require.main === module) {
  distBuild();
}
