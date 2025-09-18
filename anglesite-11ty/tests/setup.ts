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
(global as any).window = {
  electronAPI: undefined,
};

// Jest setup completed: custom matchers registered

// Global console mock to reduce noise in test output
// Tests can override with jest.spyOn(console, 'log') etc when they need to verify console calls
const noop = () => {};
global.console = {
  ...global.console,
  log: process.env.JEST_VERBOSE === 'true' ? global.console.log : jest.fn(noop),
  warn: process.env.JEST_VERBOSE === 'true' ? global.console.warn : jest.fn(noop),
  error: process.env.JEST_VERBOSE === 'true' ? global.console.error : jest.fn(noop),
  info: process.env.JEST_VERBOSE === 'true' ? global.console.info : jest.fn(noop),
  debug: process.env.JEST_VERBOSE === 'true' ? global.console.debug : jest.fn(noop),
};
