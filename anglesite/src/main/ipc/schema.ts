/**
 * @file IPC handlers for JSON schema operations
 * @description Loads and resolves website configuration schemas from the anglesite-11ty package
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getGlobalContext } from '../core/service-registry';
import { ServiceKeys } from '../core/container';
import type { IWebsiteManager } from '../core/interfaces';
import { createIPCErrorReporter } from '../utils/error-handler-integration';
import { logger, sanitize } from '../utils/logging';

/**
 * Get error reporter for schema IPC operations
 */
function getErrorReporter() {
  try {
    const context = getGlobalContext();
    return createIPCErrorReporter(context, 'schema');
  } catch {
    return null; // Graceful degradation when DI not available
  }
}

interface SchemaResult {
  schema?: Record<string, unknown>;
  error?: string;
  warnings?: string[];
  fallbackSchema?: Record<string, unknown>;
}

// Interface for module loading results
// Currently unused but kept for future module loading features
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ModuleResult {
  module?: Record<string, unknown>;
  error?: string;
}

/**
 * Setup Schema Service IPC handlers.
 */
export function setupSchemaHandlers(): void {
  /**
   * Get complete website schema with resolved references.
   */
  ipcMain.handle(
    'get-website-schema',
    async (event: IpcMainInvokeEvent, websiteName: string): Promise<SchemaResult> => {
      try {
        logger.debug(`Loading website schema for: ${sanitize.message(websiteName)}`);

        if (!websiteName) {
          throw new Error('Website name is required');
        }

        const appContext = getGlobalContext();
        const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

        const websitePath = await websiteManager.execute(async (service) => {
          return service.getWebsitePath(websiteName);
        });

        if (!websitePath) {
          throw new Error('Unable to get website path - website manager returned undefined');
        }

        // Look for schemas in the source anglesite-11ty package
        // Try multiple locations where schemas might be
        const possibleSchemaPaths = [
          // In production build: copied schemas
          path.join(__dirname, '..', '..', 'schemas'),
          // In development: monorepo structure
          path.join(__dirname, '..', '..', '..', '..', '..', 'anglesite-11ty', 'schemas'),
          // In production: installed package
          path.join(__dirname, '..', '..', 'node_modules', '@dwk', 'anglesite-11ty', 'schemas'),
          // Legacy location (for compatibility)
          path.join(websitePath, '..', '..', 'anglesite-11ty', 'schemas'),
        ];

        let schemaPath: string | null = null;
        for (const testPath of possibleSchemaPaths) {
          try {
            await fs.access(testPath);
            schemaPath = testPath;
            logger.debug(`Found schema directory at: ${sanitize.path(schemaPath)}`);
            break;
          } catch {
            // Continue to next path
          }
        }

        if (!schemaPath) {
          logger.debug('Schema directory not found in any expected location');
          return {
            error: 'Schema directory not found. Using fallback schema.',
            fallbackSchema: getFallbackSchema(),
          };
        }

        logger.debug(`Using schema path: ${sanitize.path(schemaPath)}`);

        // Load main schema file
        const mainSchemaPath = path.join(schemaPath, 'website.schema.json');
        let mainSchema: Record<string, unknown>;

        try {
          const mainSchemaContent = await fs.readFile(mainSchemaPath, 'utf-8');
          mainSchema = JSON.parse(mainSchemaContent);
          logger.debug('Loaded main schema successfully');
        } catch (error) {
          const errorReporter = getErrorReporter();
          if (errorReporter) {
            errorReporter('schemaLoadError', error, { operation: 'load-main-schema', mainSchemaPath }).catch(() => {});
          } else {
            console.error('Error loading main schema:', error);
          }
          return {
            error: `JSON parsing error in main schema: ${(error as Error).message}`,
            fallbackSchema: getFallbackSchema(),
          };
        }

        // Resolve all module references and combine into a single schema
        const resolvedSchema = await resolveSchemaReferences(mainSchema, schemaPath);

        return {
          schema: resolvedSchema.schema,
          warnings: resolvedSchema.warnings,
        };
      } catch (error) {
        const errorReporter = getErrorReporter();
        if (errorReporter) {
          errorReporter('websiteSchemaError', error, { operation: 'get-website-schema' }).catch(() => {});
        } else {
          console.error('Error in get-website-schema:', error);
        }
        return {
          error: `Failed to load schema: ${(error as Error).message}`,
          fallbackSchema: getFallbackSchema(),
        };
      }
    }
  );

  /**
   * Get individual schema module.
   */
  ipcMain.handle(
    'get-schema-module',
    async (event: IpcMainInvokeEvent, websiteName: string, moduleName: string): Promise<Record<string, unknown>> => {
      try {
        logger.debug(
          `Loading schema module: ${sanitize.message(moduleName)} for website: ${sanitize.message(websiteName)}`
        );

        if (!websiteName || !moduleName) {
          throw new Error('Website name and module name are required');
        }

        const appContext = getGlobalContext();
        const websiteManager = appContext.getResilientService<IWebsiteManager>(ServiceKeys.WEBSITE_MANAGER);

        const websitePath = await websiteManager.execute(async (service) => {
          return service.getWebsitePath(websiteName);
        });

        // Look for schema modules in the source anglesite-11ty package
        const possibleModulePaths = [
          // In development: monorepo structure
          path.join(
            __dirname,
            '..',
            '..',
            '..',
            '..',
            '..',
            'anglesite-11ty',
            'schemas',
            'modules',
            `${moduleName}.json`
          ),
          // In production: installed package
          path.join(
            __dirname,
            '..',
            '..',
            'node_modules',
            '@dwk',
            'anglesite-11ty',
            'schemas',
            'modules',
            `${moduleName}.json`
          ),
          // Legacy location (for compatibility)
          path.join(websitePath, '..', '..', 'anglesite-11ty', 'schemas', 'modules', `${moduleName}.json`),
        ];

        let modulePath: string | null = null;
        for (const testPath of possibleModulePaths) {
          try {
            await fs.access(testPath);
            modulePath = testPath;
            break;
          } catch {
            // Continue to next path
          }
        }

        if (!modulePath) {
          throw new Error(`Module not found: ${moduleName}`);
        }

        try {
          const moduleContent = await fs.readFile(modulePath, 'utf-8');
          const moduleData = JSON.parse(moduleContent);
          logger.debug(`Loaded module ${sanitize.message(moduleName)} successfully`);
          return moduleData;
        } catch (error) {
          if ((error as { code?: string }).code === 'ENOENT') {
            throw new Error(`Module not found: ${moduleName}`);
          }
          throw new Error(`Failed to parse module ${moduleName}: ${(error as Error).message}`);
        }
      } catch (error) {
        const errorReporter = getErrorReporter();
        if (errorReporter) {
          errorReporter('schemaModuleError', error, { operation: 'get-schema-module', moduleName }).catch(() => {});
        } else {
          console.error('Error in get-schema-module:', error);
        }
        throw error;
      }
    }
  );
}

/**
 * Resolve schema references recursively.
 */
async function resolveSchemaReferences(
  schema: Record<string, unknown>,
  schemaBasePath: string
): Promise<{ schema: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const resolvedSchema = { ...schema };

  try {
    // Handle allOf references to modules
    if (schema.allOf && Array.isArray(schema.allOf)) {
      const mergedProperties: Record<string, unknown> = {};
      const mergedRequired: string[] = [];

      for (const item of schema.allOf) {
        if (item.$ref && typeof item.$ref === 'string') {
          try {
            const moduleData = await loadModuleFromRef(item.$ref, schemaBasePath);

            // Resolve internal references within the module
            // Pass the module's own path as the basePath for resolving its internal references
            const modulePath = path.resolve(schemaBasePath, item.$ref);
            const resolvedModule = await resolveInternalReferences(moduleData, modulePath);

            // Merge properties and required fields
            if (resolvedModule.properties) {
              Object.assign(mergedProperties, resolvedModule.properties);
            }
            if (resolvedModule.required && Array.isArray(resolvedModule.required)) {
              mergedRequired.push(...resolvedModule.required);
            }
          } catch (error) {
            const moduleName = path.basename(item.$ref, '.json');
            warnings.push(`Failed to load module: ${moduleName} - ${(error as Error).message}`);
            const errorReporter = getErrorReporter();
            if (errorReporter) {
              errorReporter('moduleLoadSkipped', error, { operation: 'load-schema-module', moduleName }).catch(
                () => {}
              );
            } else {
              console.warn(`Skipping module ${moduleName}:`, error);
            }
          }
        }
      }

      // Replace allOf with merged properties
      delete resolvedSchema.allOf;
      resolvedSchema.properties = mergedProperties;
      if (mergedRequired.length > 0) {
        resolvedSchema.required = Array.from(new Set(mergedRequired)); // Remove duplicates
      }
    }

    return { schema: resolvedSchema, warnings };
  } catch (error) {
    const errorReporter = getErrorReporter();
    if (errorReporter) {
      errorReporter('schemaReferenceResolution', error, { operation: 'resolve-schema-references' }).catch(() => {});
    } else {
      console.error('Error resolving schema references:', error);
    }
    throw error;
  }
}

/**
 * Load a module from a $ref path.
 */
async function loadModuleFromRef(ref: string, basePath: string): Promise<Record<string, unknown>> {
  // Handle relative references like "./modules/basic-info.json"
  const modulePath = path.resolve(basePath, ref);

  try {
    const moduleContent = await fs.readFile(modulePath, 'utf-8');
    return JSON.parse(moduleContent);
  } catch (error) {
    throw new Error(`Failed to load module from ${ref}: ${(error as Error).message}`);
  }
}

/**
 * Resolve internal $ref references within a schema (e.g., to common.json).
 */
async function resolveInternalReferences(
  schema: Record<string, unknown>,
  basePath: string
): Promise<Record<string, unknown>> {
  const resolved = JSON.parse(JSON.stringify(schema)); // Deep copy

  // When resolving references within a module, use the module's directory as base
  const baseDir = path.dirname(basePath);
  await walkAndResolveRefs(resolved, baseDir, [], new Set());
  return resolved;
}

/**
 * Recursively walk through schema object and resolve $ref references.
 */
async function walkAndResolveRefs(
  obj: Record<string, unknown> | unknown[],
  baseDir: string,
  currentPath: string[] = [],
  resolutionStack: Set<string> = new Set()
): Promise<void> {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] && typeof obj[i] === 'object') {
        await walkAndResolveRefs(
          obj[i] as Record<string, unknown> | unknown[],
          baseDir,
          [...currentPath, i.toString()],
          resolutionStack
        );
      }
    }
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref' && typeof value === 'string') {
      try {
        const refValue = value as string;

        // Create a unique identifier for this reference resolution
        const refId = `${baseDir}:${refValue}`;

        // Check for circular references in the current resolution stack
        if (resolutionStack.has(refId)) {
          const errorReporter = getErrorReporter();
          if (errorReporter) {
            errorReporter('circularReferenceDetected', new Error(`Circular reference detected: ${refValue}`), {
              operation: 'resolve-references',
              refValue,
            }).catch(() => {});
          } else {
            console.warn(`Circular reference detected: ${refValue} already being resolved in current stack`);
          }
          continue;
        }

        // Parse reference (e.g., "./common.json#/definitions/email")
        const [filePath, jsonPointer] = refValue.split('#');

        if (filePath) {
          // Resolve the reference path relative to the base directory
          const resolvedPath = path.resolve(baseDir, filePath);

          // Add this reference to the resolution stack
          const newResolutionStack = new Set(resolutionStack);
          newResolutionStack.add(refId);

          const refContent = await fs.readFile(resolvedPath, 'utf-8');
          const refData = JSON.parse(refContent);

          // Navigate to the specific definition using JSON pointer
          let targetDef = refData;
          if (jsonPointer) {
            const pathParts = jsonPointer.split('/').filter((p) => p);
            for (const part of pathParts) {
              targetDef = targetDef[part];
              if (!targetDef) break;
            }
          }

          if (targetDef) {
            // Replace the $ref with the resolved definition
            delete obj[key]; // Remove $ref
            Object.assign(obj, targetDef); // Merge resolved definition

            // Recursively resolve any nested references with the resolution stack
            // Use the directory of the referenced file as the new base directory for nested refs
            const newBaseDir = path.dirname(resolvedPath);
            await walkAndResolveRefs(obj, newBaseDir, [...currentPath, `resolved:${refValue}`], newResolutionStack);
          }
        }
      } catch (error) {
        const errorReporter = getErrorReporter();
        if (errorReporter) {
          errorReporter('referenceResolutionFailed', error, { operation: 'resolve-reference', reference: value }).catch(
            () => {}
          );
        } else {
          console.warn(`Failed to resolve reference ${value}:`, error);
        }
        // Keep the original $ref if resolution fails
      }
    } else {
      // Recursively process nested objects/arrays
      if (value && typeof value === 'object') {
        await walkAndResolveRefs(
          value as Record<string, unknown> | unknown[],
          baseDir,
          [...currentPath, key],
          resolutionStack
        );
      }
    }
  }
}

/**
 * Get fallback schema when main schema loading fails.
 */
function getFallbackSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Website Configuration (Simplified)',
    description: 'Basic website configuration schema - full schema failed to load',
    type: 'object',
    required: ['title', 'language'],
    properties: {
      title: {
        type: 'string',
        title: 'Website Title',
        description: 'The main title of your website',
        minLength: 1,
      },
      language: {
        type: 'string',
        title: 'Primary Language',
        description: 'Primary language (ISO 639-1 code)',
        pattern: '^[a-z]{2}(-[A-Z]{2})?$',
        default: 'en',
      },
      description: {
        type: 'string',
        title: 'Website Description',
        description: 'Brief description for SEO and social media',
        maxLength: 160,
      },
      url: {
        type: 'string',
        title: 'Website URL',
        description: 'Base URL (must use HTTPS)',
        format: 'uri',
        pattern: '^https://',
      },
      author: {
        type: 'object',
        title: 'Author Information',
        properties: {
          name: {
            type: 'string',
            title: 'Name',
          },
          email: {
            type: 'string',
            title: 'Email',
            format: 'email',
          },
          url: {
            type: 'string',
            title: 'Website',
            format: 'uri',
          },
        },
      },
    },
  };
}
