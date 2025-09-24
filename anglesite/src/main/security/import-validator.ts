/**
 * @file Security utilities for validating dynamic imports and preventing code injection
 */
import { logger, sanitize } from '../utils/logging';

/**
 * Whitelist of allowed modules for dynamic imports
 */
const ALLOWED_MODULES = [
  // UI modules
  './ui/multi-window-manager',
  './ui/window-manager',
  './ui/theme-manager',

  // Utils modules
  './utils/website-manager',
  './utils/git-history-manager',

  // Core modules
  './core/service-registry',
  './core/container',

  // Built-in Node modules
  'fs',
  'path',
  'crypto',
  'os',
] as const;

/**
 * Validates that a module path is safe for dynamic import.
 * @param modulePath The module path to validate
 * @returns true if the module is safe to import
 * @throws Error if the module path is not whitelisted
 */
export function validateModuleImport(modulePath: string): boolean {
  // Prevent directory traversal
  if (modulePath.includes('..') || modulePath.includes('~')) {
    throw new Error(`SECURITY: Directory traversal detected in module path: ${modulePath}`);
  }

  // Prevent absolute paths to system files
  if (modulePath.startsWith('/') && !modulePath.startsWith('./')) {
    throw new Error(`SECURITY: Absolute path not allowed: ${modulePath}`);
  }

  // Check against whitelist
  const isAllowed = ALLOWED_MODULES.some(
    (allowed) => modulePath === allowed || modulePath.startsWith(allowed + '/') || modulePath.startsWith('./' + allowed)
  );

  if (!isAllowed) {
    throw new Error(`SECURITY: Module not whitelisted for dynamic import: ${modulePath}`);
  }

  return true;
}

/**
 * Safe dynamic import wrapper that validates the module path.
 * @param modulePath The module path to import
 * @returns Promise resolving to the imported module
 */
export async function safeImport<T = unknown>(modulePath: string): Promise<T> {
  validateModuleImport(modulePath);

  try {
    const module = await import(modulePath);
    return module as T;
  } catch (error) {
    logger.error('Failed to import module', {
      module: sanitize.path(modulePath),
      error: sanitize.error(error),
    });
    throw new Error('Module import failed: [REDACTED]');
  }
}
