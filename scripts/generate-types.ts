import { compileFromFile } from 'json-schema-to-typescript';
import { writeFile } from 'fs/promises';

/**
 * Generates TypeScript type definitions from JSON schema files.
 * Converts the website.schema.json into corresponding TypeScript interfaces.
 * @returns {Promise<void>} A promise that resolves when type generation is complete.
 */
async function generateTypes(): Promise<void> {
  const ts = await compileFromFile('anglesite-11ty/schemas/website.schema.json', {
    bannerComment: '',
    enableConstEnums: true,
    format: true,
    style: {
      bracketSpacing: true,
      printWidth: 120,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
    },
  });
  await writeFile('anglesite-11ty/types/website.ts', ts);
}

generateTypes();
