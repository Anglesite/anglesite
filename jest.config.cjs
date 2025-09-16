module.exports = {
  projects: [
    {
      displayName: 'anglesite',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
      rootDir: '<rootDir>/anglesite',
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.jsx?$': 'babel-jest'
      }
    },
    {
      displayName: 'anglesite-11ty',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/tests/**/*.test.{ts,tsx,js,jsx}'],
      rootDir: '<rootDir>/anglesite-11ty',
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.jsx?$': 'babel-jest'
      }
    },
    {
      displayName: 'web-components',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/*.test.ts'],
      rootDir: '<rootDir>/web-components',
      transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.jsx?$': 'babel-jest'
      }
    }
  ],
  collectCoverageFrom: [
    '**/*.{ts,tsx,js,jsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/_site/**'
  ]
};