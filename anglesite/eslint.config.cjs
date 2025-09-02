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
  jsdoc.configs['flat/contents-typescript-error'],
  jsdoc.configs['flat/logical-typescript-error'],
  jsdoc.configs['flat/stylistic-typescript-error'],

  // Global ignores (migrated from .eslintignore)
  {
    ignores: [
      'node_modules/**/*',
      'dist/**/*',
      'build/**/*',
      'coverage/**/*',
      '.nyc_output/**/*',
      '**/*.min.js',
      '**/*.map',
      'app/core/errors/examples.ts',
    ],
  },

  // TypeScript files configuration
  {
    files: ['**/*.ts', '**/*.d.ts'],
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
    },
  },

  // Types directory - encourage JSDoc but not required
  {
    files: ['types/**/*.ts', 'types/**/*.d.ts', 'test/types/**/*.ts'],
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
      'jsdoc/require-jsdoc': 'warn', // Warn but don't error on missing JSDoc
      'jsdoc/require-description': 'warn',
      'jsdoc/check-alignment': 'warn',
      'jsdoc/check-indentation': 'warn',
    },
  },

  // React/TSX files (browser environment)
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        React: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        Event: 'readonly',
        document: 'readonly',
        console: 'readonly',
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
      'jsdoc/require-jsdoc': 'off', // JSDoc not required for React components
    },
  },

  // Renderer process files (browser environment)
  {
    files: ['app/renderer.ts', 'app/preload.ts', 'app/renderer-wrapper.ts', 'src/renderer/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
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

  // Test files configuration (Jest + JSDOM environment)
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser, // For DOM globals in Jest with JSDOM
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
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // JavaScript mock files configuration (Jest environment)
  {
    files: ['test/**/*.js'],
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
      prettier: prettier,
      jsdoc,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
    },
  },

  // Custom Jest matchers configuration (allow namespace for Jest type extensions)
  {
    files: ['test/matchers/**/*.ts'],
    rules: {
      '@typescript-eslint/no-namespace': 'off', // Required for extending Jest types
    },
  },

  // TypeScript files with Electron types
  {
    files: ['app/main.ts', 'app/server/eleventy.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
        Electron: 'readonly', // TypeScript Electron namespace
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
    },
  },
];
