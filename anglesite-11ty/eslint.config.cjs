/**
 * @file ESLint flat configuration file for ESLint v9+
 * @see {@link https://eslint.org/docs/latest/use/configure/configuration-files-new}
 */
const js = require('@eslint/js');
const tsEslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-plugin-prettier');
const jsdoc = require('eslint-plugin-jsdoc');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
  // Base recommended configuration
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],

  // Global ignores
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'coverage/**/*'],
  },

  // TypeScript files configuration (including types directory)
  {
    files: ['**/*.ts', '**/*.d.ts', 'types/**/*.ts', 'types/**/*.d.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsEslint,
      prettier: prettier,
      jsdoc,
    },
    rules: {
      ...tsEslint.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      'jsdoc/no-types': 'off', // Types are handled by TypeScript
      'jsdoc/require-param-type': 'off', // Types are handled by TypeScript
      'jsdoc/require-returns-type': 'off', // Types are handled by TypeScript
    },
  },

  // Override for .d.ts files to allow 'any'
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // JavaScript and CommonJS files configuration
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      prettier: prettier,
      jsdoc,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
    },
  },

  // Test files configuration (Jest environment)
  {
    files: ['**/*.test.js', '**/test/**/*.js', 'tests/**/*.test.ts', 'tests/**/test-helpers.ts', 'tests/setup.ts'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsEslint,
      prettier: prettier,
      jsdoc,
    },
    rules: {
      ...tsEslint.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      'jsdoc/require-jsdoc': 'off', // Don't require JSDoc for test files
      'no-unused-vars': 'off', // Allow unused vars in test mocks
      '@typescript-eslint/no-unused-vars': 'off', // Allow unused vars in test mocks
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in test helpers for mocking
    },
  },

  // Override for robots.test.ts to allow 'any' for specific test cases
  {
    files: ['tests/plugins/robots.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
