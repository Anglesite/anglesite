#!/usr/bin/env node
/**
 * JSON Schema validation script for Anglesite website configuration
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ajv = new Ajv({
  allErrors: true,
  loadSchema: false,
});

/**
 * Recursively load all schema files and add them to AJV
 * @param {string} schemasDir - Directory containing schema files
 */
function loadAllSchemas(schemasDir) {
  const schemaFiles = fs
    .readdirSync(schemasDir, { recursive: true })
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(schemasDir, file));

  // Load all schemas into AJV
  for (const schemaFile of schemaFiles) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
      if (schema.$id) {
        ajv.addSchema(schema, schema.$id);
      }
    } catch (error) {
      console.warn(`Warning: Could not load schema ${schemaFile}:`, error.message);
    }
  }
}

try {
  const schemaPath = path.join(__dirname, '..', 'anglesite-11ty', 'schemas', 'website.schema.json');
  const dataPath = path.join(__dirname, '..', 'anglesite-11ty', 'src', '_data', 'website.json');
  const schemasDir = path.join(__dirname, '..', 'anglesite-11ty', 'schemas');

  // Load all schemas first
  loadAllSchemas(schemasDir);

  // Load main schema and compile
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);

  // Load and validate data
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const valid = validate(data);

  if (valid) {
    console.log('✅ JSON schema validation passed');
    process.exit(0);
  } else {
    console.log('❌ JSON schema validation failed:');

    // Group errors for better readability
    const errorsByPath = {};
    validate.errors.forEach((error) => {
      const path = error.instancePath || 'root';
      if (!errorsByPath[path]) {
        errorsByPath[path] = [];
      }
      errorsByPath[path].push(error);
    });

    // Display grouped errors
    Object.keys(errorsByPath).forEach((path) => {
      console.log(`\n  Path: ${path}`);
      errorsByPath[path].forEach((error) => {
        console.log(`    ❌ ${error.message}`);
        if (error.allowedValues) {
          console.log(`       Allowed: ${error.allowedValues.join(', ')}`);
        }
        if (error.data !== undefined && typeof error.data !== 'object') {
          console.log(`       Found: ${JSON.stringify(error.data)}`);
        }
      });
    });

    console.log('\n💡 Note: This validation helps catch configuration errors early.');
    console.log('   Update your website.json to fix these issues.');
    process.exit(1);
  }
} catch (error) {
  console.error('Error during validation:', error.message);
  process.exit(1);
}
