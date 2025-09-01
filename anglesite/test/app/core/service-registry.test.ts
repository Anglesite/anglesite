/**
 * @file Tests for Service Registry and Application Context
 *
 * Tests the service registration system, application context, and
 * integration between various services.
 */

import {
  ServiceRegistrar,
  ApplicationContext,
  bootstrapServices,
  Logger,
  FileSystemService,
  ServiceFactory,
} from '../../../src/main/core/service-registry';
import { DIContainer, ServiceKeys } from '../../../src/main/core/container';
import { IStore, ILogger, IFileSystem } from '../../../src/main/core/interfaces';

// Mock electron for this test
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/test/userData'),
    getName: jest.fn(() => 'Test App'),
  },
}));

describe('Service Registry', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer({ name: 'test-registry' });
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('ServiceRegistrar', () => {
    it('should register core services', () => {
      ServiceRegistrar.registerCoreServices(container);

      expect(container.isRegistered(ServiceKeys.LOGGER)).toBe(true);
      expect(container.isRegistered(ServiceKeys.FILE_SYSTEM)).toBe(true);
      expect(container.isRegistered(ServiceKeys.STORE)).toBe(true);
    });

    it('should resolve registered core services', () => {
      ServiceRegistrar.registerCoreServices(container);

      const logger = container.resolve<ILogger>(ServiceKeys.LOGGER);
      expect(logger).toBeInstanceOf(Logger);

      const fileSystem = container.resolve<IFileSystem>(ServiceKeys.FILE_SYSTEM);
      expect(fileSystem).toBeInstanceOf(FileSystemService);

      const store = container.resolve<IStore>(ServiceKeys.STORE);
      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
    });

    it('should validate dependencies successfully', () => {
      expect(() => ServiceRegistrar.registerAllServices(container)).not.toThrow();
    });

    it('should create service factory', () => {
      ServiceRegistrar.registerCoreServices(container);

      const factory = container.resolve<ServiceFactory>('serviceFactory');
      expect(factory).toBeInstanceOf(ServiceFactory);
    });
  });

  describe('ServiceFactory', () => {
    let logger: ILogger;
    let factory: ServiceFactory;

    beforeEach(() => {
      logger = new Logger('test');
      factory = new ServiceFactory(logger);
    });

    it('should create store service', () => {
      const store = factory.createStore();
      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.dispose).toBe('function');
    });

    it('should create logger service', () => {
      const logger = factory.createLogger('test-context');
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create file system service', () => {
      const fs = factory.createFileSystem();
      expect(fs).toBeInstanceOf(FileSystemService);
      expect(typeof fs.exists).toBe('function');
      expect(typeof fs.readFile).toBe('function');
    });

    it('should create website server manager', () => {
      const wsm = factory.createWebsiteServerManager();
      expect(wsm).toBeDefined();
      expect(typeof wsm.startServer).toBe('function');
      expect(typeof wsm.stopServer).toBe('function');
    });

    it('should throw for unimplemented services', () => {
      expect(() => factory.createWebsiteManager()).toThrow(
        'WebsiteManager not yet fully refactored - waiting for AtomicOperations DI'
      );
      // Note: WebsiteServerManager is implemented and should not throw
      expect(() => factory.createDnsManager()).toThrow('DnsManager not yet refactored for DI');
      expect(() => factory.createCertificateManager()).toThrow('CertificateManager not yet refactored for DI');
      expect(() => factory.createMenuManager()).toThrow('MenuManager not yet refactored for DI');
      expect(() => factory.createWindowManager()).toThrow('WindowManager not yet refactored for DI');
      expect(() => factory.createAtomicOperations()).toThrow('AtomicOperations not yet refactored for DI');
      expect(() => factory.createHealthMonitor()).toThrow('HealthMonitor not yet implemented');
    });
  });

  describe('Logger', () => {
    let logger: Logger;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      logger = new Logger('test');
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log messages with context', () => {
      logger.info('test message');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] INFO \[test\] test message/), '', '');
    });

    it('should log messages with metadata', () => {
      logger.info('test message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] INFO \[test\] test message/),
        '',
        '{"key":"value"}'
      );
    });

    it('should create child loggers', () => {
      const childLogger = logger.child({ requestId: '123' });
      childLogger.info('child message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] INFO \[test\] child message/),
        '{"requestId":"123"}',
        ''
      );
    });

    it('should handle different log levels', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        logger.debug('debug message');
        logger.info('info message');
        logger.warn('warn message');
        logger.error('error message', new Error('test error'));

        expect(debugSpy).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        debugSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  describe('FileSystemService', () => {
    let fs: FileSystemService;

    beforeEach(() => {
      fs = new FileSystemService();
    });

    it('should implement IFileSystem interface', () => {
      expect(typeof fs.exists).toBe('function');
      expect(typeof fs.readFile).toBe('function');
      expect(typeof fs.writeFile).toBe('function');
      expect(typeof fs.mkdir).toBe('function');
      expect(typeof fs.readdir).toBe('function');
      expect(typeof fs.rmdir).toBe('function');
      expect(typeof fs.copyFile).toBe('function');
      expect(typeof fs.rename).toBe('function');
      expect(typeof fs.stat).toBe('function');
    });

    it('should check file existence', async () => {
      const exists = await fs.exists(__filename);
      expect(exists).toBe(true);

      const notExists = await fs.exists('/nonexistent/file.txt');
      expect(notExists).toBe(false);
    });

    it('should read files', async () => {
      const content = await fs.readFile(__filename, 'utf-8');
      expect(typeof content).toBe('string');
      expect(content).toContain('FileSystemService');
    });

    it('should get file stats', async () => {
      const stats = await fs.stat(__filename);
      expect(typeof stats.isFile).toBe('function');
      expect(typeof stats.isDirectory).toBe('function');
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(typeof stats.size).toBe('number');
      expect(stats.mtime).toBeDefined();
      expect(stats.mtime.getTime).toBeDefined(); // It should be a Date-like object
    });
  });
});

describe('ApplicationContext', () => {
  let container: DIContainer;
  let appContext: ApplicationContext;

  beforeEach(() => {
    container = new DIContainer({ name: 'test-app' });
    ServiceRegistrar.registerCoreServices(container);
    appContext = new ApplicationContext(container);
  });

  afterEach(async () => {
    if (appContext) {
      await appContext.dispose();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(appContext.initialize()).resolves.toBeUndefined();
    });

    it('should not initialize twice', async () => {
      await appContext.initialize();

      // Second initialization should be a no-op
      await expect(appContext.initialize()).resolves.toBeUndefined();
    });

    it('should emit initialized event', async () => {
      const initHandler = jest.fn();
      appContext.on('initialized', initHandler);

      await appContext.initialize();
      expect(initHandler).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      // Create a container that will fail validation
      const badContainer = new DIContainer({ name: 'bad' });
      badContainer.register('badService', () => 'test', 'singleton', ['nonexistent']);

      const badContext = new ApplicationContext(badContainer);

      await expect(badContext.initialize()).rejects.toThrow(/not registered/);
    });
  });

  describe('Service Resolution', () => {
    beforeEach(async () => {
      await appContext.initialize();
    });

    it('should resolve services after initialization', () => {
      const logger = appContext.getService<ILogger>(ServiceKeys.LOGGER);
      expect(logger).toBeInstanceOf(Logger);

      const store = appContext.getService<IStore>(ServiceKeys.STORE);
      expect(store).toBeDefined();
    });

    it('should resolve services asynchronously', async () => {
      const logger = await appContext.getServiceAsync<ILogger>(ServiceKeys.LOGGER);
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should throw error when resolving before initialization', () => {
      const uninitializedContext = new ApplicationContext(container);

      expect(() => uninitializedContext.getService(ServiceKeys.LOGGER)).toThrow(
        'Application context is not initialized'
      );
    });

    it('should throw error for non-existent services', () => {
      expect(() => appContext.getService('nonexistent')).toThrow("Service 'nonexistent' is not registered");
    });
  });

  describe('Environment Methods', () => {
    beforeEach(async () => {
      await appContext.initialize();
    });

    it('should detect production environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        expect(appContext.isProduction()).toBe(true);
        expect(appContext.isDevelopment()).toBe(false);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should detect development environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        expect(appContext.isProduction()).toBe(false);
        expect(appContext.isDevelopment()).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should provide version and app data path', () => {
      expect(typeof appContext.getVersion()).toBe('string');
      expect(typeof appContext.getAppDataPath()).toBe('string');
    });
  });

  describe('Shutdown', () => {
    beforeEach(async () => {
      await appContext.initialize();
    });

    it('should shutdown cleanly', async () => {
      await expect(appContext.shutdown()).resolves.toBeUndefined();
    });

    it('should emit shutdown event', async () => {
      const shutdownHandler = jest.fn();
      appContext.on('shutdown', shutdownHandler);

      await appContext.shutdown();
      expect(shutdownHandler).toHaveBeenCalled();
    });

    it('should dispose services on shutdown', async () => {
      const store = appContext.getService<IStore>(ServiceKeys.STORE);
      const disposeSpy = jest.spyOn(store, 'dispose');

      await appContext.shutdown();
      expect(disposeSpy).toHaveBeenCalled();
    });

    it('should handle disposal errors gracefully', async () => {
      // Mock a service that throws on dispose
      const mockService = {
        dispose: jest.fn().mockImplementation(() => {
          throw new Error('Dispose failed');
        }),
      };

      container.registerInstance('mockService', mockService);
      container.resolve('mockService'); // Ensure it's instantiated

      // Should complete shutdown despite dispose errors (not throw)
      await appContext.shutdown();
      expect(mockService.dispose).toHaveBeenCalled();
    });
  });
});

describe('Bootstrap Integration', () => {
  // Skip this test in normal test runs to avoid Electron dependencies
  it.skip('should bootstrap services successfully', async () => {
    const appContext = await bootstrapServices();

    expect(appContext).toBeInstanceOf(ApplicationContext);

    // Should be able to resolve core services
    const logger = appContext.getService<ILogger>(ServiceKeys.LOGGER);
    expect(logger).toBeInstanceOf(Logger);

    const store = appContext.getService<IStore>(ServiceKeys.STORE);
    expect(store).toBeDefined();

    await appContext.dispose();
  });
});
