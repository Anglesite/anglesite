// ABOUTME: Bundle size analysis script for monitoring package and build output sizes
// ABOUTME: Generates comprehensive size reports with gzipped and uncompressed metrics

const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');

// Security constants
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
const MAX_FILES_PER_DIRECTORY = 10000; // Prevent DoS from too many files
const ALLOWED_EXTENSIONS = ['.js', '.ts', '.tsx', '.jsx', '.css', '.scss', '.html', '.json', '.md'];
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Validate that a path is within the project directory and safe to access
 * @param {string} filePath - Path to validate
 * @param {string} baseDir - Base directory to restrict access to
 * @returns {string} - Resolved safe path
 * @throws {Error} - If path is unsafe
 */
function validatePath(filePath, baseDir = PROJECT_ROOT) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path provided');
  }
  
  // Resolve the path to prevent traversal attacks
  const resolvedPath = path.resolve(filePath);
  const resolvedBaseDir = path.resolve(baseDir);
  
  // Ensure the resolved path is within the base directory
  if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) && resolvedPath !== resolvedBaseDir) {
    throw new Error(`Path outside project directory: ${filePath}`);
  }
  
  // Additional security checks
  const relativePath = path.relative(resolvedBaseDir, resolvedPath);
  
  // Block paths with suspicious patterns
  if (relativePath.includes('..') || relativePath.includes('~') || relativePath.startsWith('/')) {
    throw new Error(`Suspicious path pattern detected: ${filePath}`);
  }
  
  return resolvedPath;
}

/**
 * Calculate file size with formatting
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get directory size recursively
 */
function getDirectorySize(dirPath, options = {}) {
  const { extensions = null, excludePatterns = [] } = options;
  let totalSize = 0;
  let fileCount = 0;
  const files = [];
  
  // Security: Enhanced exclude patterns
  const securityExcludePatterns = [
    ...excludePatterns,
    '.env', '.env.local', '.env.production',
    'id_rsa', 'id_dsa', '.ssh',
    '.git', '.svn', '.hg',
    'node_modules', '.cache'
  ];
  
  function traverseDirectory(currentPath, depth = 0) {
    try {
      // Security: Validate path
      const safePath = validatePath(currentPath);
      
      // Security: Prevent deep recursion DoS
      if (depth > 20) {
        console.warn(`Maximum directory depth exceeded: ${currentPath}`);
        return;
      }
      
      // Security: Check file count limit
      if (fileCount > MAX_FILES_PER_DIRECTORY) {
        console.warn(`Maximum file count exceeded in analysis`);
        return;
      }
      
      const items = fs.readdirSync(safePath);
      
      for (const item of items) {
        // Security: Basic filename validation
        if (item.includes('\0') || item.length > 255) {
          console.warn(`Suspicious filename skipped: ${item}`);
          continue;
        }
        
        const itemPath = path.join(safePath, item);
        
        // Security: Skip excluded patterns (case-insensitive)
        if (securityExcludePatterns.some(pattern => 
          itemPath.toLowerCase().includes(pattern.toLowerCase()))) {
          continue;
        }
        
        try {
          const stats = fs.statSync(itemPath);
          
          if (stats.isDirectory()) {
            traverseDirectory(itemPath, depth + 1);
          } else if (stats.isFile()) {
            // Security: File size limit
            if (stats.size > MAX_FILE_SIZE) {
              console.warn(`File too large, skipping: ${itemPath}`);
              continue;
            }
            
            // Check file extension if specified
            const fileExt = path.extname(item).toLowerCase();
            if (extensions && !extensions.map(ext => ext.toLowerCase()).includes(fileExt)) {
              continue;
            }
            
            // Security: Skip potentially dangerous files
            const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'];
            if (dangerousExtensions.includes(fileExt)) {
              console.warn(`Skipping potentially dangerous file: ${itemPath}`);
              continue;
            }
            
            const fileSize = stats.size;
            totalSize += fileSize;
            fileCount++;
            
            files.push({
              path: path.relative(dirPath, itemPath),
              size: fileSize,
              sizeFormatted: formatFileSize(fileSize)
            });
          }
        } catch (statError) {
          console.warn(`Could not stat ${itemPath}: ${statError.message}`);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${currentPath}: ${error.message}`);
    }
  }
  
  try {
    // Security: Validate directory path
    const safeDir = validatePath(dirPath);
    
    if (fs.existsSync(safeDir)) {
      traverseDirectory(safeDir);
    }
  } catch (error) {
    console.error(`Security validation failed for directory ${dirPath}: ${error.message}`);
    return {
      totalSize: 0,
      fileCount: 0,
      files: []
    };
  }
  
  return {
    totalSize,
    fileCount,
    files: files.sort((a, b) => b.size - a.size)
  };
}

/**
 * Calculate gzipped size for files with security validation
 * @param {string} filePath - Path to file
 * @returns {number} - Gzipped size in bytes
 */
function calculateGzippedSize(filePath) {
  try {
    // Validate path security
    const safePath = validatePath(filePath);
    
    // Check file exists and get stats
    const stats = fs.statSync(safePath);
    
    // Security: Check file size limit
    if (stats.size > MAX_FILE_SIZE) {
      console.warn(`File too large for gzip analysis: ${filePath} (${formatFileSize(stats.size)})`);
      return 0;
    }
    
    // Security: Check file extension is allowed
    const ext = path.extname(safePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext) && ext !== '') {
      console.warn(`Skipping file with disallowed extension: ${filePath}`);
      return 0;
    }
    
    const content = fs.readFileSync(safePath);
    const gzipped = gzipSync(content);
    return gzipped.length;
  } catch (error) {
    console.warn(`Could not analyze file ${filePath}: ${error.message}`);
    return 0;
  }
}

/**
 * Analyze package sizes
 */
function analyzePackageSize(packagePath, packageName) {
  // Security: Validate inputs
  if (!packagePath || !packageName) {
    throw new Error('Package path and name are required');
  }
  
  if (typeof packageName !== 'string' || packageName.length > 100) {
    throw new Error('Invalid package name');
  }
  
  // Security: Validate package name against injection
  if (!/^[@\w-\/\.]+$/.test(packageName)) {
    throw new Error(`Invalid package name format: ${packageName}`);
  }
  
  try {
    // Security: Validate paths
    const safePackagePath = validatePath(packagePath);
    const distPath = validatePath(path.join(safePackagePath, 'dist'));
    const buildPath = validatePath(path.join(safePackagePath, 'build'));
    const nodePath = validatePath(path.join(safePackagePath, 'node_modules'));
  
  // Determine output directory
  let outputPath = null;
  if (fs.existsSync(distPath)) {
    outputPath = distPath;
  } else if (fs.existsSync(buildPath)) {
    outputPath = buildPath;
  }
  
  const analysis = {
    name: packageName,
    path: packagePath,
    hasOutput: outputPath !== null
  };
  
  if (outputPath) {
    // Analyze build output
    const outputAnalysis = getDirectorySize(outputPath, {
      excludePatterns: ['node_modules', '.git', 'test', '__tests__']
    });
    
    analysis.output = {
      path: outputPath,
      uncompressed: outputAnalysis.totalSize,
      uncompressedFormatted: formatFileSize(outputAnalysis.totalSize),
      fileCount: outputAnalysis.fileCount,
      files: outputAnalysis.files
    };
    
    // Calculate gzipped size for main files
    let gzippedTotal = 0;
    const mainFiles = outputAnalysis.files.filter(file => 
      ['.js', '.css', '.html'].includes(path.extname(file.path))
    );
    
    for (const file of mainFiles) {
      try {
        const fullPath = path.join(outputPath, file.path);
        const gzippedSize = calculateGzippedSize(fullPath);
        gzippedTotal += gzippedSize;
        file.gzippedSize = gzippedSize;
        file.gzippedFormatted = formatFileSize(gzippedSize);
      } catch (error) {
        console.warn(`Could not analyze file ${file.path}: ${error.message}`);
        file.gzippedSize = 0;
        file.gzippedFormatted = 'Error';
      }
    }
    
    analysis.output.gzipped = gzippedTotal;
    analysis.output.gzippedFormatted = formatFileSize(gzippedTotal);
  }
  
  // Analyze source code size
  const srcPath = path.join(packagePath, 'src');
  const appPath = path.join(packagePath, 'app');
  
  let sourcePath = null;
  if (fs.existsSync(srcPath)) {
    sourcePath = srcPath;
  } else if (fs.existsSync(appPath)) {
    sourcePath = appPath;
  }
  
  if (sourcePath) {
    const sourceAnalysis = getDirectorySize(sourcePath, {
      extensions: ['.js', '.ts', '.tsx', '.jsx', '.css', '.scss', '.html'],
      excludePatterns: ['node_modules', '.git', 'test', '__tests__', 'dist', 'build']
    });
    
    analysis.source = {
      path: sourcePath,
      size: sourceAnalysis.totalSize,
      sizeFormatted: formatFileSize(sourceAnalysis.totalSize),
      fileCount: sourceAnalysis.fileCount,
      files: sourceAnalysis.files.slice(0, 10) // Top 10 largest files
    };
  }
  
    // Check package.json
    const packageJsonPath = path.join(safePackagePath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
        
        // Security: Limit JSON size to prevent DoS
        if (packageJsonContent.length > 100000) {
          console.warn(`package.json too large for ${packageName}`);
        } else {
          const packageJson = JSON.parse(packageJsonContent);
          
          // Security: Sanitize package.json data
          analysis.packageInfo = {
            version: typeof packageJson.version === 'string' ? packageJson.version.slice(0, 50) : 'unknown',
            dependencies: Object.keys(packageJson.dependencies || {}).length,
            devDependencies: Object.keys(packageJson.devDependencies || {}).length,
            main: typeof packageJson.main === 'string' ? packageJson.main.slice(0, 100) : undefined,
            files: Array.isArray(packageJson.files) ? packageJson.files.length : 0
          };
        }
      } catch (error) {
        console.warn(`Warning: Could not parse package.json for ${packageName}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`Security error analyzing package ${packageName}: ${error.message}`);
    return {
      name: packageName,
      path: packagePath,
      error: error.message,
      hasOutput: false
    };
  }
  
  return analysis;
}

/**
 * Analyze Electron app specifically
 */
function analyzeElectronApp(appPath) {
  try {
    // Security: Validate app path
    const safeAppPath = validatePath(appPath);
    
    const analysis = {
      name: 'anglesite-app',
      type: 'electron-app',
      path: safeAppPath
    };
  
  // Analyze app directory
  const appSrcPath = path.join(appPath, 'app');
  if (fs.existsSync(appSrcPath)) {
    const appAnalysis = getDirectorySize(appSrcPath, {
      extensions: ['.js', '.ts', '.tsx', '.html', '.css'],
      excludePatterns: ['node_modules', '.git', 'test', '__tests__']
    });
    
    analysis.app = {
      size: appAnalysis.totalSize,
      sizeFormatted: formatFileSize(appAnalysis.totalSize),
      fileCount: appAnalysis.fileCount,
      largestFiles: appAnalysis.files.slice(0, 5)
    };
  }
  
  // Analyze dist directory if it exists
  const distPath = path.join(appPath, 'dist');
  if (fs.existsSync(distPath)) {
    const distAnalysis = getDirectorySize(distPath, {
      excludePatterns: ['node_modules']
    });
    
    analysis.dist = {
      size: distAnalysis.totalSize,
      sizeFormatted: formatFileSize(distAnalysis.totalSize),
      fileCount: distAnalysis.fileCount
    };
  }
  
    // Check for built executables
    const buildDirs = ['build', 'out', 'release'];
    for (const buildDir of buildDirs) {
      try {
        const buildPath = path.join(safeAppPath, buildDir);
        if (fs.existsSync(buildPath)) {
          const buildAnalysis = getDirectorySize(buildPath);
          analysis[buildDir] = {
            size: buildAnalysis.totalSize,
            sizeFormatted: formatFileSize(buildAnalysis.totalSize),
            fileCount: buildAnalysis.fileCount
          };
        }
      } catch (error) {
        console.warn(`Could not analyze build directory ${buildDir}: ${error.message}`);
      }
    }
    
    return analysis;
  } catch (error) {
    console.error(`Security error analyzing Electron app: ${error.message}`);
    return {
      name: 'anglesite-app',
      type: 'electron-app', 
      error: error.message
    };
  }
}
  
  return analysis;
}

/**
 * Main analysis function with security validation
 */
function analyzeBundleSizes() {
  try {
    // Security: Validate current working directory is safe
    const rootDir = validatePath(process.cwd());
    
    // Security: Whitelist of allowed workspace names
    const allowedWorkspaces = [
      'anglesite-11ty',
      'anglesite-starter', 
      'web-components'
    ];
    
    // Security: Validate workspace names
    const workspaces = allowedWorkspaces.filter(ws => 
      typeof ws === 'string' && /^[a-zA-Z0-9-]+$/.test(ws)
    );
  
  const analysis = {
    timestamp: new Date().toISOString(),
    packages: [],
    total: {
      uncompressed: 0,
      gzipped: 0
    }
  };
  
    // Analyze workspace packages
    for (const workspace of workspaces) {
      try {
        const workspacePath = path.join(rootDir, workspace);
        if (fs.existsSync(workspacePath)) {
          const packageAnalysis = analyzePackageSize(workspacePath, workspace);
      
      // Format for summary
      const summaryData = {
        name: workspace,
        uncompressed: packageAnalysis.output?.uncompressedFormatted || 'N/A',
        uncompressedBytes: packageAnalysis.output?.uncompressed || 0,
        gzipped: packageAnalysis.output?.gzippedFormatted || 'N/A', 
        gzippedBytes: packageAnalysis.output?.gzipped || 0,
        fileCount: packageAnalysis.output?.fileCount || 0,
        hasSource: !!packageAnalysis.source,
        sourceSize: packageAnalysis.source?.sizeFormatted || 'N/A'
      };
      
          analysis.packages.push(summaryData);
          analysis.total.uncompressed += summaryData.uncompressedBytes;
          analysis.total.gzipped += summaryData.gzippedBytes;
          
          // Store detailed analysis
          analysis[workspace] = packageAnalysis;
        }
      } catch (error) {
        console.error(`Error analyzing workspace ${workspace}: ${error.message}`);
        // Add error entry to results
        analysis.packages.push({
          name: workspace,
          error: error.message,
          uncompressed: 'Error',
          gzipped: 'Error',
          fileCount: 0
        });
      }
    }
  
    // Analyze Anglesite Electron app
    try {
      const anglesiteAppPath = path.join(rootDir, 'anglesite');
      if (fs.existsSync(anglesiteAppPath)) {
        const appAnalysis = analyzeElectronApp(anglesiteAppPath);
        analysis.anglesiteApp = appAnalysis;
    
    // Add to summary if it has built output
    if (appAnalysis.dist) {
      const appSummary = {
        name: 'anglesite-app',
        uncompressed: appAnalysis.dist.sizeFormatted,
        uncompressedBytes: appAnalysis.dist.size,
        gzipped: 'N/A', // Electron apps don't compress the same way
        gzippedBytes: 0,
        fileCount: appAnalysis.dist.fileCount,
        type: 'electron-app'
      };
      
        analysis.packages.push(appSummary);
      }
    } catch (error) {
      console.error(`Error analyzing Anglesite app: ${error.message}`);
      analysis.anglesiteApp = { error: error.message };
    }
  
    // Format totals
    analysis.total.uncompressedFormatted = formatFileSize(analysis.total.uncompressed);
    analysis.total.gzippedFormatted = formatFileSize(analysis.total.gzipped);
    
    return analysis;
  } catch (error) {
    console.error(`Critical error in bundle analysis: ${error.message}`);
    return {
      timestamp: new Date().toISOString(),
      error: error.message,
      packages: [],
      total: {
        uncompressed: 0,
        gzipped: 0,
        uncompressedFormatted: '0 B',
        gzippedFormatted: '0 B'
      }
    };
  }
}

// Run analysis if called directly
if (require.main === module) {
  const analysis = analyzeBundleSizes();
  console.log(JSON.stringify(analysis, null, 2));
}

module.exports = {
  analyzeBundleSizes,
  analyzePackageSize,
  analyzeElectronApp,
  formatFileSize,
  getDirectorySize,
  calculateGzippedSize,
  validatePath  // Export for testing
};