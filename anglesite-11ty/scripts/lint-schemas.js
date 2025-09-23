#!/usr/bin/env node

/**
 * JSON Schema Linter
 *
 * This script validates all JSON schemas in the schemas/ directory for:
 * - Valid JSON syntax
 * - Valid JSON Schema structure
 * - Circular references
 * - Missing references
 * - Format validation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');
const MODULES_DIR = path.join(SCHEMAS_DIR, 'modules');

class SchemaLinter {
  constructor() {
    this.ajv = new Ajv({
      strict: false,
      allErrors: true,
      verbose: true,
      loadSchema: false,
    });
    addFormats(this.ajv);
    this.errors = [];
    this.warnings = [];
  }

  log(level, file, message, details = null) {
    const entry = { level, file, message, details, timestamp: new Date().toISOString() };
    if (level === 'error') {
      this.errors.push(entry);
    } else if (level === 'warning') {
      this.warnings.push(entry);
    }

    const prefix = level === 'error' ? '❌' : level === 'warning' ? '⚠️ ' : 'ℹ️ ';
    console.log(`${prefix} ${file}: ${message}`);
    if (details) {
      console.log(`   ${JSON.stringify(details, null, 2)}`);
    }
  }

  async validateJsonSyntax(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      JSON.parse(content);
      return true;
    } catch (error) {
      this.log('error', path.basename(filePath), 'Invalid JSON syntax', {
        line: error.lineNumber || 'unknown',
        column: error.columnNumber || 'unknown',
        message: error.message,
      });
      return false;
    }
  }

  async validateSchemaStructure(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const schema = JSON.parse(content);

      // Validate that it's a valid JSON Schema
      const isValid = this.ajv.validateSchema(schema);
      if (!isValid) {
        this.log('error', path.basename(filePath), 'Invalid JSON Schema structure', {
          errors: this.ajv.errors,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.log('error', path.basename(filePath), 'Schema structure validation failed', {
        message: error.message,
      });
      return false;
    }
  }

  async checkCircularReferences(filePath) {
    try {
      // Use the same algorithm as the Anglesite runtime for consistency
      const content = fs.readFileSync(filePath, 'utf8');
      const schema = JSON.parse(content);

      // Simulate the runtime's reference resolution to check for circular references
      const baseDir = path.dirname(filePath);
      const testSchema = JSON.parse(JSON.stringify(schema)); // Deep copy

      await this.walkAndResolveRefs(testSchema, baseDir, []);
      return true;
    } catch (error) {
      if (error.message.includes('Circular') || error.message.includes('circular')) {
        this.log('error', path.basename(filePath), 'Circular reference detected', {
          message: error.message,
          path: error.path || 'unknown',
        });
        return false;
      } else {
        // Other errors (like missing refs) are also important
        this.log('error', path.basename(filePath), 'Reference resolution failed', {
          message: error.message,
        });
        return false;
      }
    }
  }

  async walkAndResolveRefs(obj, baseDir, currentPath = []) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] && typeof obj[i] === 'object') {
          await this.walkAndResolveRefs(obj[i], baseDir, [...currentPath, i.toString()]);
        }
      }
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === '$ref' && typeof value === 'string') {
        const refValue = value;

        // Check for circular references by seeing if we're already resolving this reference in the current path
        if (currentPath.some((pathSegment) => pathSegment.includes(refValue))) {
          throw new Error(`Circular reference detected: ${refValue} in path ${currentPath.join('.')}`);
        }

        // Parse reference (e.g., "./common.json#/definitions/email")
        const [filePath, jsonPointer] = refValue.split('#');

        if (filePath) {
          try {
            // Resolve the reference path relative to the base directory
            const resolvedPath = path.resolve(baseDir, filePath);
            const refContent = fs.readFileSync(resolvedPath, 'utf-8');
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

              // Recursively resolve any nested references with updated path
              await this.walkAndResolveRefs(obj, baseDir, [...currentPath, `resolved:${refValue}`]);
            }
          } catch (fileError) {
            // File not found or other issues - this will be caught by validateReferences
            // Don't throw here, just continue
          }
        }
      } else {
        // Recursively process nested objects/arrays
        if (value && typeof value === 'object') {
          await this.walkAndResolveRefs(value, baseDir, [...currentPath, key]);
        }
      }
    }
  }

  async validateReferences(filePath) {
    try {
      // Parse and validate all $ref pointers
      await $RefParser.resolve(filePath);
      return true;
    } catch (error) {
      this.log('error', path.basename(filePath), 'Reference validation failed', {
        message: error.message,
      });
      return false;
    }
  }

  async lintSchema(filePath) {
    const fileName = path.basename(filePath);
    console.log(`\n🔍 Linting ${fileName}...`);

    let isValid = true;

    // 1. Validate JSON syntax
    if (!(await this.validateJsonSyntax(filePath))) {
      isValid = false;
    }

    // 2. Validate schema structure
    if (!(await this.validateSchemaStructure(filePath))) {
      isValid = false;
    }

    // 3. Check for circular references
    if (!(await this.checkCircularReferences(filePath))) {
      isValid = false;
    }

    // 4. Validate all references
    if (!(await this.validateReferences(filePath))) {
      isValid = false;
    }

    if (isValid) {
      console.log(`✅ ${fileName} is valid`);
    }

    return isValid;
  }

  async lintAllSchemas() {
    console.log('🚀 Starting JSON Schema validation...\n');

    const schemaFiles = [];

    // Find all JSON schema files
    if (fs.existsSync(SCHEMAS_DIR)) {
      const files = fs.readdirSync(SCHEMAS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          schemaFiles.push(path.join(SCHEMAS_DIR, file));
        }
      }
    }

    if (fs.existsSync(MODULES_DIR)) {
      const files = fs.readdirSync(MODULES_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          schemaFiles.push(path.join(MODULES_DIR, file));
        }
      }
    }

    if (schemaFiles.length === 0) {
      console.log('⚠️  No schema files found');
      return true;
    }

    console.log(`Found ${schemaFiles.length} schema files to validate\n`);

    for (const schemaFile of schemaFiles) {
      const isValid = await this.lintSchema(schemaFile);
      if (!isValid) {
        // Errors are tracked in this.errors array
      }
    }

    // Summary
    console.log('\n📊 Linting Summary:');
    console.log(`   Files checked: ${schemaFiles.length}`);
    console.log(`   Errors: ${this.errors.length}`);
    console.log(`   Warnings: ${this.warnings.length}`);

    if (this.errors.length > 0) {
      console.log('\n❌ Schema validation failed');
      return false;
    } else {
      console.log('\n✅ All schemas are valid');
      return true;
    }
  }
}

// Run the linter
const linter = new SchemaLinter();
linter
  .lintAllSchemas()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('💥 Linter crashed:', error);
    process.exit(1);
  });
