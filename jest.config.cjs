module.exports = {
  projects: [
    {
      displayName: 'anglesite',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/anglesite/**/*.test.ts'],
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
      testMatch: ['<rootDir>/anglesite-11ty/**/*.test.ts'],
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
      testMatch: ['<rootDir>/web-components/**/*.test.ts'],
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