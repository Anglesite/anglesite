/**
 * @file IPC handlers for JSON schema operations
 * @description Loads and resolves website configuration schemas from the anglesite-11ty package
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getWebsitePath } from '../utils/website-manager';

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
        console.log('Loading website schema for:', websiteName);

        if (!websiteName) {
          throw new Error('Website name is required');
        }

        const websitePath = getWebsitePath(websiteName);
        console.log('Got websitePath from getWebsitePath:', websitePath, typeof websitePath);

        if (!websitePath) {
          throw new Error('Unable to get website path - getWebsitePath returned undefined');
        }

        const schemaPath = path.join(websitePath, '..', '..', 'anglesite-11ty', 'schemas');

        console.log('Schema path:', schemaPath);

        // Check if schema directory exists
        try {
          await fs.access(schemaPath);
        } catch {
          console.log('Schema directory not found:', schemaPath);
          return {
            error: 'Schema directory not found. Using fallback schema.',
            fallbackSchema: getFallbackSchema(),
          };
        }

        // Load main schema file
        const mainSchemaPath = path.join(schemaPath, 'website.schema.json');
        let mainSchema: Record<string, unknown>;

        try {
          const mainSchemaContent = await fs.readFile(mainSchemaPath, 'utf-8');
          mainSchema = JSON.parse(mainSchemaContent);
          console.log('Loaded main schema successfully');
        } catch (error) {
          console.error('Error loading main schema:', error);
          return {
            error: `JSON parsing error in main schema: ${(error as Error).message}`,
            fallbackSchema: getFallbackSchema(),
          };
        }

        // Resolve all module references and combine into a single schema
        const resolvedSchema = await resolveSchemaReferences(mainSchema, schemaPath);

        console.log('Schema resolution completed');
        return {
          schema: resolvedSchema.schema,
          warnings: resolvedSchema.warnings,
        };
      } catch (error) {
        console.error('Error in get-website-schema:', error);
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
        console.log('Loading schema module:', moduleName, 'for website:', websiteName);

        if (!websiteName || !moduleName) {
          throw new Error('Website name and module name are required');
        }

        const websitePath = getWebsitePath(websiteName);
        const schemaPath = path.join(websitePath, '..', '..', 'anglesite-11ty', 'schemas', 'modules');
        const modulePath = path.join(schemaPath, `${moduleName}.json`);

        try {
          const moduleContent = await fs.readFile(modulePath, 'utf-8');
          const moduleData = JSON.parse(moduleContent);
          console.log(`Loaded module ${moduleName} successfully`);
          return moduleData;
        } catch (error) {
          if ((error as { code?: string }).code === 'ENOENT') {
            throw new Error(`Module not found: ${moduleName}`);
          }
          throw new Error(`Failed to parse module ${moduleName}: ${(error as Error).message}`);
        }
      } catch (error) {
        console.error('Error in get-schema-module:', error);
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
            const resolvedModule = await resolveInternalReferences(moduleData, schemaBasePath);

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
            console.warn(`Skipping module ${moduleName}:`, error);
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

    console.log(`Schema resolution completed with ${Object.keys(resolvedSchema.properties || {}).length} properties`);
    return { schema: resolvedSchema, warnings };
  } catch (error) {
    console.error('Error resolving schema references:', error);
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

  await walkAndResolveRefs(resolved, basePath);
  return resolved;
}

/**
 * Recursively walk through schema object and resolve $ref references.
 */
async function walkAndResolveRefs(
  obj: Record<string, unknown> | unknown[],
  basePath: string,
  visited = new Set<string>()
): Promise<void> {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object') {
        await walkAndResolveRefs(item as Record<string, unknown> | unknown[], basePath, visited);
      }
    }
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref' && typeof value === 'string') {
      try {
        const refValue = value as string;

        // Avoid circular references
        if (visited.has(refValue)) {
          console.warn(`Circular reference detected: ${refValue}`);
          continue;
        }
        visited.add(refValue);

        // Parse reference (e.g., "./common.json#/definitions/email")
        const [filePath, jsonPointer] = refValue.split('#');

        if (filePath) {
          const resolvedPath = path.resolve(path.dirname(basePath), 'modules', filePath);
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

            // Recursively resolve any nested references
            await walkAndResolveRefs(obj, basePath, visited);
          }
        }
      } catch (error) {
        console.warn(`Failed to resolve reference ${value}:`, error);
        // Keep the original $ref if resolution fails
      }
    } else {
      // Recursively process nested objects/arrays
      if (value && typeof value === 'object') {
        await walkAndResolveRefs(value as Record<string, unknown> | unknown[], basePath, visited);
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
