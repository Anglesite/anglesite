// ABOUTME: Integration tests for anglesite-11ty package functionality
// ABOUTME: Tests Eleventy configuration, plugins, and build processes in realistic scenarios

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Anglesite-11ty Integration', () => {
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
  
  beforeEach(() => {
    // Ensure we start from original directory for each test
    process.chdir(originalCwd);
  });

  describe('Package Installation and Configuration', () => {
    test('should install and configure anglesite-11ty package', async () => {
      // Create a test site directory
      const siteDir = path.join(testDir, 'test-site');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Initialize package.json
      fs.writeFileSync(path.join(siteDir, 'package.json'), JSON.stringify({
        name: 'test-site',
        version: '1.0.0',
        scripts: {
          build: 'eleventy',
          serve: 'eleventy --serve'
        }
      }, null, 2));
      
      // Install anglesite-11ty (link to local package)
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, { cwd: siteDir });
      
      // Verify installation
      const nodeModulesPath = path.join(siteDir, 'node_modules', '@dwk', 'anglesite-11ty');
      expect(fs.existsSync(nodeModulesPath)).toBe(true);
      
      // Check that key files are available
      expect(fs.existsSync(path.join(nodeModulesPath, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(nodeModulesPath, 'package.json'))).toBe(true);
    });
    
    test('should create valid Eleventy configuration', async () => {
      const siteDir = path.join(testDir, 'eleventy-config-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Create minimal .eleventy.js configuration
      const eleventyConfig = `
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        
        module.exports = function(eleventyConfig) {
          return anglesiteConfig(eleventyConfig);
        };
      `;
      fs.writeFileSync(path.join(siteDir, '.eleventy.js'), eleventyConfig);
      
      // Create basic site structure
      fs.mkdirSync(path.join(siteDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# Test Site\n\nHello World!');
      
      // Create website.json configuration
      const websiteConfig = {
        site: {
          name: 'Test Site',
          description: 'A test site for integration testing',
          url: 'https://test.example.com'
        },
        build: {
          input: 'src',
          output: '_site'
        }
      };
      fs.writeFileSync(
        path.join(siteDir, 'src', '_data', 'website.json'), 
        JSON.stringify(websiteConfig, null, 2)
      );
      
      // Test that configuration loads without errors
      expect(() => {
        require(path.join(siteDir, '.eleventy.js'));
      }).not.toThrow();
    });
  });

  describe('Build Process Integration', () => {
    test('should build a complete site with anglesite-11ty', async () => {
      const siteDir = path.join(testDir, 'build-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Copy anglesite-starter as base
      const starterPath = path.join(originalCwd, 'anglesite-starter');
      if (fs.existsSync(starterPath)) {
        global.testUtils.copyDirectory(starterPath, siteDir);
      }
      
      // Install dependencies
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, { 
        cwd: siteDir,
        stdio: 'inherit' 
      });
      
      // Run build
      const buildOutput = execSync('npx @11ty/eleventy', {
        cwd: siteDir,
        encoding: 'utf8'
      });
      
      // Verify build output
      expect(buildOutput).toContain('Wrote');
      expect(fs.existsSync(path.join(siteDir, '_site'))).toBe(true);
      expect(fs.existsSync(path.join(siteDir, '_site', 'index.html'))).toBe(true);
      
      // Check that HTML contains expected content
      const indexHtml = fs.readFileSync(path.join(siteDir, '_site', 'index.html'), 'utf8');
      expect(indexHtml).toMatch(/<html/);
      expect(indexHtml).toMatch(/<title>/);
    }, 60000); // Longer timeout for build process
    
    test('should generate required web standards files', async () => {
      const siteDir = path.join(testDir, 'webstandards-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Create minimal site with web standards configuration
      fs.mkdirSync(path.join(siteDir, 'src', '_data'), { recursive: true });
      
      const websiteConfig = {
        site: {
          name: 'Standards Test Site',
          description: 'Testing web standards generation',
          url: 'https://standards.example.com'
        },
        webStandards: {
          robots: {
            allow: ['*'],
            sitemap: '/sitemap.xml'
          },
          sitemap: {
            enabled: true
          },
          manifest: {
            enabled: true,
            name: 'Standards Test',
            shortName: 'Standards'
          }
        }
      };
      
      fs.writeFileSync(
        path.join(siteDir, 'src', '_data', 'website.json'),
        JSON.stringify(websiteConfig, null, 2)
      );
      
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# Standards Test');
      
      // Create Eleventy config
      const eleventyConfig = `
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        module.exports = function(eleventyConfig) {
          return anglesiteConfig(eleventyConfig);
        };
      `;
      fs.writeFileSync(path.join(siteDir, '.eleventy.js'), eleventyConfig);
      
      // Install and build
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, { cwd: siteDir });
      execSync('npx @11ty/eleventy', { cwd: siteDir });
      
      // Verify web standards files are generated
      const siteOutput = path.join(siteDir, '_site');
      expect(fs.existsSync(path.join(siteOutput, 'robots.txt'))).toBe(true);
      expect(fs.existsSync(path.join(siteOutput, 'sitemap.xml'))).toBe(true);
      expect(fs.existsSync(path.join(siteOutput, 'manifest.json'))).toBe(true);
      
      // Verify content of generated files
      const robotsTxt = fs.readFileSync(path.join(siteOutput, 'robots.txt'), 'utf8');
      expect(robotsTxt).toMatch(/User-agent: \*/);
      expect(robotsTxt).toMatch(/Sitemap:/);
      
      const manifest = JSON.parse(fs.readFileSync(path.join(siteOutput, 'manifest.json'), 'utf8'));
      expect(manifest.name).toBe('Standards Test');
      expect(manifest.short_name).toBe('Standards');
    }, 60000);
  });

  describe('Plugin System Integration', () => {
    test('should load and execute all anglesite-11ty plugins', async () => {
      const siteDir = path.join(testDir, 'plugins-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Create comprehensive website configuration to test all plugins
      fs.mkdirSync(path.join(siteDir, 'src', '_data'), { recursive: true });
      
      const websiteConfig = {
        site: {
          name: 'Plugin Test Site',
          description: 'Testing all anglesite-11ty plugins',
          url: 'https://plugins.example.com'
        },
        webStandards: {
          robots: { enabled: true },
          sitemap: { enabled: true },
          manifest: { enabled: true },
          browserconfig: { enabled: true }
        },
        security: {
          headers: {
            csp: "default-src 'self'",
            hsts: true
          }
        },
        wellKnown: {
          hostMeta: { enabled: true },
          webfinger: { enabled: true }
        }
      };
      
      fs.writeFileSync(
        path.join(siteDir, 'src', '_data', 'website.json'),
        JSON.stringify(websiteConfig, null, 2)
      );
      
      // Create test content
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# Plugin Test');
      fs.writeFileSync(path.join(siteDir, 'src', 'about.md'), '# About');
      
      // Create Eleventy config with debug logging
      const eleventyConfig = `
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        
        module.exports = function(eleventyConfig) {
          // Enable debug logging
          eleventyConfig.setQuietMode(false);
          
          const config = anglesiteConfig(eleventyConfig);
          
          // Verify that plugins are loaded
          console.log('Anglesite config applied');
          
          return config;
        };
      `;
      fs.writeFileSync(path.join(siteDir, '.eleventy.js'), eleventyConfig);
      
      // Install and build
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, { cwd: siteDir });
      
      const buildOutput = execSync('npx @11ty/eleventy', {
        cwd: siteDir,
        encoding: 'utf8'
      });
      
      // Verify build succeeded and plugins executed
      expect(buildOutput).toContain('Anglesite config applied');
      
      // Check that plugin-generated files exist
      const siteOutput = path.join(siteDir, '_site');
      expect(fs.existsSync(path.join(siteOutput, 'robots.txt'))).toBe(true);
      expect(fs.existsSync(path.join(siteOutput, 'sitemap.xml'))).toBe(true);
      expect(fs.existsSync(path.join(siteOutput, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(siteOutput, 'browserconfig.xml'))).toBe(true);
      expect(fs.existsSync(path.join(siteOutput, '.well-known', 'host-meta'))).toBe(true);
    }, 90000);
  });

  describe('Schema Validation Integration', () => {
    test('should validate website.json against schema', async () => {
      const siteDir = path.join(testDir, 'schema-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Install anglesite-11ty
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, { cwd: siteDir });
      
      // Test valid configuration
      fs.mkdirSync(path.join(siteDir, 'src', '_data'), { recursive: true });
      
      const validConfig = {
        site: {
          name: 'Schema Test',
          description: 'Testing schema validation',
          url: 'https://schema.example.com'
        }
      };
      
      fs.writeFileSync(
        path.join(siteDir, 'src', '_data', 'website.json'),
        JSON.stringify(validConfig, null, 2)
      );
      
      // Copy validation script from anglesite-11ty
      const validationScript = path.join(originalCwd, 'anglesite-11ty', 'scripts', 'validate-json.cjs');
      if (fs.existsSync(validationScript)) {
        fs.copyFileSync(validationScript, path.join(siteDir, 'validate-json.cjs'));
        
        // Run validation
        const validationOutput = execSync('node validate-json.cjs', {
          cwd: siteDir,
          encoding: 'utf8'
        });
        
        expect(validationOutput).toContain('valid');
      }
      
      // Test invalid configuration
      const invalidConfig = {
        site: {
          // Missing required 'name' field
          description: 'Invalid configuration',
          url: 'not-a-valid-url'
        }
      };
      
      fs.writeFileSync(
        path.join(siteDir, 'src', '_data', 'website.json'),
        JSON.stringify(invalidConfig, null, 2)
      );
      
      // Validation should fail for invalid config
      if (fs.existsSync(validationScript)) {
        expect(() => {
          execSync('node validate-json.cjs', {
            cwd: siteDir,
            encoding: 'utf8',
            stdio: 'pipe'
          });
        }).toThrow();
      }
    }, 45000);
  });
});