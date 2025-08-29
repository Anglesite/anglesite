/**
 * @file Tests for Dependency Injection Container
 *
 * Comprehensive tests for the DI container including service registration,
 * resolution, lifecycle management, and error scenarios.
 */

import { DIContainer, ServiceKeys } from '../../../app/core/container';
import { Logger, FileSystemService } from '../../../app/core/service-registry';

describe('DIContainer', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer({ name: 'test' });
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Service Registration', () => {
    it('should register and resolve singleton services', () => {
      const mockService = { value: 42 };
      container.register('testService', () => mockService, 'singleton');

      const resolved1 = container.resolve('testService');
      const resolved2 = container.resolve('testService');

      expect(resolved1).toBe(mockService);
      expect(resolved2).toBe(mockService); // Same instance for singleton
    });

    it('should register and resolve transient services', () => {
      let counter = 0;
      container.register('testService', () => ({ id: ++counter }), 'transient');

      const resolved1 = container.resolve('testService');
      const resolved2 = container.resolve('testService');

      expect(resolved1).toEqual({ id: 1 });
      expect(resolved2).toEqual({ id: 2 });
      expect(resolved1).not.toBe(resolved2); // Different instances for transient
    });

    it('should register services using class constructor', () => {
      class TestService {
        constructor(
          public name: string,
          public value: number
        ) {}
        getName() {
          return this.name;
        }
      }

      container.registerInstance('dep1', 'test-name');
      container.registerInstance('dep2', 42);
      container.registerClass('testService', TestService, 'singleton', ['dep1', 'dep2']);

      const resolved = container.resolve<TestService>('testService');
      expect(resolved).toBeInstanceOf(TestService);
      expect(resolved.getName()).toBe('test-name');
      expect(resolved.value).toBe(42);
    });

    it('should register service instances directly', () => {
      const instance = { value: 'test-instance' };
      container.registerInstance('testService', instance);

      const resolved = container.resolve('testService');
      expect(resolved).toBe(instance);
    });

    it('should support fluent interface for registration', () => {
      const result = container
        .register('service1', () => 'value1')
        .register('service2', () => 'value2')
        .registerInstance('service3', 'value3');

      expect(result).toBe(container);
      expect(container.resolve('service1')).toBe('value1');
      expect(container.resolve('service2')).toBe('value2');
      expect(container.resolve('service3')).toBe('value3');
    });
  });

  describe('Service Resolution', () => {
    it('should throw error for unregistered service', () => {
      expect(() => container.resolve('nonexistent')).toThrow(
        "Service 'nonexistent' is not registered in container 'test'"
      );
    });

    it('should resolve services from parent container', () => {
      const parent = new DIContainer({ name: 'parent' });
      parent.registerInstance('parentService', 'parent-value');

      const child = new DIContainer({ parent, name: 'child' });
      child.registerInstance('childService', 'child-value');

      expect(child.resolve('parentService')).toBe('parent-value');
      expect(child.resolve('childService')).toBe('child-value');

      // Parent should not have access to child services
      expect(() => parent.resolve('childService')).toThrow();
    });

    it('should detect circular dependencies', () => {
      container.register('serviceA', () => container.resolve('serviceB'));
      container.register('serviceB', () => container.resolve('serviceA'));

      expect(() => container.resolve('serviceA')).toThrow(/Circular dependency detected/);
    });

    it('should handle complex circular dependency chains', () => {
      container.register('serviceA', () => container.resolve('serviceB'));
      container.register('serviceB', () => container.resolve('serviceC'));
      container.register('serviceC', () => container.resolve('serviceA'));

      expect(() => container.resolve('serviceA')).toThrow(
        /Circular dependency detected.*serviceA -> serviceB -> serviceC -> serviceA/
      );
    });
  });

  describe('Async Service Resolution', () => {
    it('should resolve async services', async () => {
      container.register('asyncService', async () => {
        return new Promise((resolve) => setTimeout(() => resolve('async-value'), 10));
      });

      const resolved = await container.resolveAsync('asyncService');
      expect(resolved).toBe('async-value');
    });

    it('should cache async singleton services', async () => {
      let creationCount = 0;
      container.register(
        'asyncSingleton',
        async () => {
          creationCount++;
          return { id: creationCount };
        },
        'singleton'
      );

      const resolved1 = await container.resolveAsync('asyncSingleton');
      const resolved2 = await container.resolveAsync('asyncSingleton');

      expect(creationCount).toBe(1);
      expect(resolved1).toBe(resolved2);
    });

    it('should throw error when trying to resolve async service synchronously', () => {
      container.register('asyncService', async () => 'async-value');

      expect(() => container.resolve('asyncService')).toThrow(
        "Service 'asyncService' requires async resolution. Use resolveAsync() instead."
      );
    });

    it('should handle mixed sync and async resolution', async () => {
      container.register('syncService', () => 'sync-value');
      container.register('asyncService', async () => 'async-value');

      // Sync resolution should work for sync services
      expect(container.resolve('syncService')).toBe('sync-value');

      // Async resolution should work for both
      expect(await container.resolveAsync('syncService')).toBe('sync-value');
      expect(await container.resolveAsync('asyncService')).toBe('async-value');
    });
  });

  describe('Service Introspection', () => {
    it('should check if service is registered', () => {
      container.registerInstance('testService', 'value');

      expect(container.isRegistered('testService')).toBe(true);
      expect(container.isRegistered('nonexistent')).toBe(false);
    });

    it('should get service names', () => {
      container.registerInstance('service1', 'value1');
      container.registerInstance('service2', 'value2');

      const names = container.getServiceNames();
      expect(names).toContain('service1');
      expect(names).toContain('service2');
      expect(names).toHaveLength(2);
    });

    it('should get service definitions', () => {
      container.register('testService', () => 'value', 'singleton', ['dep1']);

      const definition = container.getServiceDefinition('testService');
      expect(definition).toBeDefined();
      expect(definition!.lifetime).toBe('singleton');
      expect(definition!.dependencies).toEqual(['dep1']);
    });
  });

  describe('Dependency Validation', () => {
    it('should validate dependencies successfully', () => {
      container.registerInstance('dep1', 'value1');
      container.register('service1', () => 'value', 'singleton', ['dep1']);

      expect(() => container.validateDependencies()).not.toThrow();
    });

    it('should throw error for missing dependencies', () => {
      container.register('service1', () => 'value', 'singleton', ['missingDep']);

      expect(() => container.validateDependencies()).toThrow(
        "Service 'service1' depends on 'missingDep' which is not registered"
      );
    });

    it('should validate dependencies across parent containers', () => {
      const parent = new DIContainer({ name: 'parent' });
      parent.registerInstance('parentDep', 'value');

      const child = new DIContainer({ parent, name: 'child' });
      child.register('childService', () => 'value', 'singleton', ['parentDep']);

      expect(() => child.validateDependencies()).not.toThrow();
    });
  });

  describe('Service Scoping', () => {
    it('should create child scopes', () => {
      container.registerInstance('parentService', 'parent-value');

      const childScope = container.createScope('child');
      childScope.registerInstance('childService', 'child-value');

      expect(childScope.resolve('parentService')).toBe('parent-value');
      expect(childScope.resolve('childService')).toBe('child-value');
    });

    it('should isolate services between scopes', () => {
      const scope1 = container.createScope('scope1');
      const scope2 = container.createScope('scope2');

      scope1.registerInstance('service', 'scope1-value');
      scope2.registerInstance('service', 'scope2-value');

      expect(scope1.resolve('service')).toBe('scope1-value');
      expect(scope2.resolve('service')).toBe('scope2-value');
    });
  });

  describe('Service Replacement', () => {
    it('should replace existing service', () => {
      container.registerInstance('testService', 'original');
      expect(container.resolve('testService')).toBe('original');

      container.replace('testService', () => 'replaced');
      expect(container.resolve('testService')).toBe('replaced');
    });

    it('should throw error when replacing non-existent service', () => {
      expect(() => container.replace('nonexistent', () => 'value')).toThrow(
        "Cannot replace service 'nonexistent' - it is not registered"
      );
    });
  });

  describe('Container Lifecycle', () => {
    it('should clear all services', () => {
      container.registerInstance('service1', 'value1');
      container.registerInstance('service2', 'value2');

      expect(container.getServiceNames()).toHaveLength(2);

      container.clear();

      expect(container.getServiceNames()).toHaveLength(0);
      expect(() => container.resolve('service1')).toThrow();
    });

    it('should dispose services that implement dispose method', async () => {
      const disposableMock = {
        value: 'test',
        dispose: jest.fn().mockResolvedValue(undefined),
      };

      container.registerInstance('disposableService', disposableMock);

      // Resolve to create instance
      container.resolve('disposableService');

      await container.dispose();

      expect(disposableMock.dispose).toHaveBeenCalledTimes(1);
    });

    it('should handle dispose errors gracefully', async () => {
      const faultyService = {
        dispose: jest.fn().mockImplementation(() => {
          throw new Error('Dispose failed');
        }),
      };

      container.registerInstance('faultyService', faultyService);
      container.resolve('faultyService');

      // Should complete dispose despite errors
      await container.dispose();
      expect(faultyService.dispose).toHaveBeenCalled();
    });
  });

  describe('Real Service Integration', () => {
    it('should work with Logger service', () => {
      container.register(ServiceKeys.LOGGER, () => new Logger('test'), 'singleton');

      const logger = container.resolve<Logger>(ServiceKeys.LOGGER);
      expect(logger).toBeInstanceOf(Logger);

      // Should return same instance for singleton
      const logger2 = container.resolve<Logger>(ServiceKeys.LOGGER);
      expect(logger2).toBe(logger);
    });

    it('should work with FileSystem service', () => {
      container.register(ServiceKeys.FILE_SYSTEM, () => new FileSystemService(), 'singleton');

      const fileSystem = container.resolve<FileSystemService>(ServiceKeys.FILE_SYSTEM);
      expect(fileSystem).toBeInstanceOf(FileSystemService);
      expect(typeof fileSystem.exists).toBe('function');
      expect(typeof fileSystem.readFile).toBe('function');
    });

    it('should handle service dependencies correctly', () => {
      // Register logger first
      container.register(ServiceKeys.LOGGER, () => new Logger('app'), 'singleton');

      // Register a service that depends on logger
      container.register(
        'serviceWithDep',
        () => {
          const logger = container.resolve<Logger>(ServiceKeys.LOGGER);
          return { logger, value: 'test' };
        },
        'singleton',
        [ServiceKeys.LOGGER]
      );

      const service = container.resolve<{ logger: Logger; value: string }>('serviceWithDep');
      expect(service.logger).toBeInstanceOf(Logger);
      expect(service.value).toBe('test');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle factory function errors', () => {
      container.register('errorService', () => {
        throw new Error('Factory error');
      });

      expect(() => container.resolve('errorService')).toThrow('Factory error');
    });

    it('should handle async factory errors', async () => {
      container.register('asyncErrorService', async () => {
        throw new Error('Async factory error');
      });

      await expect(container.resolveAsync('asyncErrorService')).rejects.toThrow('Async factory error');
    });

    it('should maintain container state after factory errors', () => {
      container.registerInstance('goodService', 'good');
      container.register('errorService', () => {
        throw new Error('Factory error');
      });

      expect(() => container.resolve('errorService')).toThrow();
      expect(container.resolve('goodService')).toBe('good'); // Should still work
    });
  });
});
