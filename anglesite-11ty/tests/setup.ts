/**
 * @file Jest setup file for anglesite-11ty tests
 * @description Registers custom matchers and provides cross-project test utilities
 */

// Import and register custom matchers from the main anglesite project
import { registerCustomMatchers } from '../../anglesite/test/utils/custom-assertions';

// Register the custom matchers to make them available in all test files
registerCustomMatchers();

// Mock browser globals for Node.js environment when needed
// This creates a safe version of window that can be used in MockFactory.resetAllMocks()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).window = {
  electronAPI: undefined,
};

console.log('✓ anglesite-11ty Jest setup completed: custom matchers registered');
