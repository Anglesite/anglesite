/**
 * @file Unit tests for WebsiteServerManager
 */
import { WebsiteServerManager, ServerState, websiteServerManager } from '../../app/server/website-server-manager';
import { ILogger, IFileSystem } from '../../app/core/interfaces';

// Mock the per-website-server module
jest.mock('../../app/server/per-website-server', () => ({
  startWebsiteServer: jest.fn(),
  stopWebsiteServer: jest.fn(),
}));

const mockStartWebsiteServer = require('../../app/server/per-website-server').startWebsiteServer;
const mockStopWebsiteServer = require('../../app/server/per-website-server').stopWebsiteServer;

interface MockWebsiteServer {
  devServer: { watcher: { close: jest.Mock }; close: jest.Mock };
  inputDir: string;
  outputDir: string;
  port: number;
  actualUrl?: string;
  urlResolver: unknown;
  restoreConsole?: () => void;
}

describe('WebsiteServerManager', () => {
  let serverManager: WebsiteServerManager;
  let mockWebsiteServer: MockWebsiteServer;
  let mockLogger: ILogger;
  let mockFileSystem: IFileSystem;

  beforeEach(() => {
    // Create mock dependencies
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockFileSystem = {
      exists: jest.fn().mockReturnValue(true),
      readFile: jest.fn(),
      writeFile: jest.fn(),
      mkdir: jest.fn(),
      readdir: jest.fn(),
      rmdir: jest.fn(),
      copyFile: jest.fn(),
      rename: jest.fn(),
      stat: jest.fn(),
    };

    // Create a new server manager instance for each test
    serverManager = new WebsiteServerManager(mockLogger, mockFileSystem, {
      startPort: 9000,
      maxRetries: 2,
      startupTimeout: 5000,
      shutdownTimeout: 3000,
      enableLogging: false, // Disable logging for tests
    });

    // Mock website server object
    mockWebsiteServer = {
      devServer: { watcher: { close: jest.fn() }, close: jest.fn() },
      inputDir: '/test/path/src',
      outputDir: '/test/path/_site',
      port: 9000,
      actualUrl: 'http://localhost:9000',
      urlResolver: {},
      restoreConsole: jest.fn(),
    };

    // Reset mocks
    mockStartWebsiteServer.mockClear();
    mockStopWebsiteServer.mockClear();
    mockStartWebsiteServer.mockResolvedValue(mockWebsiteServer);
    mockStopWebsiteServer.mockResolvedValue(undefined);

    // Reset file system mock
    (mockFileSystem.exists as jest.Mock).mockClear().mockReturnValue(true);
  });

  afterEach(() => {
    // Clean up server manager
    return serverManager.stopAllServers();
  });

  describe('startServer', () => {
    it('should start a server successfully', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';

      const serverInfo = await serverManager.startServer(websiteName, websitePath);

      expect(serverInfo.name).toBe(websiteName);
      expect(serverInfo.status).toBe('running');
      expect(serverInfo.port).toBe(9000);
      expect(serverInfo.url).toBe('http://localhost:9000');
      expect(mockStartWebsiteServer).toHaveBeenCalledWith(websitePath, websiteName, 9000);
    });

    it('should return existing running server', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';

      // Start server first time
      const managedServer1 = await serverManager.startServer(websiteName, websitePath);

      // Try to start again
      const managedServer2 = await serverManager.startServer(websiteName, websitePath);

      expect(managedServer1).toStrictEqual(managedServer2);
      expect(mockStartWebsiteServer).toHaveBeenCalledTimes(1);
    });

    it('should handle server start failure with retries', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';
      const error = new Error('Server start failed');

      // Mock consecutive failures for initial + retries
      mockStartWebsiteServer.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockRejectedValueOnce(error);

      await expect(serverManager.startServer(websiteName, websitePath)).rejects.toThrow('Server start failed');

      // Should have tried maxRetries + 1 times (initial + retries)
      expect(mockStartWebsiteServer).toHaveBeenCalledTimes(3);

      const managedServer = serverManager.getServer(websiteName);
      expect(managedServer?.state).toBe(ServerState.ERROR);
      expect(managedServer?.lastError?.message).toBe('Server start failed');
    }, 15000); // Increase timeout for retries

    it('should validate website path before starting', async () => {
      const websiteName = 'test-site';
      const websitePath = '/invalid/path';

      // Mock file system to return false for path validation
      (mockFileSystem.exists as jest.Mock).mockReturnValue(false);

      await expect(serverManager.startServer(websiteName, websitePath)).rejects.toThrow('Invalid website path');
      expect(mockStartWebsiteServer).not.toHaveBeenCalled();
    });
  });

  describe('stopServer', () => {
    it('should stop a running server successfully', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';

      // Start server first
      await serverManager.startServer(websiteName, websitePath);

      // Stop the server
      await serverManager.stopServer(websiteName);

      const managedServer = serverManager.getServer(websiteName);
      expect(managedServer?.state).toBe(ServerState.STOPPED);
      expect(managedServer?.server).toBeUndefined();
      expect(mockStopWebsiteServer).toHaveBeenCalledWith(mockWebsiteServer);
    });

    it('should handle stopping non-existent server', async () => {
      // Should not throw error
      await expect(serverManager.stopServer('non-existent')).resolves.toBeUndefined();
    });

    it('should handle server stop failure', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';
      const error = new Error('Server stop failed');

      mockStopWebsiteServer.mockRejectedValue(error);

      // Start server first
      await serverManager.startServer(websiteName, websitePath);

      // Stop should not throw but server should be in error state
      await serverManager.stopServer(websiteName);

      const managedServer = serverManager.getServer(websiteName);
      expect(managedServer?.state).toBe(ServerState.ERROR);
      expect(managedServer?.lastError?.message).toBe('Server stop failed');
    });
  });

  describe('restartServer', () => {
    it('should restart a server successfully', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';

      // Start server first
      await serverManager.startServer(websiteName, websitePath);

      // Restart the server
      const restartedServer = await serverManager.restartServer(websiteName);

      expect(restartedServer.status).toBe('running');
      expect(mockStopWebsiteServer).toHaveBeenCalled();
      expect(mockStartWebsiteServer).toHaveBeenCalledTimes(2); // Initial start + restart
    });

    it('should fail to restart non-existent server', async () => {
      await expect(serverManager.restartServer('non-existent')).rejects.toThrow('No server found');
    });
  });

  describe('server state management', () => {
    it('should track server states correctly', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';

      // Initially no servers
      expect(serverManager.getRunningServersCount()).toBe(0);
      expect(serverManager.isServerRunning(websiteName)).toBe(false);

      // Start server
      await serverManager.startServer(websiteName, websitePath);
      expect(serverManager.getRunningServersCount()).toBe(1);
      expect(serverManager.isServerRunning(websiteName)).toBe(true);

      // Stop server
      await serverManager.stopServer(websiteName);
      expect(serverManager.getRunningServersCount()).toBe(0);
      expect(serverManager.isServerRunning(websiteName)).toBe(false);
    });

    it('should get servers by state', async () => {
      const websiteName1 = 'test-site-1';
      const websiteName2 = 'test-site-2';
      const websitePath = '/test/path';

      // Start first server successfully
      mockStartWebsiteServer.mockResolvedValueOnce(mockWebsiteServer);
      await serverManager.startServer(websiteName1, websitePath);

      // Make second server fail all retry attempts
      const error = new Error('Failed');
      mockStartWebsiteServer.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockRejectedValueOnce(error);

      try {
        await serverManager.startServer(websiteName2, websitePath);
      } catch {
        // Expected to fail
      }

      const runningServers = serverManager.getServersByState(ServerState.RUNNING);
      const errorServers = serverManager.getServersByState(ServerState.ERROR);

      expect(runningServers).toHaveLength(1);
      expect(runningServers[0].websiteName).toBe(websiteName1);
      expect(errorServers).toHaveLength(1);
      expect(errorServers[0].websiteName).toBe(websiteName2);
    }, 10000); // Increase timeout
  });

  describe('stopAllServers', () => {
    it('should stop all running servers', async () => {
      const websiteName1 = 'test-site-1';
      const websiteName2 = 'test-site-2';
      const websitePath = '/test/path';

      // Start multiple servers
      await serverManager.startServer(websiteName1, websitePath);
      await serverManager.startServer(websiteName2, websitePath);

      expect(serverManager.getRunningServersCount()).toBe(2);

      // Stop all servers
      await serverManager.stopAllServers();

      expect(serverManager.getRunningServersCount()).toBe(0);
      expect(serverManager.getAllServers().size).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', async () => {
      const websiteName1 = 'test-site-1';
      const websiteName2 = 'test-site-2';
      const websitePath = '/test/path';

      // Start servers
      await serverManager.startServer(websiteName1, websitePath);
      await serverManager.startServer(websiteName2, websitePath);

      const stats = serverManager.getStatistics();

      expect(stats.totalServers).toBe(2);
      expect(stats.runningServers).toBe(2);
      expect(stats.stoppedServers).toBe(0);
      expect(stats.errorServers).toBe(0);
      expect(stats.allocatedPorts).toEqual([9000, 9001]);
      expect(Object.keys(stats.uptime)).toHaveLength(2);
    });
  });

  describe('event emission', () => {
    it('should emit server lifecycle events', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';
      const events: string[] = [];

      serverManager.on('server-starting', () => events.push('starting'));
      serverManager.on('server-started', () => events.push('started'));
      serverManager.on('server-stopping', () => events.push('stopping'));
      serverManager.on('server-stopped', () => events.push('stopped'));

      // Start and stop server
      await serverManager.startServer(websiteName, websitePath);
      await serverManager.stopServer(websiteName);

      expect(events).toEqual(['starting', 'started', 'stopping', 'stopped']);
    });

    it('should emit error events on failure', async () => {
      const websiteName = 'test-site';
      const websitePath = '/test/path';
      const error = new Error('Server start failed');
      let emittedError: Error | null = null;

      // Mock all retry attempts to fail
      mockStartWebsiteServer.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockRejectedValueOnce(error);

      serverManager.on('server-error', (name, err) => {
        emittedError = err;
      });

      try {
        await serverManager.startServer(websiteName, websitePath);
      } catch {
        // Expected to fail
      }

      expect(emittedError).toBeTruthy();
      expect(emittedError!.message).toBe('Server start failed');
    }, 15000); // Increase timeout for retries
  });

  describe('deprecated singleton instance', () => {
    it('should export a deprecated singleton that throws errors', () => {
      expect(websiteServerManager).toBeInstanceOf(Object);
      expect(() => websiteServerManager.startServer()).toThrow(
        'websiteServerManager is deprecated. Use DI container instead.'
      );
      expect(() => websiteServerManager.stopServer()).toThrow(
        'websiteServerManager is deprecated. Use DI container instead.'
      );
    });
  });
});
