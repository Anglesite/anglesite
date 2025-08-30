// ABOUTME: Performance benchmarks for anglesite-11ty package functionality
// ABOUTME: Tests build performance, plugin execution speed, and memory usage

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Anglesite-11ty Performance Benchmarks', () => {
  let testDir;
  let originalCwd;
  
  beforeAll(async () => {
    originalCwd = process.cwd();
    testDir = global.testUtils.createTempDir();
  });
  
  afterAll(async () => {
    process.chdir(originalCwd);
    global.testUtils.cleanupTempDir(testDir);
  });

  describe('Build Performance', () => {
    test('should build small site within performance budget', async () => {
      const siteDir = path.join(testDir, 'small-site');
      await setupTestSite(siteDir, { pages: 10 });
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-11ty-small-site-build',
        async () => {
          process.chdir(siteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 5 }
      );
      
      // Performance assertions
      expect(benchmark).toCompleteWithin(5000); // 5 seconds max
      expect(benchmark).toUseMemoryWithin(100 * 1024 * 1024); // 100MB max
      expect(benchmark).toBeConsistent(0.15); // 15% max variation
      
      // Compare with baseline if available
      const baseline = global.performanceUtils.loadBaseline('anglesite-11ty-small-site-build');
      if (baseline) {
        expect(benchmark).toNotRegressFrom(baseline, 20); // Max 20% regression
      } else {
        global.performanceUtils.saveBaseline('anglesite-11ty-small-site-build', benchmark);
      }
    });
    
    test('should scale linearly with page count', async () => {
      const pageCounts = [5, 10, 25, 50];
      const benchmarks = [];
      
      for (const pageCount of pageCounts) {
        const siteDir = path.join(testDir, `scaling-site-${pageCount}`);
        await setupTestSite(siteDir, { pages: pageCount });
        
        const benchmark = await global.performanceUtils.benchmark(
          `anglesite-11ty-${pageCount}-pages`,
          async () => {
            process.chdir(siteDir);
            execSync('npx @11ty/eleventy', { stdio: 'pipe' });
          },
          { iterations: 3 }
        );
        
        benchmarks.push(benchmark);
      }
      
      // Check linear scaling (within 30% tolerance due to overhead)
      expect(benchmarks).toScaleLinearly(pageCounts, 0.3);
      
      // Ensure largest site still meets performance budget
      const largestSiteBenchmark = benchmarks[benchmarks.length - 1];
      expect(largestSiteBenchmark).toCompleteWithin(15000); // 15 seconds for 50 pages
    });
    
    test('should handle large content efficiently', async () => {
      const siteDir = path.join(testDir, 'large-content-site');
      await setupTestSite(siteDir, { 
        pages: 20,
        contentSize: 5000, // 5KB per page
        includeAssets: true
      });
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-11ty-large-content',
        async () => {
          process.chdir(siteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 3 }
      );
      
      expect(benchmark).toCompleteWithin(10000); // 10 seconds
      expect(benchmark).toUseMemoryWithin(200 * 1024 * 1024); // 200MB
      expect(benchmark).toHaveThroughputOf(2); // At least 2 pages per second
    });
  });

  describe('Plugin Performance', () => {
    test('should execute all plugins efficiently', async () => {
      const siteDir = path.join(testDir, 'plugin-perf-site');
      await setupTestSite(siteDir, {
        pages: 15,
        enableAllPlugins: true
      });
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-11ty-all-plugins',
        async () => {
          process.chdir(siteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 5 }
      );
      
      expect(benchmark).toCompleteWithin(8000); // 8 seconds with all plugins
      expect(benchmark).toBeConsistent(0.2); // 20% variation max
      
      // Verify all plugin outputs were generated
      const outputDir = path.join(siteDir, '_site');
      expect(fs.existsSync(path.join(outputDir, 'robots.txt'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'sitemap.xml'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);
    });
    
    test('should have acceptable plugin overhead', async () => {
      // Test with plugins disabled
      const noPluginSiteDir = path.join(testDir, 'no-plugins');
      await setupTestSite(noPluginSiteDir, { 
        pages: 20, 
        enableAllPlugins: false 
      });
      
      const noPluginsBenchmark = await global.performanceUtils.benchmark(
        'anglesite-11ty-no-plugins',
        async () => {
          process.chdir(noPluginSiteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 5 }
      );
      
      // Test with plugins enabled
      const pluginSiteDir = path.join(testDir, 'with-plugins');
      await setupTestSite(pluginSiteDir, { 
        pages: 20, 
        enableAllPlugins: true 
      });
      
      const withPluginsBenchmark = await global.performanceUtils.benchmark(
        'anglesite-11ty-with-plugins',
        async () => {
          process.chdir(pluginSiteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 5 }
      );
      
      // Plugin overhead should be reasonable (less than 100% increase)
      const overhead = (withPluginsBenchmark.timing.avg - noPluginsBenchmark.timing.avg) / noPluginsBenchmark.timing.avg;
      expect(overhead).toBeLessThan(1.0); // Less than 100% overhead
      
      console.log(`📊 Plugin overhead: ${(overhead * 100).toFixed(1)}%`);
    });
  });

  describe('Memory Performance', () => {
    test('should not leak memory during repeated builds', async () => {
      const siteDir = path.join(testDir, 'memory-test-site');
      await setupTestSite(siteDir, { pages: 10 });
      
      const memoryMeasurements = [];
      
      for (let i = 0; i < 5; i++) {
        const measurement = await global.performanceUtils.measureMemory(async () => {
          process.chdir(siteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        });
        
        memoryMeasurements.push(measurement.memory.heapUsed);
      }
      
      // Check for memory leaks (memory usage shouldn't consistently increase)
      const memoryTrend = calculateTrend(memoryMeasurements);
      expect(memoryTrend.slope).toBeLessThan(5 * 1024 * 1024); // Less than 5MB increase per build
      
      console.log(`📈 Memory trend: ${(memoryTrend.slope / 1024 / 1024).toFixed(2)}MB per build`);
    });
    
    test('should handle large datasets efficiently', async () => {
      const siteDir = path.join(testDir, 'large-data-site');
      await setupTestSite(siteDir, {
        pages: 5,
        largeDataCollection: true // Add large JSON data
      });
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-11ty-large-data',
        async () => {
          process.chdir(siteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 3 }
      );
      
      // Should handle large data without excessive memory usage
      expect(benchmark).toUseMemoryWithin(300 * 1024 * 1024); // 300MB max
      expect(benchmark).toCompleteWithin(12000); // 12 seconds
    });
  });

  describe('Incremental Build Performance', () => {
    test('should rebuild efficiently on file changes', async () => {
      const siteDir = path.join(testDir, 'incremental-site');
      await setupTestSite(siteDir, { pages: 20 });
      
      process.chdir(siteDir);
      
      // Initial build
      const initialBuild = await global.performanceUtils.benchmark(
        'anglesite-11ty-initial-build',
        async () => {
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 1 }
      );
      
      // Modify one file
      const testFile = path.join(siteDir, 'src', 'page-1.md');
      fs.appendFileSync(testFile, '\n\n## Updated Content\n\nThis page was modified.');
      
      // Incremental build
      const incrementalBuild = await global.performanceUtils.benchmark(
        'anglesite-11ty-incremental-build',
        async () => {
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        },
        { iterations: 3 }
      );
      
      // Incremental build should be significantly faster
      const speedup = initialBuild.timing.avg / incrementalBuild.timing.avg;
      expect(speedup).toBeGreaterThan(2); // At least 2x faster
      
      console.log(`⚡ Incremental build speedup: ${speedup.toFixed(1)}x`);
    });
  });
});

/**
 * Helper function to setup test site with various configurations
 */
async function setupTestSite(siteDir, options = {}) {
  const {
    pages = 10,
    contentSize = 1000,
    includeAssets = false,
    enableAllPlugins = true,
    largeDataCollection = false
  } = options;
  
  fs.mkdirSync(siteDir, { recursive: true });
  fs.mkdirSync(path.join(siteDir, 'src', '_data'), { recursive: true });
  
  // Install anglesite-11ty
  process.chdir(siteDir);
  
  // Create package.json
  fs.writeFileSync(path.join(siteDir, 'package.json'), JSON.stringify({
    name: 'performance-test-site',
    version: '1.0.0',
    private: true
  }, null, 2));
  
  // Install anglesite-11ty from local package
  const anglesitePackagePath = path.join(process.cwd(), '../../../anglesite-11ty');
  execSync(`npm install file:${anglesitePackagePath}`, { stdio: 'pipe' });
  
  // Create website configuration
  const websiteConfig = {
    site: {
      name: `Performance Test Site`,
      description: 'A test site for performance benchmarking',
      url: 'https://perf-test.example.com'
    }
  };
  
  if (enableAllPlugins) {
    websiteConfig.webStandards = {
      robots: { enabled: true },
      sitemap: { enabled: true },
      manifest: { enabled: true, name: 'Perf Test' },
      browserconfig: { enabled: true }
    };
    websiteConfig.security = {
      headers: { csp: "default-src 'self'" }
    };
    websiteConfig.wellKnown = {
      hostMeta: { enabled: true }
    };
  }
  
  fs.writeFileSync(
    path.join(siteDir, 'src', '_data', 'website.json'),
    JSON.stringify(websiteConfig, null, 2)
  );
  
  // Create large data collection if requested
  if (largeDataCollection) {
    const largeData = global.testUtils.generateTestData(10000); // 10k items
    fs.writeFileSync(
      path.join(siteDir, 'src', '_data', 'largeCollection.json'),
      JSON.stringify(largeData, null, 2)
    );
  }
  
  // Generate test pages
  for (let i = 0; i < pages; i++) {
    const content = `---
title: Test Page ${i + 1}
date: ${new Date().toISOString()}
---

# Test Page ${i + 1}

${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(Math.floor(contentSize / 50))}

## Section ${i + 1}

This is page ${i + 1} of ${pages} in the performance test site.

- Item A
- Item B  
- Item C

### Subsection

More content to reach target size of approximately ${contentSize} characters.
`;
    
    fs.writeFileSync(path.join(siteDir, 'src', `page-${i}.md`), content);
  }
  
  // Create index page
  const indexContent = `---
title: Performance Test Site
---

# Performance Test Site

This site has ${pages} pages for performance testing.

## Pages

${Array.from({ length: pages }, (_, i) => `- [Page ${i + 1}](page-${i}/)`).join('\n')}
`;
  
  fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), indexContent);
  
  // Create Eleventy config
  const eleventyConfig = `
const anglesiteConfig = require('@dwk/anglesite-11ty');

module.exports = function(eleventyConfig) {
  return anglesiteConfig(eleventyConfig);
};
`;
  
  fs.writeFileSync(path.join(siteDir, '.eleventy.js'), eleventyConfig);
  
  // Add assets if requested
  if (includeAssets) {
    fs.mkdirSync(path.join(siteDir, 'src', 'assets'), { recursive: true });
    
    // Create dummy CSS file
    const cssContent = `
body { font-family: Arial, sans-serif; margin: 2rem; }
h1 { color: #333; }
h2 { color: #666; }
p { line-height: 1.6; }
    `.repeat(10); // Make it larger
    
    fs.writeFileSync(path.join(siteDir, 'src', 'assets', 'style.css'), cssContent);
    
    // Create dummy image files (small text files to simulate)
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(
        path.join(siteDir, 'src', 'assets', `image-${i}.txt`),
        'x'.repeat(1024) // 1KB fake image
      );
    }
  }
}

/**
 * Calculate linear trend from array of values
 */
function calculateTrend(values) {
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, val) => sum + val, 0);
  const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}