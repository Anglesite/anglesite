/**
 * @file Jest setup file that runs before all tests
 *
 * This file imports custom matchers and performs any other
 * global test setup required for the Anglesite test suite.
 */

// Note: fs.promises.rm compatibility is now handled in the source code
// Note: @testing-library/jest-dom and custom matchers are imported in setupFilesAfterEnv
// Note: Jest hooks like beforeEach are moved to setupFilesAfterEnv

// Global error handling for unhandled promise rejections in tests
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection in test:', reason);
});

// Suppress console warnings for deprecated functions during tests
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  // Suppress specific warnings that are expected in tests
  const message = args.join(' ');
  if (message.includes('deprecated') || message.includes('ReactDOM.render')) {
    return;
  }
  originalWarn.apply(console, args);
};

// Additional global setup can be added here if needed
