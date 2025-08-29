#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Check if a file needs to be regenerated based on source file modification time.
 * @param sourcePath Path to the source file
 * @param outputPath Path to the output file
 * @returns True if output needs to be regenerated
 */
function needsRegeneration(sourcePath, outputPath) {
  if (!fs.existsSync(outputPath)) {
    return true; // Output doesn't exist, needs generation
  }

  const sourceStats = fs.statSync(sourcePath);
  const outputStats = fs.statSync(outputPath);

  // Regenerate if source is newer than output
  return sourceStats.mtime > outputStats.mtime;
}

/**
 * Generate application icons from SVG source.
 * Only generates icons that don't exist or are older than the source SVG.
 */
function buildIcons() {
  // Check if ImageMagick is installed
  try {
    execSync('magick -version', { stdio: 'ignore' });
  } catch {
    console.error('Error: ImageMagick is not installed. Please install it first.');
    console.error('On macOS: brew install imagemagick');
    console.error('On Ubuntu/Debian: sudo apt-get install imagemagick');
    process.exit(1);
  }

  // Check if source SVG exists
  const sourceSvg = path.join('icons', 'src', 'icon.svg');
  if (!fs.existsSync(sourceSvg)) {
    console.error(`Error: Source icon not found at ${sourceSvg}`);
    process.exit(1);
  }

  // Create icons directory if it doesn't exist
  console.log('Preparing icons directory...');
  fs.mkdirSync('icons', { recursive: true });

  // Check if main icon.svg needs updating
  const iconSvgOutput = path.join('icons', 'icon.svg');
  if (needsRegeneration(sourceSvg, iconSvgOutput)) {
    console.log('Copying source SVG to icons directory...');
    fs.copyFileSync(sourceSvg, iconSvgOutput);
  } else {
    console.log('Source SVG is up to date, skipping copy.');
  }

  // Icon sizes to generate
  const sizes = [
    { size: '1024x1024', output: 'icon.png' },
    { size: '512x512', output: 'icon@2x.png' },
    { size: '256x256', output: '256x256.png' },
    { size: '128x128', output: '128x128.png' },
    { size: '64x64', output: '64x64.png' },
    { size: '48x48', output: '48x48.png' },
    { size: '32x32', output: '32x32.png' },
    { size: '24x24', output: '24x24.png' },
    { size: '16x16', output: '16x16.png' },
  ];

  console.log('Checking icon sizes...');

  let generatedCount = 0;
  let skippedCount = 0;

  sizes.forEach(({ size, output }) => {
    const outputPath = path.join('icons', output);

    if (needsRegeneration(sourceSvg, outputPath)) {
      console.log(`  - Generating ${size} (${output})...`);

      try {
        execSync(`magick "${sourceSvg}" -resize ${size} "${outputPath}"`, { stdio: 'ignore' });
        generatedCount++;
      } catch (error) {
        console.error(`Failed to generate ${output}:`, error.message);
        process.exit(1);
      }
    } else {
      console.log(`  - ${output} is up to date, skipping.`);
      skippedCount++;
    }
  });

  if (generatedCount > 0) {
    console.log(`Icon generation complete! Generated ${generatedCount} icons, skipped ${skippedCount}.`);
  } else {
    console.log(`All icons are up to date! Skipped ${skippedCount} icons.`);
  }
}

// Run the build
if (require.main === module) {
  buildIcons();
}
