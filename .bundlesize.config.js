// ABOUTME: Bundle size configuration for size limit enforcement across packages
// ABOUTME: Defines size budgets and thresholds for automated bundle size monitoring

module.exports = {
  // Global configuration
  threshold: '5%', // Default threshold for size increases
  compression: 'gzip',
  
  // Package-specific size limits
  files: [
    // Anglesite-11ty package limits
    {
      path: 'anglesite-11ty/dist/**/*.js',
      maxSize: '150KB',
      compression: 'gzip'
    },
    {
      path: 'anglesite-11ty/dist/**/*.css', 
      maxSize: '20KB',
      compression: 'gzip'
    },
    {
      path: 'anglesite-11ty/dist/index.js',
      maxSize: '100KB',
      compression: 'gzip'
    },
    
    // Anglesite starter package
    {
      path: 'anglesite-starter/dist/**/*',
      maxSize: '50KB',
      compression: 'gzip'
    },
    
    // Web components package
    {
      path: 'web-components/dist/**/*.js',
      maxSize: '80KB', 
      compression: 'gzip'
    },
    {
      path: 'web-components/dist/**/*.css',
      maxSize: '30KB',
      compression: 'gzip' 
    },
    
    // Anglesite Electron app (main process)
    {
      path: 'anglesite/dist/main.js',
      maxSize: '2MB',
      compression: 'none' // Electron apps don't benefit from gzip compression
    },
    {
      path: 'anglesite/dist/renderer.js',
      maxSize: '5MB', 
      compression: 'none'
    },
    {
      path: 'anglesite/dist/**/*.css',
      maxSize: '500KB',
      compression: 'gzip'
    }
  ],
  
  // CI/CD integration settings
  ci: {
    trackBranches: ['main', 'develop'],
    repoBranch: 'main',
    githubToken: process.env.BUNDLESIZE_GITHUB_TOKEN,
    buildScript: 'npm run build --workspaces',
    
    // Custom comparison settings
    comparison: {
      percentThreshold: 5,    // Alert on >5% size change
      absoluteThreshold: 5120, // Alert on >5KB absolute change
      ignorePatterns: [
        '*.map',              // Ignore source maps
        '*.d.ts',             // Ignore TypeScript definitions
        'test/**/*',          // Ignore test files
        '**/__tests__/**/*'   // Ignore test directories
      ]
    }
  },
  
  // Performance budget configuration
  performanceBudget: {
    // Network performance budgets (for web-facing packages)
    network: {
      // 3G network assumptions
      '3g': {
        maxSize: '170KB',     // ~1 second load time on 3G
        description: '3G network performance budget'
      },
      // 4G network assumptions  
      '4g': {
        maxSize: '500KB',     // ~1 second load time on 4G
        description: '4G network performance budget'
      }
    },
    
    // Bundle-specific budgets
    bundles: {
      'critical': {
        maxSize: '50KB',      // Critical path resources
        description: 'Critical path bundle budget'
      },
      'vendor': {
        maxSize: '200KB',     // Third-party dependencies
        description: 'Vendor bundle budget'
      },
      'app': {
        maxSize: '300KB',     // Application code
        description: 'Application bundle budget'
      }
    }
  },
  
  // Reporting configuration
  reporting: {
    format: ['json', 'table', 'github-comment'],
    outputPath: './bundle-size-report.json',
    
    // GitHub comment configuration
    github: {
      token: process.env.GITHUB_TOKEN,
      commentTemplate: {
        header: '## 📦 Bundle Size Report',
        showChanges: true,
        showRecommendations: true,
        includeDetails: false
      }
    },
    
    // Slack notification (if configured)
    slack: {
      webhook: process.env.SLACK_WEBHOOK_URL,
      channel: '#dev-notifications',
      onlyOnRegression: true
    }
  },
  
  // Analysis configuration  
  analysis: {
    // File types to analyze
    extensions: ['.js', '.ts', '.css', '.html'],
    
    // Compression methods to test
    compressions: ['gzip', 'brotli'],
    
    // Tree shaking analysis
    treeShaking: {
      enabled: true,
      reportUnusedExports: true
    },
    
    // Duplicate dependency detection
    duplicateDetection: {
      enabled: true,
      threshold: '1KB' // Report duplicates larger than 1KB
    }
  },
  
  // Package-specific overrides
  packageOverrides: {
    'anglesite-11ty': {
      threshold: '3%', // Stricter threshold for core package
      warningSize: '400KB',
      errorSize: '500KB'
    },
    
    'anglesite': {
      threshold: '10%', // More lenient for Electron app
      warningSize: '30MB', 
      errorSize: '50MB',
      // Electron-specific considerations
      electronSpecific: {
        includeNodeModules: false, // Don't count bundled node_modules
        checkAsar: true           // Check ASAR archive if present
      }
    },
    
    'web-components': {
      threshold: '5%',
      warningSize: '150KB',
      errorSize: '200KB',
      // Web component specific
      componentAnalysis: {
        perComponentLimit: '20KB',
        checkCustomElements: true
      }
    }
  },
  
  // Optimization recommendations
  optimizations: {
    // Suggestions based on size analysis
    suggestions: {
      treeshaking: {
        threshold: '50KB', // Suggest tree shaking for bundles >50KB
        message: 'Consider enabling tree shaking to remove unused code'
      },
      
      codeSplitting: {
        threshold: '200KB', // Suggest code splitting for bundles >200KB
        message: 'Consider code splitting to improve load performance'
      },
      
      compression: {
        threshold: '100KB', // Suggest compression for bundles >100KB  
        message: 'Enable gzip/brotli compression for better performance'
      },
      
      dependencies: {
        duplicateThreshold: 3, // Alert if >3 packages have duplicates
        message: 'Review dependency tree for potential duplicates'
      }
    }
  }
};