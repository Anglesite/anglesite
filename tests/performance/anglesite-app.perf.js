// ABOUTME: Performance benchmarks for Anglesite Electron application
// ABOUTME: Tests application startup, file operations, and UI responsiveness

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

describe('Anglesite App Performance Benchmarks', () => {
  let testDir;
  let originalCwd;
  
  beforeAll(async () => {
    originalCwd = process.cwd();
    testDir = global.testUtils.createTempDir();
    
    // Ensure Anglesite app is built
    const anglesiteAppPath = path.join(originalCwd, 'anglesite');
    const appMainPath = path.join(anglesiteAppPath, 'dist', 'main.js');
    
    if (!fs.existsSync(appMainPath)) {
      console.log('Building Anglesite app for performance tests...');
      process.chdir(anglesiteAppPath);
      execSync('npm run build', { stdio: 'inherit' });
      process.chdir(originalCwd);
    }
  }, 120000);
  
  afterAll(async () => {
    process.chdir(originalCwd);
    global.testUtils.cleanupTempDir(testDir);
  });

  describe('Application Startup Performance', () => {
    test('should start within acceptable time', async () => {
      const anglesiteAppPath = path.join(originalCwd, 'anglesite');
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-app-startup',
        async () => {
          return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const electronProcess = spawn('npm', ['run', 'start', '--', '--no-sandbox', '--disable-gpu'], {
              cwd: anglesiteAppPath,
              env: {
                ...process.env,
                NODE_ENV: 'test',
                ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
              },
              stdio: 'pipe'
            });
            
            let appReady = false;
            const timeout = setTimeout(() => {
              if (!appReady) {
                electronProcess.kill('SIGTERM');
                reject(new Error('App startup timeout'));
              }
            }, 30000);
            
            electronProcess.stdout.on('data', (data) => {
              const output = data.toString();
              if (output.includes('Anglesite is ready') || output.includes('Window created')) {
                if (!appReady) {
                  appReady = true;
                  const endTime = Date.now();
                  clearTimeout(timeout);
                  
                  // Give it a moment to fully initialize
                  setTimeout(() => {
                    electronProcess.kill('SIGTERM');
                    resolve(endTime - startTime);
                  }, 1000);
                }
              }
            });
            
            electronProcess.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          });
        },
        { iterations: 3 }
      );
      
      expect(benchmark).toCompleteWithin(15000); // 15 seconds max startup
      expect(benchmark).toBeConsistent(0.3); // 30% variation allowed for Electron
      
      // Compare with baseline
      const baseline = global.performanceUtils.loadBaseline('anglesite-app-startup');
      if (baseline) {
        expect(benchmark).toNotRegressFrom(baseline, 25); // Max 25% regression
      } else {
        global.performanceUtils.saveBaseline('anglesite-app-startup', benchmark);
      }
    }, 120000);
  });

  describe('File System Operations Performance', () => {
    test('should handle large directory scans efficiently', async () => {
      // Create test directory structure
      const { tmpDir, files } = global.testUtils.createTempFiles(100, 2048);
      
      // Simulate directory scanning operations that Anglesite would perform
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-directory-scan',
        async () => {
          return new Promise((resolve) => {
            const fs = require('fs');
            const path = require('path');
            
            function scanDirectory(dir) {
              const items = fs.readdirSync(dir);
              const results = [];
              
              for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = fs.statSync(itemPath);
                
                results.push({
                  name: item,
                  path: itemPath,
                  size: stats.size,
                  isDirectory: stats.isDirectory(),
                  mtime: stats.mtime
                });
              }
              
              return results;
            }
            
            const results = scanDirectory(tmpDir);
            resolve(results.length);
          });
        },
        { iterations: 10 }
      );
      
      expect(benchmark).toCompleteWithin(500); // 500ms for 100 files
      expect(benchmark).toHaveThroughputOf(200); // At least 200 files/second
      
      // Cleanup
      global.testUtils.cleanupTempDir(tmpDir);
    });
    
    test('should process markdown files efficiently', async () => {
      // Create test markdown files
      const testMarkdownDir = path.join(testDir, 'markdown-perf');
      fs.mkdirSync(testMarkdownDir, { recursive: true });
      
      const markdownFiles = [];
      for (let i = 0; i < 50; i++) {
        const content = `# Test Document ${i}\n\n${generateMarkdownContent(2000)}\n`;
        const filePath = path.join(testMarkdownDir, `test-${i}.md`);
        fs.writeFileSync(filePath, content);
        markdownFiles.push(filePath);
      }
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-markdown-processing',
        async () => {
          // Simulate reading and parsing markdown files
          const results = [];
          
          for (const filePath of markdownFiles) {
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Basic front matter parsing simulation
            const lines = content.split('\n');
            const metadata = {
              file: filePath,
              lines: lines.length,
              size: content.length,
              words: content.split(/\s+/).length
            };
            
            results.push(metadata);
          }
          
          return results.length;
        },
        { iterations: 5 }
      );
      
      expect(benchmark).toCompleteWithin(2000); // 2 seconds for 50 files
      expect(benchmark).toUseMemoryWithin(50 * 1024 * 1024); // 50MB max
      expect(benchmark).toHaveThroughputOf(25); // At least 25 files/second
    });
  });

  describe('Website Building Performance', () => {
    test('should build website projects efficiently', async () => {
      // Create test website project
      const websiteDir = path.join(testDir, 'perf-website');
      await createTestWebsite(websiteDir, { pages: 25 });
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-website-build',
        async () => {
          process.chdir(websiteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
          
          // Verify build output
          const outputDir = path.join(websiteDir, '_site');
          const outputFiles = fs.readdirSync(outputDir);
          return outputFiles.length;
        },
        { iterations: 3 }
      );
      
      expect(benchmark).toCompleteWithin(10000); // 10 seconds for 25 pages
      expect(benchmark).toUseMemoryWithin(150 * 1024 * 1024); // 150MB max
      expect(benchmark).toHaveThroughputOf(2.5); // At least 2.5 pages/second
    });
    
    test('should handle concurrent builds efficiently', async () => {
      // Create multiple test projects
      const projectDirs = [];
      for (let i = 0; i < 3; i++) {
        const projectDir = path.join(testDir, `concurrent-project-${i}`);
        await createTestWebsite(projectDir, { pages: 10 });
        projectDirs.push(projectDir);
      }
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-concurrent-builds',
        async () => {
          // Start all builds concurrently
          const buildPromises = projectDirs.map(projectDir => {
            return new Promise((resolve, reject) => {
              const originalDir = process.cwd();
              process.chdir(projectDir);
              
              try {
                execSync('npx @11ty/eleventy', { stdio: 'pipe' });
                process.chdir(originalDir);
                resolve(true);
              } catch (error) {
                process.chdir(originalDir);
                reject(error);
              }
            });
          });
          
          await Promise.all(buildPromises);
          return projectDirs.length;
        },
        { iterations: 2 }
      );
      
      // Concurrent builds should complete within reasonable time
      expect(benchmark).toCompleteWithin(20000); // 20 seconds for 3 concurrent builds
      expect(benchmark).toUseMemoryWithin(400 * 1024 * 1024); // 400MB max for concurrent
    });
  });

  describe('Memory Management Performance', () => {
    test('should not leak memory during repeated operations', async () => {
      const websiteDir = path.join(testDir, 'memory-test-website');
      await createTestWebsite(websiteDir, { pages: 10 });
      
      const memoryMeasurements = [];
      
      // Perform multiple build cycles
      for (let i = 0; i < 5; i++) {
        const measurement = await global.performanceUtils.measureMemory(async () => {
          process.chdir(websiteDir);
          execSync('npx @11ty/eleventy', { stdio: 'pipe' });
        });
        
        memoryMeasurements.push(measurement.memory.heapUsed);
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Check for memory leaks
      const memoryTrend = calculateMemoryTrend(memoryMeasurements);
      expect(memoryTrend.slope).toBeLessThan(10 * 1024 * 1024); // Less than 10MB increase per build
      
      console.log(`📊 Memory trend: ${(memoryTrend.slope / 1024 / 1024).toFixed(2)}MB per operation`);
    });
    
    test('should handle large file operations without excessive memory usage', async () => {
      // Create large test files
      const largeFileDir = path.join(testDir, 'large-files');
      fs.mkdirSync(largeFileDir, { recursive: true });
      
      const largeFiles = [];
      for (let i = 0; i < 5; i++) {
        const filePath = path.join(largeFileDir, `large-file-${i}.txt`);
        const content = 'x'.repeat(1024 * 1024); // 1MB files
        fs.writeFileSync(filePath, content);
        largeFiles.push(filePath);
      }
      
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-large-file-processing',
        async () => {
          const results = [];
          
          for (const filePath of largeFiles) {
            const stats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            
            results.push({
              file: filePath,
              size: stats.size,
              processed: content.length
            });
          }
          
          return results.length;
        },
        { iterations: 3 }
      );
      
      expect(benchmark).toCompleteWithin(3000); // 3 seconds for 5MB
      expect(benchmark).toUseMemoryWithin(20 * 1024 * 1024); // 20MB max (not loading all in memory)
    });
  });

  describe('UI Responsiveness Simulation', () => {
    test('should maintain responsive performance under load', async () => {
      // Simulate UI operations that might occur during intensive tasks
      const benchmark = await global.performanceUtils.benchmark(
        'anglesite-ui-responsiveness',
        async () => {
          const operations = [];
          
          // Simulate various UI operations
          for (let i = 0; i < 100; i++) {
            operations.push(new Promise(resolve => {
              // Simulate DOM-like operations
              const data = { id: i, content: `Item ${i}` };
              const processed = JSON.stringify(data);
              const parsed = JSON.parse(processed);
              
              // Simulate async operation
              setTimeout(() => resolve(parsed), Math.random() * 10);
            }));
          }
          
          const results = await Promise.all(operations);
          return results.length;
        },
        { iterations: 5 }
      );
      
      expect(benchmark).toCompleteWithin(2000); // 2 seconds for 100 operations
      expect(benchmark).toHaveAcceptableLatencyDistribution(1500, 1800); // P95: 1.5s, P99: 1.8s
    });
  });
});

/**
 * Generate markdown content of specified length
 */
function generateMarkdownContent(targetLength) {
  const paragraphs = [];
  let currentLength = 0;
  
  const sampleParagraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
  
  while (currentLength < targetLength) {
    paragraphs.push(sampleParagraph);
    currentLength += sampleParagraph.length + 2; // +2 for newlines
  }
  
  return paragraphs.join('\n\n');
}

/**
 * Create test website for performance testing
 */
async function createTestWebsite(websiteDir, options = {}) {
  const { pages = 10 } = options;
  
  fs.mkdirSync(websiteDir, { recursive: true });
  fs.mkdirSync(path.join(websiteDir, 'src', '_data'), { recursive: true });
  
  process.chdir(websiteDir);
  
  // Create package.json
  fs.writeFileSync(path.join(websiteDir, 'package.json'), JSON.stringify({
    name: 'perf-test-website',
    version: '1.0.0',
    private: true
  }, null, 2));
  
  // Install anglesite-11ty
  const anglesitePackagePath = path.join(process.cwd(), '../../../anglesite-11ty');
  execSync(`npm install file:${anglesitePackagePath}`, { stdio: 'pipe' });
  
  // Create website configuration
  const websiteConfig = {
    site: {
      name: 'Performance Test Website',
      description: 'Website for performance testing',
      url: 'https://perf-test.example.com'
    },
    webStandards: {
      robots: { enabled: true },
      sitemap: { enabled: true },
      manifest: { enabled: true, name: 'Perf Test' }
    }
  };
  
  fs.writeFileSync(
    path.join(websiteDir, 'src', '_data', 'website.json'),
    JSON.stringify(websiteConfig, null, 2)
  );
  
  // Generate pages
  for (let i = 0; i < pages; i++) {
    const content = `---
title: Performance Test Page ${i + 1}
date: ${new Date().toISOString()}
---

# Performance Test Page ${i + 1}

${generateMarkdownContent(1500)}

## Navigation

${Array.from({ length: Math.min(pages, 10) }, (_, j) => 
  `- [Page ${j + 1}](../page-${j}/)`
).join('\n')}
`;
    
    fs.writeFileSync(path.join(websiteDir, 'src', `page-${i}.md`), content);
  }
  
  // Create index page
  const indexContent = `---
title: Performance Test Website
---

# Performance Test Website

This website contains ${pages} pages for performance testing.

## All Pages

${Array.from({ length: pages }, (_, i) => `- [Page ${i + 1}](page-${i}/)`).join('\n')}
`;
  
  fs.writeFileSync(path.join(websiteDir, 'src', 'index.md'), indexContent);
  
  // Create Eleventy config
  const eleventyConfig = `
const anglesiteConfig = require('@dwk/anglesite-11ty');

module.exports = function(eleventyConfig) {
  return anglesiteConfig(eleventyConfig);
};
`;
  
  fs.writeFileSync(path.join(websiteDir, '.eleventy.js'), eleventyConfig);
}

/**
 * Calculate memory usage trend
 */
function calculateMemoryTrend(measurements) {
  const n = measurements.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = measurements.reduce((sum, val) => sum + val, 0);
  const sumXY = measurements.reduce((sum, val, i) => sum + i * val, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}