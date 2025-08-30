// ABOUTME: Integration test setup and global configuration
// ABOUTME: Provides shared utilities and environment setup for cross-package integration tests

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Global test timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  // Temporary directory management
  createTempDir: () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, '../../tmp/test-'));
    return tmpDir;
  },
  
  cleanupTempDir: (dir) => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  
  // File system utilities
  copyDirectory: (src, dest) => {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        global.testUtils.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  },
  
  // Process utilities
  runCommand: (command, cwd = process.cwd()) => {
    try {
      return execSync(command, { 
        cwd,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      console.error(`Command failed: ${command}`);
      console.error(error.stdout);
      console.error(error.stderr);
      throw error;
    }
  },
  
  // Port utilities for server testing
  findFreePort: async () => {
    const net = require('net');
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  },
  
  // Wait utilities
  waitFor: (condition, timeout = 5000, interval = 100) => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = async () => {
        try {
          const result = await condition();
          if (result) {
            resolve(result);
            return;
          }
        } catch (error) {
          // Continue waiting unless timeout exceeded
        }
        
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Condition not met within ${timeout}ms`));
          return;
        }
        
        setTimeout(check, interval);
      };
      check();
    });
  },
  
  // Network utilities
  isPortOpen: (port, host = 'localhost') => {
    const net = require('net');
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(port, host);
    });
  }
};

// Global test environment variables
process.env.NODE_ENV = 'test-integration';
process.env.CI = 'true';

// Create tmp directory for integration tests
const tmpDir = path.join(__dirname, '../../tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Cleanup function to run after all tests
const cleanup = () => {
  const tmpDir = path.join(__dirname, '../../tmp');
  if (fs.existsSync(tmpDir)) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup tmp directory:', error.message);
    }
  }
};

// Register cleanup handlers
process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Log integration test environment
console.log('Integration test environment initialized');
console.log(`Node version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Working directory: ${process.cwd()}`);
console.log(`Temp directory: ${tmpDir}`);

// Export utilities for CommonJS compatibility
module.exports = global.testUtils;