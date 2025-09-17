/**
 * @file Test schema resolution with real anglesite-11ty schema files
 */
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Schema Resolution with Real Files', () => {
  const realSchemaPath = path.join(__dirname, '../../../anglesite-11ty/schemas');

  beforeAll(async () => {
    // Check if the real schema directory exists
    try {
      await fs.access(realSchemaPath);
    } catch (error) {
      throw new Error(
        `Real anglesite-11ty schemas not found at: ${realSchemaPath}. Test cannot proceed. Error: ${error}`
      );
    }
  });

  test('should load the main website schema', async () => {
    const mainSchemaPath = path.join(realSchemaPath, 'website.schema.json');
    const schemaContent = await fs.readFile(mainSchemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    expect(schema).toBeDefined();
    expect(schema.title).toBe('Anglesite Website Configuration');
    expect(schema.type).toBe('object');
    expect(schema.allOf).toBeDefined();
    expect(Array.isArray(schema.allOf)).toBe(true);
    expect(schema.allOf.length).toBeGreaterThan(0);
  });

  test('should load all referenced module files', async () => {
    const mainSchemaPath = path.join(realSchemaPath, 'website.schema.json');
    const schemaContent = await fs.readFile(mainSchemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    // Check that all referenced modules exist
    for (const item of schema.allOf) {
      if (item.$ref) {
        const modulePath = path.resolve(realSchemaPath, item.$ref);
        const moduleContent = await fs.readFile(modulePath, 'utf-8');
        const moduleData = JSON.parse(moduleContent);

        expect(moduleData).toBeDefined();
        expect(moduleData.type).toBe('object');
      }
    }
  });

  test('should load common.json definitions', async () => {
    const commonPath = path.join(realSchemaPath, 'modules/common.json');
    const commonContent = await fs.readFile(commonPath, 'utf-8');
    const common = JSON.parse(commonContent);

    expect(common.definitions).toBeDefined();
    expect(common.definitions.email).toBeDefined();
    expect(common.definitions.url).toBeDefined();
    expect(common.definitions.nonEmptyString).toBeDefined();
  });

  test('should test manual schema resolution logic', async () => {
    // This test simulates what our schema resolver should do
    const mainSchemaPath = path.join(realSchemaPath, 'website.schema.json');
    const schemaContent = await fs.readFile(mainSchemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    const resolvedSchema = { ...schema };
    const mergedProperties: Record<string, unknown> = {};
    const mergedRequired: string[] = [];

    // Manually resolve allOf references
    for (const item of schema.allOf) {
      if (item.$ref) {
        const modulePath = path.resolve(realSchemaPath, item.$ref);
        const moduleContent = await fs.readFile(modulePath, 'utf-8');
        const moduleData = JSON.parse(moduleContent);

        if (moduleData.properties) {
          Object.assign(mergedProperties, moduleData.properties);
        }
        if (moduleData.required && Array.isArray(moduleData.required)) {
          mergedRequired.push(...moduleData.required);
        }
      }
    }

    // Apply merged data
    delete resolvedSchema.allOf;
    resolvedSchema.properties = mergedProperties;
    if (mergedRequired.length > 0) {
      resolvedSchema.required = Array.from(new Set(mergedRequired));
    }

    // Verify the resolved schema has expected properties
    expect(resolvedSchema.properties).toBeDefined();
    expect(Object.keys(resolvedSchema.properties).length).toBeGreaterThan(0);

    // Should have basic properties
    expect(resolvedSchema.properties.title).toBeDefined();
    expect(resolvedSchema.properties.language).toBeDefined();
  });
});
