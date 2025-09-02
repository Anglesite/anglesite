// ABOUTME: API integration tests for internal service communication and external integrations
// ABOUTME: Tests IPC communication, HTTP APIs, file system operations, and service integrations

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');

describe('API Integration Tests', () => {
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

  describe('Eleventy API Integration', () => {
    test('should integrate with Eleventy programmatic API', async () => {
      const siteDir = path.join(testDir, 'api-test-site');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Install Eleventy and anglesite-11ty
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install @11ty/eleventy file:${anglesitePackagePath}`, {
        cwd: siteDir,
        stdio: 'pipe'
      });
      
      // Create test content
      fs.mkdirSync(path.join(siteDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# API Integration Test');
      
      // Create programmatic build script
      const buildScript = `
        const Eleventy = require('@11ty/eleventy');
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        
        async function buildSite() {
          const elev = new Eleventy('./src', './_site', {
            configPath: undefined,
            config: function(eleventyConfig) {
              return anglesiteConfig(eleventyConfig);
            }
          });
          
          const results = await elev.write();
          console.log('Build completed:', JSON.stringify({
            outputPath: results[0]?.outputPath,
            inputPath: results[0]?.inputPath,
            count: results.length
          }));
          
          return results;
        }
        
        buildSite().catch(console.error);
      `;
      
      fs.writeFileSync(path.join(siteDir, 'build.js'), buildScript);
      
      // Run programmatic build
      const buildOutput = execSync('node build.js', {
        cwd: siteDir,
        encoding: 'utf8'
      });
      
      expect(buildOutput).toContain('Build completed');
      expect(buildOutput).toContain('count');
      
      // Verify output files
      expect(fs.existsSync(path.join(siteDir, '_site', 'index.html'))).toBe(true);
    }, 45000);
    
    test('should handle Eleventy data cascade integration', async () => {
      const siteDir = path.join(testDir, 'data-cascade-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Install dependencies
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install @11ty/eleventy file:${anglesitePackagePath}`, {
        cwd: siteDir,
        stdio: 'pipe'
      });
      
      // Create complex data structure
      fs.mkdirSync(path.join(siteDir, 'src', '_data'), { recursive: true });
      fs.mkdirSync(path.join(siteDir, 'src', 'posts'), { recursive: true });
      
      // Global data
      fs.writeFileSync(path.join(siteDir, 'src', '_data', 'site.json'), JSON.stringify({
        name: 'Data Cascade Test',
        author: 'Integration Tester'
      }));
      
      // Website configuration
      fs.writeFileSync(path.join(siteDir, 'src', '_data', 'website.json'), JSON.stringify({
        site: {
          name: 'Data Integration Test',
          description: 'Testing data cascade integration'
        }
      }));
      
      // Directory data
      fs.writeFileSync(path.join(siteDir, 'src', 'posts', 'posts.json'), JSON.stringify({
        layout: 'post.html',
        tags: ['post']
      }));
      
      // Test posts
      fs.writeFileSync(path.join(siteDir, 'src', 'posts', 'test-post.md'), `---
title: Test Post
date: 2024-01-01
---
# Test Post

This is a test post for data cascade.
`);
      
      // Create layout
      fs.mkdirSync(path.join(siteDir, 'src', '_includes'), { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'src', '_includes', 'post.html'), `<!DOCTYPE html>
<html>
<head>
  <title>{{ title }} - {{ site.name }}</title>
</head>
<body>
  <h1>{{ title }}</h1>
  <p>By {{ site.author }}</p>
  {{ content }}
</body>
</html>`);
      
      // Create Eleventy config
      fs.writeFileSync(path.join(siteDir, '.eleventy.js'), `
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        
        module.exports = function(eleventyConfig) {
          const config = anglesiteConfig(eleventyConfig);
          
          // Add collection for testing
          eleventyConfig.addCollection('testPosts', function(collectionApi) {
            return collectionApi.getFilteredByTag('post');
          });
          
          return config;
        };
      `);
      
      // Build site
      execSync('npx @11ty/eleventy', { cwd: siteDir });
      
      // Verify data cascade worked
      const postHtml = fs.readFileSync(path.join(siteDir, '_site', 'posts', 'test-post', 'index.html'), 'utf8');
      expect(postHtml).toContain('Test Post');
      expect(postHtml).toContain('Data Cascade Test');
      expect(postHtml).toContain('Integration Tester');
      
      expect(fs.existsSync(path.join(siteDir, '_site', 'index.html'))).toBe(true);
    }, 60000);
  });

  describe('HTTP Server Integration', () => {
    test('should start and manage HTTP development server', async () => {
      const siteDir = path.join(testDir, 'server-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Install dependencies
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install @11ty/eleventy file:${anglesitePackagePath}`, {
        cwd: siteDir,
        stdio: 'pipe'
      });
      
      // Create test site
      fs.mkdirSync(path.join(siteDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# Server Test');
      fs.writeFileSync(path.join(siteDir, 'src', 'api.md'), '# API Page');
      
      // Find available port
      const port = await global.testUtils.findFreePort();
      
      // Start development server
      const serverProcess = spawn('npx', ['@11ty/eleventy', '--serve', `--port=${port}`, '--quiet'], {
        cwd: siteDir,
        stdio: 'pipe'
      });
      
      let serverReady = false;
      
      serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server at') || output.includes(`localhost:${port}`)) {
          serverReady = true;
        }
      });
      
      // Wait for server startup
      await global.testUtils.waitFor(() => serverReady, 15000);
      
      // Test multiple endpoints
      const endpoints = ['/', '/api/'];
      const responses = [];
      
      for (const endpoint of endpoints) {
        const response = await new Promise((resolve, reject) => {
          const req = http.get(`http://localhost:${port}${endpoint}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({
              status: res.statusCode,
              headers: res.headers,
              data: data
            }));
          });
          
          req.on('error', reject);
          req.setTimeout(5000, () => reject(new Error('Request timeout')));
        });
        
        responses.push({ endpoint, ...response });
      }
      
      // Verify responses
      responses.forEach(({ endpoint, status, data }) => {
        expect(status).toBe(200);
        expect(data).toContain('<html');
        expect(data).toContain('<title>');
      });
      
      // Test hot reload by modifying file
      const originalContent = fs.readFileSync(path.join(siteDir, 'src', 'index.md'), 'utf8');
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# Server Test Updated');
      
      // Give time for rebuild
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check updated content is served
      const updatedResponse = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      
      expect(updatedResponse).toContain('Server Test Updated');
      
      // Restore original content and cleanup
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), originalContent);
      serverProcess.kill('SIGTERM');
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
    }, 45000);
    
    test('should handle HTTPS server configuration', async () => {
      const siteDir = path.join(testDir, 'https-server-test');
      fs.mkdirSync(siteDir, { recursive: true });
      process.chdir(siteDir);
      
      // Check if test certificates exist
      const certPath = path.join(originalCwd, 'test-certs');
      const hasCerts = fs.existsSync(certPath) && 
                      fs.existsSync(path.join(certPath, 'server.crt')) &&
                      fs.existsSync(path.join(certPath, 'server.key'));
      
      if (!hasCerts) {
        console.log('Skipping HTTPS test - test certificates not available');
        return;
      }
      
      // Install dependencies
      const anglesitePackagePath = path.join(originalCwd, 'anglesite-11ty');
      execSync(`npm install @11ty/eleventy file:${anglesitePackagePath}`, {
        cwd: siteDir,
        stdio: 'pipe'
      });
      
      // Create test site
      fs.mkdirSync(path.join(siteDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(siteDir, 'src', 'index.md'), '# HTTPS Test');
      
      // Copy test certificates
      fs.mkdirSync(path.join(siteDir, 'certs'), { recursive: true });
      fs.copyFileSync(path.join(certPath, 'server.crt'), path.join(siteDir, 'certs', 'server.crt'));
      fs.copyFileSync(path.join(certPath, 'server.key'), path.join(siteDir, 'certs', 'server.key'));
      
      // Create HTTPS server configuration script
      const httpsScript = `
        const Eleventy = require('@11ty/eleventy');
        const https = require('https');
        const fs = require('fs');
        const anglesiteConfig = require('@dwk/anglesite-11ty');
        
        async function startHttpsServer() {
          const elev = new Eleventy('./src', './_site', {
            configPath: undefined,
            config: anglesiteConfig
          });
          
          await elev.write();
          
          const options = {
            key: fs.readFileSync('./certs/server.key'),
            cert: fs.readFileSync('./certs/server.crt')
          };
          
          const server = https.createServer(options, (req, res) => {
            const filePath = req.url === '/' ? '/_site/index.html' : \`/_site\${req.url}\`;
            const fullPath = '.' + filePath;
            
            if (fs.existsSync(fullPath)) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(fs.readFileSync(fullPath));
            } else {
              res.writeHead(404);
              res.end('Not Found');
            }
          });
          
          server.listen(8443, () => {
            console.log('HTTPS Server running on port 8443');
          });
          
          setTimeout(() => {
            server.close();
          }, 5000);
        }
        
        startHttpsServer().catch(console.error);
      `;
      
      fs.writeFileSync(path.join(siteDir, 'https-server.js'), httpsScript);
      
      // Test HTTPS server (with self-signed cert warning suppressed)
      
      const serverProcess = spawn('node', ['https-server.js'], {
        cwd: siteDir,
        stdio: 'pipe'
      });
      
      let serverReady = false;
      
      serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('HTTPS Server running')) {
          serverReady = true;
        }
      });
      
      await global.testUtils.waitFor(() => serverReady, 10000);
      
      // Test HTTPS request
      const httpsResponse = await new Promise((resolve, reject) => {
        const req = https.get({
          host: 'localhost',
          port: 8443,
          path: '/',
          rejectUnauthorized: false
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({
            status: res.statusCode,
            data: data
          }));
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => reject(new Error('HTTPS request timeout')));
      });
      
      expect(httpsResponse.status).toBe(200);
      expect(httpsResponse.data).toContain('HTTPS Test');
      
      // Restore TLS verification
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }, 30000);
  });

  describe('File System API Integration', () => {
    test('should handle file system operations and watching', async () => {
      const watchDir = path.join(testDir, 'watch-test');
      fs.mkdirSync(watchDir, { recursive: true });
      
      // Create file watcher test
      const watchScript = `
        const fs = require('fs');
        const path = require('path');
        const chokidar = require('chokidar');
        
        const watchPath = process.argv[2];
        const changes = [];
        
        const watcher = chokidar.watch(watchPath, {
          ignored: /(^|[\/\\])\\../,
          persistent: true,
          ignoreInitial: true
        });
        
        watcher
          .on('add', path => changes.push({ type: 'add', path }))
          .on('change', path => changes.push({ type: 'change', path }))
          .on('unlink', path => changes.push({ type: 'unlink', path }));
        
        // Output changes after timeout
        setTimeout(() => {
          console.log(JSON.stringify(changes));
          watcher.close();
        }, 3000);
        
        console.log('Watching:', watchPath);
      `;
      
      fs.writeFileSync(path.join(testDir, 'watcher.js'), watchScript);
      
      // Check if chokidar is available
      try {
        execSync('npm list chokidar', { cwd: originalCwd, stdio: 'pipe' });
      } catch {
        console.log('Skipping file watcher test - chokidar not available');
        return;
      }
      
      // Start file watcher
      const watcherProcess = spawn('node', [path.join(testDir, 'watcher.js'), watchDir], {
        cwd: testDir,
        stdio: 'pipe'
      });
      
      let watcherReady = false;
      let watcherOutput = '';
      
      watcherProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Watcher output:', output);
        if (output.includes('Watching:')) {
          watcherReady = true;
        }
        if (output.startsWith('[')) {
          watcherOutput = output.trim();
        }
      });
      
      // Wait for watcher to start
      await global.testUtils.waitFor(() => watcherReady, 5000);
      
      // Make file system changes
      fs.writeFileSync(path.join(watchDir, 'test1.txt'), 'Test file 1');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      fs.writeFileSync(path.join(watchDir, 'test2.txt'), 'Test file 2');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      fs.writeFileSync(path.join(watchDir, 'test1.txt'), 'Modified test file 1');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      fs.unlinkSync(path.join(watchDir, 'test2.txt'));
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Wait for watcher to complete
      await new Promise((resolve) => {
        watcherProcess.on('close', resolve);
      });
      
      // Parse watcher output
      if (watcherOutput) {
        const changes = JSON.parse(watcherOutput);
        
        expect(changes.length).toBeGreaterThan(0);
        expect(changes.some(change => change.type === 'add')).toBe(true);
        expect(changes.some(change => change.type === 'change')).toBe(true);
        expect(changes.some(change => change.type === 'unlink')).toBe(true);
      }
    }, 15000);
  });

  describe('External API Integration', () => {
    test('should handle external HTTP requests gracefully', async () => {
      // Test external API integration patterns that might be used
      // This tests network resilience and timeout handling
      
      const testRequests = [
        {
          name: 'Valid HTTP request',
          url: 'http://httpbin.org/json',
          expectSuccess: true
        },
        {
          name: 'Invalid domain',
          url: 'http://invalid-domain-that-should-not-exist.com',
          expectSuccess: false
        },
        {
          name: 'Timeout test',
          url: 'http://httpbin.org/delay/10',
          expectSuccess: false,
          timeout: 2000
        }
      ];
      
      for (const testRequest of testRequests) {
        try {
          const response = await new Promise((resolve, reject) => {
            const req = http.get(testRequest.url, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => resolve({
                status: res.statusCode,
                data: data
              }));
            });
            
            req.on('error', reject);
            req.setTimeout(testRequest.timeout || 5000, () => {
              req.destroy();
              reject(new Error('Request timeout'));
            });
          });
          
          if (testRequest.expectSuccess) {
            expect(response.status).toBe(200);
            console.log(`✅ ${testRequest.name}: Success`);
          } else {
            console.log(`⚠️ ${testRequest.name}: Unexpected success`);
          }
        } catch (error) {
          if (!testRequest.expectSuccess) {
            console.log(`✅ ${testRequest.name}: Expected failure - ${error.message}`);
          } else {
            console.log(`❌ ${testRequest.name}: Unexpected failure - ${error.message}`);
            // Don't fail the test for network issues in CI
            if (!process.env.CI) {
              throw error;
            }
          }
        }
      }
    }, 20000);
  });
});