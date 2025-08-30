// ABOUTME: Bundle size comparison script for detecting regressions between versions
// ABOUTME: Compares current bundle sizes against baseline to identify significant changes

const fs = require('fs');

/**
 * Parse size string to bytes
 */
function parseSizeToBytes(sizeStr) {
  if (!sizeStr || sizeStr === 'N/A') return 0;
  
  const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?B)$/i);
  if (!match) return 0;
  
  const [, value, unit] = match;
  const multipliers = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024
  };
  
  return parseFloat(value) * (multipliers[unit.toUpperCase()] || 1);
}

/**
 * Format bytes to readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Calculate percentage change
 */
function calculatePercentChange(oldValue, newValue) {
  if (oldValue === 0) return newValue > 0 ? Infinity : 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Determine if a size change is significant
 */
function isSignificantChange(percentChange, absoluteChange, thresholds = {}) {
  const {
    percentThreshold = 5,    // 5% change threshold
    absoluteThreshold = 5120 // 5KB absolute change threshold
  } = thresholds;
  
  return Math.abs(percentChange) >= percentThreshold || 
         Math.abs(absoluteChange) >= absoluteThreshold;
}

/**
 * Compare package sizes between baseline and current
 */
function compareBundleSizes(baselineData, currentData) {
  const comparison = {
    timestamp: new Date().toISOString(),
    packages: {},
    summary: {
      totalPackages: 0,
      increasedPackages: 0,
      decreasedPackages: 0,
      significantChanges: 0,
      totalSizeChange: 0,
      totalSizeChangeFormatted: '',
      recommendations: []
    }
  };
  
  // Create maps for easier lookup
  const baselinePackages = new Map();
  const currentPackages = new Map();
  
  baselineData.packages.forEach(pkg => baselinePackages.set(pkg.name, pkg));
  currentData.packages.forEach(pkg => currentPackages.set(pkg.name, pkg));
  
  // Get all unique package names
  const allPackageNames = new Set([
    ...baselinePackages.keys(),
    ...currentPackages.keys()
  ]);
  
  comparison.summary.totalPackages = allPackageNames.size;
  
  for (const packageName of allPackageNames) {
    const baseline = baselinePackages.get(packageName);
    const current = currentPackages.get(packageName);
    
    const pkgComparison = {
      name: packageName,
      status: 'unchanged'
    };
    
    if (!baseline && current) {
      // New package
      pkgComparison.status = 'added';
      pkgComparison.current = {
        uncompressed: current.uncompressed,
        gzipped: current.gzipped,
        fileCount: current.fileCount
      };
    } else if (baseline && !current) {
      // Removed package
      pkgComparison.status = 'removed';
      pkgComparison.baseline = {
        uncompressed: baseline.uncompressed,
        gzipped: baseline.gzipped,
        fileCount: baseline.fileCount
      };
    } else if (baseline && current) {
      // Compare existing package
      const baselineBytes = parseSizeToBytes(baseline.uncompressed);
      const currentBytes = parseSizeToBytes(current.uncompressed);
      const baselineGzipped = parseSizeToBytes(baseline.gzipped);
      const currentGzipped = parseSizeToBytes(current.gzipped);
      
      const sizeChange = currentBytes - baselineBytes;
      const gzippedChange = currentGzipped - baselineGzipped;
      const percentChange = calculatePercentChange(baselineBytes, currentBytes);
      const gzippedPercentChange = calculatePercentChange(baselineGzipped, currentGzipped);
      
      pkgComparison.baseline = {
        uncompressed: baseline.uncompressed,
        uncompressedBytes: baselineBytes,
        gzipped: baseline.gzipped,
        gzippedBytes: baselineGzipped,
        fileCount: baseline.fileCount
      };
      
      pkgComparison.current = {
        uncompressed: current.uncompressed,
        uncompressedBytes: currentBytes,
        gzipped: current.gzipped,
        gzippedBytes: currentGzipped,
        fileCount: current.fileCount
      };
      
      pkgComparison.changes = {
        uncompressed: {
          absolute: sizeChange,
          absoluteFormatted: formatBytes(Math.abs(sizeChange)),
          percent: percentChange,
          significant: isSignificantChange(percentChange, sizeChange)
        },
        gzipped: {
          absolute: gzippedChange,
          absoluteFormatted: formatBytes(Math.abs(gzippedChange)),
          percent: gzippedPercentChange,
          significant: isSignificantChange(gzippedPercentChange, gzippedChange)
        },
        fileCount: current.fileCount - baseline.fileCount
      };
      
      // Determine overall status
      if (pkgComparison.changes.uncompressed.significant || pkgComparison.changes.gzipped.significant) {
        comparison.summary.significantChanges++;
        
        if (sizeChange > 0) {
          pkgComparison.status = 'increased';
          comparison.summary.increasedPackages++;
        } else {
          pkgComparison.status = 'decreased';
          comparison.summary.decreasedPackages++;
        }
      }
      
      comparison.summary.totalSizeChange += sizeChange;
    }
    
    comparison.packages[packageName] = pkgComparison;
  }
  
  comparison.summary.totalSizeChangeFormatted = formatBytes(Math.abs(comparison.summary.totalSizeChange));
  
  // Generate recommendations
  generateRecommendations(comparison);
  
  return comparison;
}

/**
 * Generate recommendations based on size changes
 */
function generateRecommendations(comparison) {
  const recommendations = [];
  
  let totalIncrease = 0;
  let packagesWithLargeIncrease = 0;
  
  for (const [packageName, pkgComp] of Object.entries(comparison.packages)) {
    if (pkgComp.changes?.uncompressed?.absolute > 0) {
      totalIncrease += pkgComp.changes.uncompressed.absolute;
      
      if (pkgComp.changes.uncompressed.percent > 20) {
        packagesWithLargeIncrease++;
        recommendations.push(`📈 **${packageName}** increased by ${pkgComp.changes.uncompressed.percent.toFixed(1)}% - consider optimization`);
      }
    }
  }
  
  if (totalIncrease > 50 * 1024) { // > 50KB total increase
    recommendations.push('🚨 **Total size increase > 50KB** - Review all package changes');
  }
  
  if (packagesWithLargeIncrease > 0) {
    recommendations.push(`🔍 **${packagesWithLargeIncrease} package(s)** with >20% size increase - investigate large changes`);
  }
  
  if (comparison.summary.significantChanges === 0) {
    recommendations.push('✅ **No significant size changes detected** - bundle size is stable');
  }
  
  // Bundle optimization recommendations
  if (totalIncrease > 10 * 1024) {
    recommendations.push('💡 **Consider bundle optimization techniques:**');
    recommendations.push('   - Tree shaking to remove unused code');
    recommendations.push('   - Code splitting for larger packages');
    recommendations.push('   - Dependency analysis to remove duplicates');
    recommendations.push('   - Compression optimization');
  }
  
  comparison.summary.recommendations = recommendations;
}

/**
 * Format comparison results for GitHub output
 */
function formatComparisonForGitHub(comparison) {
  let output = '';
  
  if (comparison.summary.significantChanges === 0) {
    output += '✅ **No significant bundle size changes detected**\n\n';
  } else {
    output += `📊 **Bundle Size Comparison Results**\n\n`;
    output += `- **Packages analyzed**: ${comparison.summary.totalPackages}\n`;
    output += `- **Significant changes**: ${comparison.summary.significantChanges}\n`;
    output += `- **Size increased**: ${comparison.summary.increasedPackages} packages\n`;
    output += `- **Size decreased**: ${comparison.summary.decreasedPackages} packages\n`;
    output += `- **Total size change**: ${comparison.summary.totalSizeChange >= 0 ? '+' : ''}${comparison.summary.totalSizeChangeFormatted}\n\n`;
  }
  
  // Package-specific changes
  const changedPackages = Object.entries(comparison.packages)
    .filter(([, pkg]) => pkg.status !== 'unchanged')
    .sort(([, a], [, b]) => {
      if (a.changes?.uncompressed?.absolute && b.changes?.uncompressed?.absolute) {
        return Math.abs(b.changes.uncompressed.absolute) - Math.abs(a.changes.uncompressed.absolute);
      }
      return 0;
    });
  
  if (changedPackages.length > 0) {
    output += '### Package Changes\n\n';
    output += '| Package | Baseline | Current | Change | % Change |\n';
    output += '|---------|----------|---------|--------|----------|\n';
    
    for (const [packageName, pkg] of changedPackages) {
      if (pkg.status === 'added') {
        output += `| ${packageName} | - | ${pkg.current.uncompressed} | ➕ New | - |\n`;
      } else if (pkg.status === 'removed') {
        output += `| ${packageName} | ${pkg.baseline.uncompressed} | - | ➖ Removed | - |\n`;
      } else if (pkg.changes?.uncompressed?.significant) {
        const change = pkg.changes.uncompressed;
        const arrow = change.absolute > 0 ? '📈' : '📉';
        const sign = change.absolute > 0 ? '+' : '';
        output += `| ${packageName} | ${pkg.baseline.uncompressed} | ${pkg.current.uncompressed} | ${arrow} ${sign}${change.absoluteFormatted} | ${change.percent.toFixed(1)}% |\n`;
      }
    }
    output += '\n';
  }
  
  // Recommendations
  if (comparison.summary.recommendations.length > 0) {
    output += '### Recommendations\n\n';
    for (const rec of comparison.summary.recommendations) {
      output += `${rec}\n`;
    }
    output += '\n';
  }
  
  return output;
}

// CLI usage
if (require.main === module) {
  const [, , baselineFile, currentFile] = process.argv;
  
  if (!baselineFile || !currentFile) {
    console.error('Usage: node compare-bundle-sizes.js <baseline.json> <current.json>');
    process.exit(1);
  }
  
  try {
    const baselineData = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    const currentData = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
    
    const comparison = compareBundleSizes(baselineData, currentData);
    
    // Output for GitHub Actions
    console.log(formatComparisonForGitHub(comparison));
    
    // Save detailed comparison
    fs.writeFileSync('size-comparison.json', JSON.stringify(comparison, null, 2));
    
    // Exit with non-zero if significant regressions detected
    const hasRegressions = Object.values(comparison.packages).some(pkg => 
      pkg.status === 'increased' && 
      pkg.changes?.uncompressed?.percent > 25 // More than 25% increase
    );
    
    if (hasRegressions) {
      console.error('\n🚨 Significant size regressions detected!');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Error comparing bundle sizes:', error.message);
    process.exit(1);
  }
}

module.exports = {
  compareBundleSizes,
  formatComparisonForGitHub,
  parseSizeToBytes,
  formatBytes,
  calculatePercentChange,
  isSignificantChange
};