// ABOUTME: Cache management utilities for build optimization and dependency caching
// ABOUTME: Provides cache warming, cleaning, and optimization strategies across the monorepo

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

/**
 * Cache Manager for optimizing build performance
 */
class CacheManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.cacheDir = options.cacheDir || path.join(this.rootDir, '.cache');
    this.workspaces = options.workspaces || this.detectWorkspaces();
    this.verbose = options.verbose || false;
    
    this.cacheConfig = {
      npm: {
        location: this.getNpmCacheLocation(),
        enabled: true
      },
      typescript: {
        location: path.join(this.cacheDir, 'typescript'),
        enabled: true
      },
      jest: {
        location: path.join(this.cacheDir, 'jest'),
        enabled: true
      },
      webpack: {
        location: path.join(this.cacheDir, 'webpack'),
        enabled: true
      },
      eleventy: {
        location: path.join(this.cacheDir, 'eleventy'),
        enabled: true
      }
    };
  }

  /**
   * Initialize cache directories and configuration
   */
  init() {
    this.log('Initializing cache management...');
    
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      this.log(`Created cache directory: ${this.cacheDir}`);
    }
    
    // Create cache subdirectories
    Object.values(this.cacheConfig).forEach(config => {
      if (config.enabled && !fs.existsSync(config.location)) {
        fs.mkdirSync(config.location, { recursive: true });
        this.log(`Created cache subdirectory: ${config.location}`);
      }
    });
    
    // Create cache info file
    this.writeCacheInfo();
    
    this.log('Cache initialization complete');
  }

  /**
   * Detect workspaces from package.json
   */
  detectWorkspaces() {
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8'));
      return packageJson.workspaces || [];
    } catch (error) {
      this.log(`Warning: Could not detect workspaces: ${error.message}`);
      return [];
    }
  }

  /**
   * Get NPM cache location
   */
  getNpmCacheLocation() {
    try {
      return execSync('npm config get cache', { encoding: 'utf8' }).trim();
    } catch (error) {
      return path.join(os.homedir(), '.npm');
    }
  }

  /**
   * Warm up caches by running common operations
   */
  async warmCaches(options = {}) {
    const {
      skipNpm = false,
      skipBuild = false,
      skipTests = false
    } = options;
    
    this.log('Starting cache warming process...');
    
    if (!skipNpm) {
      await this.warmNpmCache();
    }
    
    if (!skipBuild) {
      await this.warmBuildCaches();
    }
    
    if (!skipTests) {
      await this.warmTestCaches();
    }
    
    this.log('Cache warming complete');
  }

  /**
   * Warm NPM cache
   */
  async warmNpmCache() {
    this.log('Warming NPM cache...');
    
    try {
      // Install dependencies to populate cache
      execSync('npm ci', { 
        cwd: this.rootDir,
        stdio: this.verbose ? 'inherit' : 'pipe'
      });
      
      // Warm workspace caches
      for (const workspace of this.workspaces) {
        const workspaceDir = path.join(this.rootDir, workspace);
        if (fs.existsSync(path.join(workspaceDir, 'package.json'))) {
          this.log(`Warming cache for workspace: ${workspace}`);
          execSync('npm ci', {
            cwd: workspaceDir,
            stdio: this.verbose ? 'inherit' : 'pipe'
          });
        }
      }
      
      this.log('NPM cache warmed successfully');
    } catch (error) {
      this.log(`Warning: NPM cache warming failed: ${error.message}`);
    }
  }

  /**
   * Warm build caches
   */
  async warmBuildCaches() {
    this.log('Warming build caches...');
    
    try {
      // Run TypeScript compilation to populate cache
      if (fs.existsSync(path.join(this.rootDir, 'tsconfig.json'))) {
        execSync('npx tsc --noEmit', {
          cwd: this.rootDir,
          stdio: this.verbose ? 'inherit' : 'pipe',
          env: {
            ...process.env,
            TS_NODE_COMPILER_OPTIONS: JSON.stringify({
              incremental: true,
              tsBuildInfoFile: path.join(this.cacheConfig.typescript.location, '.tsbuildinfo')
            })
          }
        });
      }
      
      // Warm workspace build caches
      for (const workspace of this.workspaces) {
        const workspaceDir = path.join(this.rootDir, workspace);
        const tsconfigPath = path.join(workspaceDir, 'tsconfig.json');
        
        if (fs.existsSync(tsconfigPath)) {
          this.log(`Warming build cache for workspace: ${workspace}`);
          execSync('npx tsc --noEmit', {
            cwd: workspaceDir,
            stdio: this.verbose ? 'inherit' : 'pipe'
          });
        }
      }
      
      this.log('Build caches warmed successfully');
    } catch (error) {
      this.log(`Warning: Build cache warming failed: ${error.message}`);
    }
  }

  /**
   * Warm test caches
   */
  async warmTestCaches() {
    this.log('Warming test caches...');
    
    try {
      // Run Jest to populate cache
      if (fs.existsSync(path.join(this.rootDir, 'jest.config.js'))) {
        execSync('npx jest --passWithNoTests --cache --cacheDirectory=' + this.cacheConfig.jest.location, {
          cwd: this.rootDir,
          stdio: this.verbose ? 'inherit' : 'pipe'
        });
      }
      
      this.log('Test caches warmed successfully');
    } catch (error) {
      this.log(`Warning: Test cache warming failed: ${error.message}`);
    }
  }

  /**
   * Clean all caches
   */
  async cleanCaches(options = {}) {
    const {
      aggressive = false,
      keepNpmCache = false
    } = options;
    
    this.log('Starting cache cleanup...');
    
    // Clean build caches
    this.cleanDirectory(this.cacheConfig.typescript.location);
    this.cleanDirectory(this.cacheConfig.jest.location);
    this.cleanDirectory(this.cacheConfig.webpack.location);
    this.cleanDirectory(this.cacheConfig.eleventy.location);
    
    // Clean workspace build outputs
    for (const workspace of this.workspaces) {
      const workspaceDir = path.join(this.rootDir, workspace);
      
      // Common build output directories
      const buildDirs = ['dist', 'build', '_site', 'lib', 'out'];
      for (const buildDir of buildDirs) {
        const buildPath = path.join(workspaceDir, buildDir);
        this.cleanDirectory(buildPath);
      }
      
      // Clean TypeScript build info
      const tsBuildInfo = path.join(workspaceDir, '.tsbuildinfo');
      if (fs.existsSync(tsBuildInfo)) {
        fs.unlinkSync(tsBuildInfo);
        this.log(`Removed: ${tsBuildInfo}`);
      }
    }
    
    // Clean npm cache if requested
    if (!keepNpmCache) {
      try {
        execSync('npm cache clean --force', { 
          stdio: this.verbose ? 'inherit' : 'pipe' 
        });
        this.log('NPM cache cleaned');
      } catch (error) {
        this.log(`Warning: NPM cache clean failed: ${error.message}`);
      }
    }
    
    // Aggressive cleanup
    if (aggressive) {
      // Remove all node_modules
      this.cleanNodeModules();
      
      // Clean system-level caches
      this.cleanSystemCaches();
    }
    
    this.log('Cache cleanup complete');
  }

  /**
   * Clean specific directory
   */
  cleanDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        this.log(`Cleaned directory: ${dirPath}`);
      } catch (error) {
        this.log(`Warning: Could not clean ${dirPath}: ${error.message}`);
      }
    }
  }

  /**
   * Clean all node_modules directories
   */
  cleanNodeModules() {
    this.log('Cleaning node_modules directories...');
    
    // Root node_modules
    this.cleanDirectory(path.join(this.rootDir, 'node_modules'));
    
    // Workspace node_modules
    for (const workspace of this.workspaces) {
      const nodeModulesPath = path.join(this.rootDir, workspace, 'node_modules');
      this.cleanDirectory(nodeModulesPath);
    }
  }

  /**
   * Clean system-level caches
   */
  cleanSystemCaches() {
    this.log('Cleaning system-level caches...');
    
    try {
      // Clear npm cache
      execSync('npm cache clean --force', { stdio: 'pipe' });
      
      // Clear yarn cache if present
      try {
        execSync('yarn cache clean', { stdio: 'pipe' });
      } catch (error) {
        // Yarn might not be installed
      }
      
      this.log('System caches cleaned');
    } catch (error) {
      this.log(`Warning: System cache cleanup failed: ${error.message}`);
    }
  }

  /**
   * Analyze cache usage and performance
   */
  analyzeCaches() {
    this.log('Analyzing cache usage...');
    
    const analysis = {
      timestamp: new Date().toISOString(),
      cacheDirectories: {},
      totalSize: 0,
      recommendations: []
    };
    
    // Analyze each cache directory
    Object.entries(this.cacheConfig).forEach(([name, config]) => {
      if (fs.existsSync(config.location)) {
        const size = this.getDirectorySize(config.location);
        analysis.cacheDirectories[name] = {
          location: config.location,
          size: size,
          sizeFormatted: this.formatBytes(size),
          enabled: config.enabled
        };
        analysis.totalSize += size;
      }
    });
    
    analysis.totalSizeFormatted = this.formatBytes(analysis.totalSize);
    
    // Generate recommendations
    this.generateCacheRecommendations(analysis);
    
    // Write analysis to file
    const analysisPath = path.join(this.cacheDir, 'cache-analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
    
    this.log(`Cache analysis complete. Total cache size: ${analysis.totalSizeFormatted}`);
    this.log(`Analysis saved to: ${analysisPath}`);
    
    return analysis;
  }

  /**
   * Generate cache optimization recommendations
   */
  generateCacheRecommendations(analysis) {
    const recommendations = [];
    
    // Large cache directories
    Object.entries(analysis.cacheDirectories).forEach(([name, cache]) => {
      if (cache.size > 500 * 1024 * 1024) { // > 500MB
        recommendations.push({
          type: 'large_cache',
          cache: name,
          size: cache.sizeFormatted,
          message: `${name} cache is large (${cache.sizeFormatted}). Consider periodic cleanup.`
        });
      }
    });
    
    // Total cache size
    if (analysis.totalSize > 2 * 1024 * 1024 * 1024) { // > 2GB
      recommendations.push({
        type: 'total_size',
        size: analysis.totalSizeFormatted,
        message: `Total cache size is large (${analysis.totalSizeFormatted}). Consider aggressive cleanup.`
      });
    }
    
    // Missing caches
    Object.entries(this.cacheConfig).forEach(([name, config]) => {
      if (config.enabled && !analysis.cacheDirectories[name]) {
        recommendations.push({
          type: 'missing_cache',
          cache: name,
          message: `${name} cache directory not found. Consider warming caches.`
        });
      }
    });
    
    analysis.recommendations = recommendations;
  }

  /**
   * Get directory size recursively
   */
  getDirectorySize(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    
    let totalSize = 0;
    
    function calculateSize(currentPath) {
      const stats = fs.statSync(currentPath);
      
      if (stats.isDirectory()) {
        const files = fs.readdirSync(currentPath);
        files.forEach(file => {
          calculateSize(path.join(currentPath, file));
        });
      } else {
        totalSize += stats.size;
      }
    }
    
    try {
      calculateSize(dirPath);
    } catch (error) {
      // Handle permission errors
    }
    
    return totalSize;
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Write cache information file
   */
  writeCacheInfo() {
    const cacheInfo = {
      version: '1.0.0',
      created: new Date().toISOString(),
      configuration: this.cacheConfig,
      workspaces: this.workspaces
    };
    
    fs.writeFileSync(
      path.join(this.cacheDir, 'cache-info.json'),
      JSON.stringify(cacheInfo, null, 2)
    );
  }

  /**
   * Log messages with optional verbose mode
   */
  log(message) {
    if (this.verbose) {
      console.log(`[CacheManager] ${message}`);
    }
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const cacheManager = new CacheManager({ verbose: true });
  
  async function main() {
    switch (command) {
      case 'init':
        cacheManager.init();
        break;
        
      case 'warm':
        cacheManager.init();
        await cacheManager.warmCaches();
        break;
        
      case 'clean':
        const aggressive = process.argv.includes('--aggressive');
        const keepNpm = process.argv.includes('--keep-npm');
        await cacheManager.cleanCaches({ aggressive, keepNpmCache: keepNpm });
        break;
        
      case 'analyze':
        cacheManager.init();
        const analysis = cacheManager.analyzeCaches();
        
        console.log('\n📊 Cache Analysis Summary:');
        console.log(`Total cache size: ${analysis.totalSizeFormatted}`);
        console.log(`Cache directories: ${Object.keys(analysis.cacheDirectories).length}`);
        
        if (analysis.recommendations.length > 0) {
          console.log('\n💡 Recommendations:');
          analysis.recommendations.forEach(rec => {
            console.log(`  • ${rec.message}`);
          });
        }
        break;
        
      default:
        console.log('Usage: node cache-manager.js <command>');
        console.log('Commands:');
        console.log('  init     - Initialize cache directories');
        console.log('  warm     - Warm up all caches');
        console.log('  clean    - Clean caches (use --aggressive for deep clean)');
        console.log('  analyze  - Analyze cache usage and performance');
        console.log('');
        console.log('Options:');
        console.log('  --aggressive  - Aggressive cleanup (removes node_modules)');
        console.log('  --keep-npm    - Keep NPM cache during cleanup');
        process.exit(1);
    }
  }
  
  main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

module.exports = CacheManager;