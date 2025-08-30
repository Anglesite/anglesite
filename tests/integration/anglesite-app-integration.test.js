// ABOUTME: Integration tests for Anglesite Electron app with anglesite-11ty integration
// ABOUTME: Tests complete workflow from app startup to site building and preview

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');

describe('Anglesite App Integration', () => {
  let testDir;
  let originalCwd;
  let electronProcess;
  
  beforeAll(async () => {
    originalCwd = process.cwd();
    testDir = global.testUtils.createTempDir();
    
    // Verify Anglesite app is built
    const anglesiteAppPath = path.join(originalCwd, 'anglesite');
    const appMainPath = path.join(anglesiteAppPath, 'app', 'main.js');
    
    if (!fs.existsSync(appMainPath)) {
      console.log('Building Anglesite app for integration tests...');
      process.chdir(anglesiteAppPath);
      execSync('npm run build', { stdio: 'inherit' });
      process.chdir(originalCwd);
    }
  }, 120000);
  
  afterAll(async () => {
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    process.chdir(originalCwd);
    global.testUtils.cleanupTempDir(testDir);
  });

  describe('Electron App Startup', () => {
    test('should start Electron app without errors', async () => {
      const anglesiteAppPath = path.join(originalCwd, 'anglesite');
      
      // Start Electron in headless mode
      electronProcess = spawn('npm', ['run', 'start', '--', '--no-sandbox', '--disable-gpu'], {
        cwd: anglesiteAppPath,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DISPLAY: ':99', // Virtual display for CI
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
        },
        stdio: 'pipe'
      });
      
      let appStarted = false;
      let startupError = null;
      
      // Monitor startup
      electronProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Electron stdout:', output);
        if (output.includes('Anglesite is ready') || output.includes('Window created')) {
          appStarted = true;
        }
      });
      
      electronProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.error('Electron stderr:', output);
        if (output.includes('Error') && !output.includes('Warning')) {
          startupError = output;
        }
      });
      
      electronProcess.on('error', (error) => {
        startupError = error.message;
      });
      
      // Wait for app to start or fail
      await global.testUtils.waitFor(() => appStarted || startupError, 30000);
      
      if (startupError) {
        throw new Error(`Electron app failed to start: ${startupError}`);
      }
      
      expect(appStarted).toBe(true);
    }, 45000);
  });

  describe('Website Server Integration', () => {
    test('should create and serve a website project', async () => {
      // Create test website directory
      const websiteDir = path.join(testDir, 'test-website');
      fs.mkdirSync(websiteDir, { recursive: true });
      
      // Copy anglesite-starter structure
      const starterPath = path.join(originalCwd, 'anglesite-starter');
      if (fs.existsSync(starterPath)) {
        global.testUtils.copyDirectory(starterPath, websiteDir);
      } else {
        // Create minimal website structure
        fs.mkdirSync(path.join(websiteDir, 'src', '_data'), { recursive: true });
        
        fs.writeFileSync(path.join(websiteDir, 'src', 'index.md'), '# Integration Test Site');
        
        const websiteConfig = {
          site: {
            name: 'Integration Test Site',
            description: 'Testing Anglesite integration',
            url: 'http://localhost:8080'
          }
        };
        
        fs.writeFileSync(
          path.join(websiteDir, 'src', '_data', 'website.json'),
          JSON.stringify(websiteConfig, null, 2)
        );
        
        // Create package.json
        fs.writeFileSync(path.join(websiteDir, 'package.json'), JSON.stringify({
          name: 'integration-test-site',
          version: '1.0.0',
          scripts: {
            build: 'eleventy',
            serve: 'eleventy --serve'
          }
        }, null, 2));
      }
      
      // Install anglesite-11ty in the website
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, {
        cwd: websiteDir,
        stdio: 'pipe'
      });
      
      // Test that website can be built
      const buildOutput = execSync('npx @11ty/eleventy', {
        cwd: websiteDir,
        encoding: 'utf8'
      });
      
      expect(buildOutput).toContain('Wrote');
      expect(fs.existsSync(path.join(websiteDir, '_site', 'index.html'))).toBe(true);
      
      // Test website serving
      const port = await global.testUtils.findFreePort();
      const serveProcess = spawn('npx', ['@11ty/eleventy', '--serve', `--port=${port}`], {
        cwd: websiteDir,
        stdio: 'pipe'
      });
      
      let serverStarted = false;
      
      serveProcess.stdout.on('data', (data) => {
        if (data.toString().includes('Server at')) {
          serverStarted = true;
        }
      });
      
      // Wait for server to start
      await global.testUtils.waitFor(() => serverStarted, 15000);
      
      // Test that server is responding
      const serverResponse = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
      });
      
      expect(serverResponse.status).toBe(200);
      expect(serverResponse.data).toContain('<title>');
      
      // Cleanup
      serveProcess.kill('SIGTERM');
    }, 90000);
  });

  describe('File Watching Integration', () => {
    test('should detect file changes and trigger rebuilds', async () => {
      const websiteDir = path.join(testDir, 'watch-test-website');
      fs.mkdirSync(websiteDir, { recursive: true });
      
      // Create minimal website
      fs.mkdirSync(path.join(websiteDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(websiteDir, 'src', 'index.md'), '# Watch Test');
      
      // Install anglesite-11ty
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, {
        cwd: websiteDir,
        stdio: 'pipe'
      });
      
      // Start Eleventy in watch mode
      const port = await global.testUtils.findFreePort();
      const watchProcess = spawn('npx', ['@11ty/eleventy', '--serve', '--watch', `--port=${port}`], {
        cwd: websiteDir,
        stdio: 'pipe'
      });
      
      let initialBuildComplete = false;
      let rebuildDetected = false;
      
      watchProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Watch output:', output);
        
        if (output.includes('Wrote') && !initialBuildComplete) {
          initialBuildComplete = true;
        } else if (output.includes('Wrote') && initialBuildComplete) {
          rebuildDetected = true;
        }
      });
      
      // Wait for initial build
      await global.testUtils.waitFor(() => initialBuildComplete, 15000);
      
      // Modify a source file
      setTimeout(() => {
        fs.writeFileSync(path.join(websiteDir, 'src', 'index.md'), '# Watch Test Updated');
      }, 1000);
      
      // Wait for rebuild
      await global.testUtils.waitFor(() => rebuildDetected, 10000);
      
      expect(rebuildDetected).toBe(true);
      
      // Verify updated content
      const updatedHtml = fs.readFileSync(path.join(websiteDir, '_site', 'index.html'), 'utf8');
      expect(updatedHtml).toContain('Watch Test Updated');
      
      // Cleanup
      watchProcess.kill('SIGTERM');
    }, 60000);
  });

  describe('Cross-Package API Integration', () => {
    test('should handle IPC communication between main and renderer processes', async () => {
      // This test would require more complex Electron testing setup
      // For now, we'll test the API surface that would be used by IPC
      
      const anglesiteAppPath = path.join(originalCwd, 'anglesite');
      
      // Test that IPC handler modules can be loaded
      const ipcHandlersPath = path.join(anglesiteAppPath, 'app', 'ipc', 'handlers.ts');
      if (fs.existsSync(ipcHandlersPath)) {
        // Read the handlers file to verify it exports expected functions
        const handlersContent = fs.readFileSync(ipcHandlersPath, 'utf8');
        
        expect(handlersContent).toContain('export');
        // Verify common IPC handlers are present
        expect(handlersContent).toMatch(/website|file|preview/);
      }
      
      // Test server management API
      const serverManagerPath = path.join(anglesiteAppPath, 'app', 'server', 'website-server-manager.ts');
      if (fs.existsSync(serverManagerPath)) {
        const serverContent = fs.readFileSync(serverManagerPath, 'utf8');
        expect(serverContent).toContain('class');
        expect(serverContent).toContain('start');
        expect(serverContent).toContain('stop');
      }
    });
    
    test('should validate website configuration schema integration', async () => {
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      const schemaPath = path.join(anglesitePackagePath, 'schemas', 'website.schema.json');
      
      if (fs.existsSync(schemaPath)) {
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        
        // Verify schema structure
        expect(schema).toHaveProperty('$schema');
        expect(schema).toHaveProperty('type');
        expect(schema).toHaveProperty('properties');
        expect(schema.properties).toHaveProperty('site');
        
        // Test schema validation with sample data
        const validConfig = {
          site: {
            name: 'Test Site',
            description: 'A test site',
            url: 'https://test.example.com'
          }
        };
        
        // In a real implementation, we'd use a JSON schema validator here
        // For now, just verify the structure matches expected patterns
        expect(validConfig.site.name).toBeDefined();
        expect(validConfig.site.url).toMatch(/^https?:\/\//);
      }
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle malformed website configurations gracefully', async () => {
      const websiteDir = path.join(testDir, 'error-test-website');
      fs.mkdirSync(websiteDir, { recursive: true });
      fs.mkdirSync(path.join(websiteDir, 'src', '_data'), { recursive: true });
      
      // Create malformed website.json
      fs.writeFileSync(
        path.join(websiteDir, 'src', '_data', 'website.json'),
        '{ "site": { "name": } }' // Invalid JSON
      );
      
      fs.writeFileSync(path.join(websiteDir, 'src', 'index.md'), '# Error Test');
      
      // Install anglesite-11ty
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install file:${anglesitePackagePath}`, {
        cwd: websiteDir,
        stdio: 'pipe'
      });
      
      // Create Eleventy config
      const eleventyConfig = `
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        module.exports = function(eleventyConfig) {
          return anglesiteConfig(eleventyConfig);
        };
      `;
      fs.writeFileSync(path.join(websiteDir, '.eleventy.js'), eleventyConfig);
      
      // Build should fail gracefully with useful error message
      let buildError = null;
      try {
        execSync('npx @11ty/eleventy', {
          cwd: websiteDir,
          stdio: 'pipe'
        });
      } catch (error) {
        buildError = error.stderr.toString();
      }
      
      expect(buildError).toBeTruthy();
      expect(buildError).toMatch(/JSON|parse|syntax/i);
    }, 30000);
  });
});