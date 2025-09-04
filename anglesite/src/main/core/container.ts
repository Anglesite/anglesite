/**
 * @file Dependency Injection Container
 *
 * Provides a lightweight, type-safe dependency injection system for Anglesite.
 * Supports singleton and transient lifetimes, circular dependency detection.
 * and easy testing through service substitution.
 *
 * Features:
 * - Type-safe service registration and resolution
 * - Singleton and transient service lifetimes
 * - Circular dependency detection
 * - Service substitution for testing
 * - Lazy initialization
 * - Hierarchical containers for scope isolation
 */

export type ServiceFactory<T = any> = () => T | Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ServiceConstructor<T = any> = new (...args: any[]) => T; // eslint-disable-line @typescript-eslint/no-explicit-any

// prettier-ignore
export interface ServiceDefinition<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  factory: ServiceFactory<T>;
  lifetime: 'singleton' | 'transient';
  dependencies?: string[];
  instance?: T;
  isAsync?: boolean;
}

export interface ContainerOptions {
  parent?: DIContainer;
  name?: string;
}

/**
 * Lightweight dependency injection container with type safety and lifecycle management.
 */
export class DIContainer {
  private services = new Map<string, ServiceDefinition>();
  private resolving = new Set<string>(); // Circular dependency detection
  private parent?: DIContainer;
  private name: string;

  constructor(options: ContainerOptions = {}) {
    this.parent = options.parent;
    this.name = options.name || 'root';
  }

  /**
   * Register a service with factory function.
   * @param name Service identifier
   * @param factory Function that creates the service instance
   * @param lifetime Service lifetime (singleton or transient)
   * @param dependencies Optional dependency names for validation
   */
  register<T>(
    name: string,
    factory: ServiceFactory<T>,
    lifetime: 'singleton' | 'transient' = 'singleton',
    dependencies: string[] = []
  ): DIContainer {
    const isAsync = this.isAsyncFactory(factory);

    this.services.set(name, {
      factory,
      lifetime,
      dependencies,
      isAsync,
    });

    return this; // Fluent interface
  }

  /**
   * Register a service using class constructor.
   * @param name Service identifier
   * @param constructor Class constructor to instantiate
   * @param lifetime Service lifetime
   * @param dependencyNames Names of services to inject into constructor
   */
  registerClass<T>(
    name: string,
    constructor: ServiceConstructor<T>,
    lifetime: 'singleton' | 'transient' = 'singleton',
    dependencyNames: string[] = []
  ): DIContainer {
    const factory: ServiceFactory<T> = () => {
      const dependencies = dependencyNames.map((depName) => this.resolve(depName));
      return new constructor(...dependencies);
    };

    return this.register(name, factory, lifetime, dependencyNames);
  }

  /**
   * Register a service instance directly (always singleton).
   * @param name Service identifier
   * @param instance Service instance
   */
  registerInstance<T>(name: string, instance: T): DIContainer {
    this.services.set(name, {
      factory: () => instance,
      lifetime: 'singleton',
      dependencies: [],
      instance,
    });

    return this;
  }

  /**
   * Resolve a service by name with type safety.
   * @param name Service identifier
   * @returns Service instance
   */
  resolve<T>(name: string): T {
    // Check for circular dependencies
    if (this.resolving.has(name)) {
      const cycle = Array.from(this.resolving).join(' -> ') + ' -> ' + name;
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    // Try to resolve from current container
    const serviceDefinition = this.services.get(name);

    if (!serviceDefinition) {
      // Try parent container
      if (this.parent) {
        return this.parent.resolve<T>(name);
      }

      throw new Error(`Service '${name}' is not registered in container '${this.name}'`);
    }

    // Return existing singleton instance if available
    if (serviceDefinition.lifetime === 'singleton' && serviceDefinition.instance) {
      return serviceDefinition.instance as T;
    }

    // Check for async factory in synchronous resolution
    if (serviceDefinition.isAsync) {
      throw new Error(`Service '${name}' requires async resolution. Use resolveAsync() instead.`);
    }

    // Mark as resolving for circular dependency detection
    this.resolving.add(name);

    try {
      // Create new instance
      const instance = serviceDefinition.factory() as T;

      // Store singleton instance
      if (serviceDefinition.lifetime === 'singleton') {
        serviceDefinition.instance = instance;
      }

      return instance;
    } finally {
      // Clear resolving flag
      this.resolving.delete(name);
    }
  }

  /**
   * Resolve a service asynchronously.
   * @param name Service identifier
   * @returns Promise resolving to service instance
   */
  async resolveAsync<T>(name: string): Promise<T> {
    // Check for circular dependencies
    if (this.resolving.has(name)) {
      const cycle = Array.from(this.resolving).join(' -> ') + ' -> ' + name;
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    // Try to resolve from current container
    const serviceDefinition = this.services.get(name);

    if (!serviceDefinition) {
      // Try parent container
      if (this.parent) {
        return this.parent.resolveAsync<T>(name);
      }

      throw new Error(`Service '${name}' is not registered in container '${this.name}'`);
    }

    // Return existing singleton instance if available
    if (serviceDefinition.lifetime === 'singleton' && serviceDefinition.instance) {
      return serviceDefinition.instance as T;
    }

    // Mark as resolving for circular dependency detection
    this.resolving.add(name);

    try {
      // Create new instance (handle both sync and async factories)
      const factoryResult = serviceDefinition.factory();
      const instance = (await Promise.resolve(factoryResult)) as T;

      // Store singleton instance
      if (serviceDefinition.lifetime === 'singleton') {
        serviceDefinition.instance = instance;
      }

      return instance;
    } finally {
      // Clear resolving flag
      this.resolving.delete(name);
    }
  }

  /**
   * Check if a service is registered.
   * @param name Service identifier
   * @returns True if service is registered
   */
  isRegistered(name: string): boolean {
    return this.services.has(name) || (this.parent?.isRegistered(name) ?? false);
  }

  /**
   * Create a child container for scope isolation.
   * @param name Optional name for the child container
   * @returns New child container
   */
  createScope(name?: string): DIContainer {
    return new DIContainer({ parent: this, name });
  }

  /**
   * Get all registered service names in current container.
   * @returns Array of service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get service definition for debugging.
   * @param name Service identifier
   * @returns Service definition or undefined
   */
  getServiceDefinition(name: string): ServiceDefinition | undefined {
    return this.services.get(name);
  }

  /**
   * Performs dependency validation to ensure all service dependencies are properly registered and resolvable.
   * @throws Error if any dependencies are missing
   */
  validateDependencies(): void {
    for (const serviceName of this.services.keys()) {
      const definition = this.services.get(serviceName)!;
      if (definition.dependencies) {
        for (const dependency of definition.dependencies) {
          if (!this.isRegistered(dependency)) {
            throw new Error(`Service '${serviceName}' depends on '${dependency}' which is not registered`);
          }
        }
      }
    }
  }

  /**
   * Clear all services and instances (useful for testing).
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }

  /**
   * Replace a service registration (useful for testing).
   * @param name Service identifier
   * @param factory New factory function
   */
  replace<T>(name: string, factory: ServiceFactory<T>): void {
    if (!this.services.has(name)) {
      throw new Error(`Cannot replace service '${name}' - it is not registered`);
    }

    const existing = this.services.get(name)!;
    this.services.set(name, {
      ...existing,
      factory,
      instance: undefined, // Clear existing instance
    });
  }

  /**
   * Gracefully shuts down all singleton service instances by calling their dispose methods when available.
   */
  async dispose(): Promise<void> {
    const disposePromises: Promise<void>[] = [];

    for (const serviceName of this.services.keys()) {
      const definition = this.services.get(serviceName)!;
      if (definition.instance && typeof definition.instance === 'object') {
        const instance = definition.instance as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (typeof instance.dispose === 'function') {
          try {
            const result = instance.dispose();
            if (result instanceof Promise) {
              disposePromises.push(
                result.catch((error) => {
                  console.warn('Service dispose error:', error);
                })
              );
            }
          } catch (error) {
            // Handle sync dispose errors
            console.warn('Service dispose error:', error);
          }
        }
      }
    }

    await Promise.all(disposePromises);
    this.clear();
  }

  /**
   * Check if factory function is async.
   * @param factory Factory function to check
   * @returns True if factory returns a Promise
   */
  private isAsyncFactory(factory: ServiceFactory): boolean {
    try {
      // Create a test call to check return type
      const result = factory.toString();
      return result.includes('async ') || result.includes('Promise') || result.includes('await ');
    } catch {
      return false; // Conservative fallback
    }
  }
}

/**
 * Global container instance for application-wide services.
 */
export const container = new DIContainer({ name: 'global' });

/**
 * Service locator pattern for quick access to common services.
 * Use sparingly - prefer constructor injection when possible.
 */
export class ServiceLocator {
  static resolve<T>(name: string): T {
    return container.resolve<T>(name);
  }

  static async resolveAsync<T>(name: string): Promise<T> {
    return container.resolveAsync<T>(name);
  }

  static isRegistered(name: string): boolean {
    return container.isRegistered(name);
  }
}

/**
 * Decorator for automatic service injection (experimental).
 * @param serviceName Name of service to inject
 */
export function Inject(serviceName: string) {
  // prettier-ignore
  return function (target: any, propertyKey: string | symbol) { // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.defineProperty(target, propertyKey, {
      get() {
        return container.resolve(serviceName);
      },
      configurable: true,
    });
  };
}

/**
 * Type-safe service keys for better IDE support.
 */
export const ServiceKeys = {
  // Core services
  STORE: 'store',
  LOGGER: 'logger',
  CONFIG: 'config',

  // Website management
  WEBSITE_MANAGER: 'websiteManager',
  WEBSITE_SERVER_MANAGER: 'websiteServerManager',
  WEBSITE_BUNDLER: 'websiteBundler',
  GIT_HISTORY_MANAGER: 'gitHistoryManager',

  // UI services
  MENU_MANAGER: 'menuManager',
  WINDOW_MANAGER: 'windowManager',

  // System services
  DNS_MANAGER: 'dnsManager',
  CERTIFICATE_MANAGER: 'certificateManager',

  // Utilities
  ATOMIC_OPERATIONS: 'atomicOperations',
  FILE_SYSTEM: 'fileSystem',
} as const;

export type ServiceKey = (typeof ServiceKeys)[keyof typeof ServiceKeys];
