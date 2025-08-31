#!/usr/bin/env node
// ABOUTME: Analyzes webpack bundle stats and provides a summary of key metrics
// ABOUTME: Processes bundle-stats.json to extract actionable insights about bundle optimization

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '..', 'dist', 'app', 'ui', 'react', 'bundle-stats.json');

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function analyzeBundleStats() {
  if (!fs.existsSync(STATS_FILE)) {
    console.error('❌ Bundle stats file not found at:', STATS_FILE);
    console.log('💡 Run "npm run analyze:bundle:stats" first to generate stats');
    process.exit(1);
  }

  console.log('📊 Bundle Analysis Summary\n');
  console.log('Reading stats from:', STATS_FILE.replace(process.cwd(), '.'));

  const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));

  // Overall bundle information
  const assets = stats.assets || [];
  const chunks = stats.chunks || [];
  const modules = stats.modules || [];

  console.log('\n📦 Bundle Overview:');
  console.log(`   Total Assets: ${assets.length}`);
  console.log(`   Total Chunks: ${chunks.length}`);
  console.log(`   Total Modules: ${modules.length}`);

  // Asset analysis
  const totalSize = assets.reduce((sum, asset) => sum + asset.size, 0);
  const jsAssets = assets.filter((asset) => asset.name.endsWith('.js'));
  const cssAssets = assets.filter((asset) => asset.name.endsWith('.css'));
  const imageAssets = assets.filter((asset) => /\.(png|jpg|jpeg|gif|svg|webp|avif)$/.test(asset.name));

  console.log('\n📈 Asset Breakdown:');
  console.log(`   Total Size: ${formatBytes(totalSize)}`);
  console.log(
    `   JavaScript: ${jsAssets.length} files, ${formatBytes(jsAssets.reduce((sum, asset) => sum + asset.size, 0))}`
  );
  console.log(
    `   CSS: ${cssAssets.length} files, ${formatBytes(cssAssets.reduce((sum, asset) => sum + asset.size, 0))}`
  );
  console.log(
    `   Images: ${imageAssets.length} files, ${formatBytes(imageAssets.reduce((sum, asset) => sum + asset.size, 0))}`
  );

  // Largest assets
  const largestAssets = assets.sort((a, b) => b.size - a.size).slice(0, 10);

  console.log('\n📊 Largest Assets:');
  largestAssets.forEach((asset, index) => {
    console.log(`   ${index + 1}. ${asset.name} - ${formatBytes(asset.size)}`);
  });

  // Chunk analysis
  const entryChunks = chunks.filter((chunk) => chunk.initial);
  const asyncChunks = chunks.filter((chunk) => !chunk.initial);

  console.log('\n⚡ Code Splitting:');
  console.log(`   Entry Chunks: ${entryChunks.length}`);
  console.log(`   Async Chunks: ${asyncChunks.length}`);

  // Performance budget check
  const PERFORMANCE_BUDGETS = {
    maxEntrypointSize: 512000, // 500KB
    maxAssetSize: 250000, // 250KB
  };

  const oversizedAssets = assets.filter((asset) => asset.size > PERFORMANCE_BUDGETS.maxAssetSize);
  const oversizedEntrypoints = entryChunks.filter((chunk) => {
    const chunkSize = chunk.files.reduce((sum, fileName) => {
      const asset = assets.find((a) => a.name === fileName);
      return sum + (asset ? asset.size : 0);
    }, 0);
    return chunkSize > PERFORMANCE_BUDGETS.maxEntrypointSize;
  });

  console.log('\n⚠️  Performance Budget Check:');
  if (oversizedAssets.length > 0) {
    console.log(`   Assets over ${formatBytes(PERFORMANCE_BUDGETS.maxAssetSize)} limit: ${oversizedAssets.length}`);
    oversizedAssets.slice(0, 5).forEach((asset) => {
      console.log(`     - ${asset.name}: ${formatBytes(asset.size)}`);
    });
  } else {
    console.log(`   ✅ All assets under ${formatBytes(PERFORMANCE_BUDGETS.maxAssetSize)} limit`);
  }

  if (oversizedEntrypoints.length > 0) {
    console.log(
      `   Entrypoints over ${formatBytes(PERFORMANCE_BUDGETS.maxEntrypointSize)} limit: ${oversizedEntrypoints.length}`
    );
  } else {
    console.log(`   ✅ All entrypoints under ${formatBytes(PERFORMANCE_BUDGETS.maxEntrypointSize)} limit`);
  }

  // Module analysis - find largest dependencies
  if (modules.length > 0) {
    const nodeModules = modules
      .filter((module) => module.name && module.name.includes('node_modules'))
      .map((module) => {
        const match = module.name.match(/node_modules[\/\\]([^\/\\]+)/);
        return {
          package: match ? match[1] : 'unknown',
          size: module.size || 0,
          name: module.name,
        };
      });

    const packageSizes = {};
    nodeModules.forEach((mod) => {
      packageSizes[mod.package] = (packageSizes[mod.package] || 0) + mod.size;
    });

    const largestPackages = Object.entries(packageSizes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    console.log('\n📦 Largest Dependencies:');
    largestPackages.forEach(([pkg, size], index) => {
      console.log(`   ${index + 1}. ${pkg} - ${formatBytes(size)}`);
    });
  }

  // Recommendations
  console.log('\n💡 Optimization Recommendations:');

  if (asyncChunks.length === 0) {
    console.log('   - Consider implementing code splitting for better performance');
  }

  if (oversizedAssets.length > 0) {
    console.log('   - Optimize large assets or implement lazy loading');
  }

  const totalJsSize = jsAssets.reduce((sum, asset) => sum + asset.size, 0);
  if (totalJsSize > 1000000) {
    // 1MB
    console.log('   - JavaScript bundle is large, consider code splitting');
  }

  console.log('   - Use "npm run analyze:bundle" for interactive analysis');
  console.log('   - Check the HTML report at dist/app/ui/react/bundle-report.html');

  console.log('\n✨ Analysis complete!');
}

if (require.main === module) {
  analyzeBundleStats();
}

module.exports = { analyzeBundleStats };
